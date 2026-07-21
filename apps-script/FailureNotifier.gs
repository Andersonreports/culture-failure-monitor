var TABS = {
  'Before Processing Failure': 'Before Processing',
  'After Processing Failure': 'After Processing',
};

var COORDINATOR_EMAIL = 'jeevav936@gmail.com';

var CC_EMAIL = 'andersonreportautomation@gmail.com';

var POLL_MINUTES = 5;

var REMINDER_HOURS = 72;

var MAIL_SENT_HEADER = 'MailSent';

var REMINDER_SENT_HEADER = 'ReminderSent';

function coordinatorEmail_() {
  var prop = PropertiesService.getScriptProperties().getProperty('COORDINATOR_EMAIL');
  return (prop && prop.trim()) || COORDINATOR_EMAIL.trim();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'checkFailures' || fn === 'checkForNewFailures') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('checkFailures').timeBased().everyMinutes(POLL_MINUTES).create();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  Object.keys(TABS).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (sheet) props.setProperty(lastRowKey_(tabName), String(sheet.getLastRow()));
  });

  Logger.log('Trigger installed (every %s min). Baseline set to current rows.', POLL_MINUTES);
}

function lastRowKey_(tabName) {
  return 'lastRow::' + tabName;
}

function checkFailures() {
  var to = coordinatorEmail_();
  if (!to) {
    Logger.log('COORDINATOR_EMAIL not set - skipping.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  Object.keys(TABS).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;
    processSheet_(sheet, tabName, to, props);
  });
}

function processSheet_(sheet, tabName, to, props) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var mailSentCol = ensureColumn_(sheet, MAIL_SENT_HEADER);
  var reminderCol = ensureColumn_(sheet, REMINDER_SENT_HEADER);

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  headers.forEach(function (name, i) { col[String(name).trim()] = i; });

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var seen = Number(props.getProperty(lastRowKey_(tabName)) || '1');
  var now = new Date();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var sheetRow = i + 2;
    var mailSentVal = String(row[mailSentCol - 1] || '').trim();
    var reminderVal = String(row[reminderCol - 1] || '').trim();
    var status = cell_(row, col, 'RecollectionStatus');

    if (!mailSentVal && sheetRow > seen) {
      try {
        sendFailureEmail_(to, row, col, TABS[tabName], false);
        var stamp = formatWhen_(now);
        sheet.getRange(sheetRow, mailSentCol).setValue(stamp);
        mailSentVal = stamp;
      } catch (err) {
        Logger.log('Initial email failed (%s row %s): %s', tabName, sheetRow, err);
      }
    }

    if (mailSentVal && !reminderVal && status !== 'Resolved') {
      var ts = cell_(row, col, 'Timestamp');
      if (ts && hoursSince_(ts, now) >= REMINDER_HOURS) {
        try {
          sendFailureEmail_(to, row, col, TABS[tabName], true);
          sheet.getRange(sheetRow, reminderCol).setValue(formatWhen_(now));
        } catch (err2) {
          Logger.log('Reminder email failed (%s row %s): %s', tabName, sheetRow, err2);
        }
      }
    }
  }

  props.setProperty(lastRowKey_(tabName), String(lastRow));
}

function ensureColumn_(sheet, header) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === header) return i + 1;
  }
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(header);
  return newCol;
}

function cell_(row, col, name) {
  return name in col ? String(row[col[name]] || '').trim() : '';
}

function hoursSince_(value, now) {
  var then = new Date(value);
  if (isNaN(then.getTime())) return 0;
  return (now.getTime() - then.getTime()) / 3600000;
}

function formatWhen_(d) {
  return Utilities.formatDate(d, 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a');
}

function sendFailureEmail_(to, row, col, stageLabel, isReminder) {
  var patient = cell_(row, col, 'PatientName');
  var sampleId = cell_(row, col, 'SampleID');
  var orderId = cell_(row, col, 'OrderID');
  var testName = cell_(row, col, 'TestName');
  var hospital = cell_(row, col, 'HospitalName');
  var failureType = cell_(row, col, 'FailureType');
  var reason = cell_(row, col, 'Reason');
  var notes = cell_(row, col, 'Notes');
  var reportedBy = cell_(row, col, 'ReportedBy');
  var timestamp = cell_(row, col, 'Timestamp');
  var billLink = cell_(row, col, 'BillImageLink');
  var refLinks = cell_(row, col, 'ReferenceImageLinks');

  var when = timestamp
    ? Utilities.formatDate(new Date(timestamp), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a')
    : '';

  var prefix = isReminder ? '[Culture Failure - REMINDER] ' : '[Culture Failure] ';
  var subject = prefix + failureType + ' - ' + (patient || sampleId || orderId || 'Unknown sample');

  var heading = isReminder ? 'Culture failure still pending recollection' : 'Culture failure reported';
  var intro = isReminder
    ? 'This failure was reported over ' + REMINDER_HOURS + ' hours ago and its recollection is still not marked Resolved.'
    : 'A new failure was uploaded by the wet-lab team.';

  var rows = [
    ['Patient name', patient],
    ['PIN / Sample ID', sampleId],
    ['Order ID', orderId],
    ['Test name', testName],
    ['Client / Hospital', hospital],
    ['Failure stage', stageLabel],
    ['Failure type', failureType],
    ['Reason', reason],
    ['Notes', notes],
    ['Reported by', reportedBy],
    ['Reported on', when],
  ];

  var textBody = intro + '\n\n' + rows.map(function (r) { return r[0] + ': ' + (r[1] || '-'); }).join('\n');
  if (billLink) textBody += '\n\nBill / report image: ' + billLink;
  if (refLinks) textBody += '\nReference images: ' + refLinks;

  var htmlRows = rows.map(function (r) {
    return '<tr><td style="padding:6px 12px;color:#555;white-space:nowrap;vertical-align:top">' +
      escapeHtml_(r[0]) + '</td><td style="padding:6px 12px;font-weight:600;color:#111">' +
      escapeHtml_(r[1] || '-') + '</td></tr>';
  }).join('');

  var htmlBody =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.4">' +
    '<h2 style="margin:0 0 4px">' + escapeHtml_(heading) + '</h2>' +
    '<p style="margin:0 0 16px;color:#666">' + escapeHtml_(intro) + '</p>' +
    '<table style="border-collapse:collapse;background:#f7f7f8;border-radius:8px">' + htmlRows + '</table>' +
    (billLink ? '<p style="margin:16px 0 4px"><a href="' + escapeHtml_(billLink) + '">View bill / report image</a></p>' : '') +
    (refLinks ? '<p style="margin:4px 0"><a href="' + escapeHtml_(refLinks.split(';')[0].trim()) + '">Reference image(s)</a></p>' : '') +
    '</div>';

  var options = { htmlBody: htmlBody };
  if (CC_EMAIL) options.cc = CC_EMAIL;
  MailApp.sendEmail(to, subject, textBody, options);
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
