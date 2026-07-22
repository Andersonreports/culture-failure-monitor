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

// Natural-language phrase for each FailureType (must match server/types.ts
// FAILURE_TYPES exactly). 'Other' has no entry - it falls back to the
// reporter's own Reason text, since that's the only description we have.
var FAILURE_PHRASES = {
  'Onco blocks - low tumor %': 'the tumor percentage in the received block is too low to proceed with testing,',
  'Blood Sample - Lysed/Hemolysed/Clotted': "sample received is lysed/hemolysed/clotted, couldn't take it for further processing,",
  'Wrong sample tubes': "sample was received in the wrong collection tubes, couldn't take it for further processing,",
  'Karyotyping - Metaphase not yielded/contaminated': 'has not yielded any metaphase / the culture appears contaminated,',
  'NIPS - QC matrix failed': 'the QC matrix has failed,',
  'Onco - low DNA/RNA concentration': 'the DNA/RNA concentration obtained is too low for testing,',
  'Onco-sequencing QC failure': 'the sequencing QC has failed,',
  'Microarray - No fetal genotype After MCC': 'no fetal genotype was detected even after MCC correction,',
  'Covid - IC failed': 'the internal control (IC) has failed,',
  'Fish her2 - Non diagnostics sample': 'sample received is non-diagnostic,',
};

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

  // NOTE: `seen` is only ever meant to baseline the pre-existing backlog at
  // install time (see installTrigger). It must not advance beyond that on
  // every run - doing so was a bug: a row whose send failed (quota, transient
  // API error) would have `sheetRow > seen` become permanently false on the
  // next run, so it could never be retried. Rows are keyed by MailSent being
  // empty, which is already sufficient and safely idempotent, so `seen` stays
  // fixed at its installed baseline forever.
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

function failurePhrase_(failureType, reason) {
  var phrase = FAILURE_PHRASES[failureType];
  if (phrase) return phrase;
  // 'Other' (or any future type without a curated phrase) - only thing we
  // have to describe it is the reporter's own free-text Reason.
  return (reason || 'a processing failure was reported') + ',';
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
  var billDate = cell_(row, col, 'BillDate');
  var billLink = cell_(row, col, 'BillImageLink');
  var refLinks = cell_(row, col, 'ReferenceImageLinks');

  var patientLabel = patient || sampleId || orderId || 'Unknown sample';
  var sampleLabel = testName || stageLabel;
  var phrase = failurePhrase_(failureType, reason);

  // e.g. "Kindly be informed the NIPS sample of Ms.Rajeshwari from Lakshmi
  // Hospital the QC matrix has failed, kindly arrange for Repeat sample."
  var sentence = 'Kindly be informed the ' + sampleLabel + ' sample of ' + patientLabel +
    (hospital ? ' from ' + hospital : '') + ' ' + phrase + ' kindly arrange for Repeat sample.';

  var reminderNote = isReminder
    ? 'Reminder: this was reported over ' + REMINDER_HOURS + ' hours ago and is still pending recollection.'
    : '';

  var prefix = isReminder ? '[Culture Failure - REMINDER] ' : '[Culture Failure] ';
  var subject = prefix + 'Repeat sample needed - ' + patientLabel + (hospital ? ' (' + hospital + ')' : '');

  var detailLines = [
    ['Patient Name', patient],
    ['Sample Number', sampleId],
    ['Order ID', orderId],
    ['Test Name', testName],
    ['Hospital / Client', hospital],
    ['Bill Date', billDate],
    ['Notes', notes],
  ].filter(function (r) { return r[1]; });

  var textBody = (reminderNote ? reminderNote + '\n\n' : '') + sentence +
    '\n\n' + detailLines.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
  if (billLink) textBody += '\n\nBill / report image: ' + billLink;
  if (refLinks) textBody += '\nReference images: ' + refLinks;

  var htmlDetailRows = detailLines.map(function (r) {
    return '<tr><td style="padding:4px 10px 4px 0;color:#666;white-space:nowrap;vertical-align:top">' +
      escapeHtml_(r[0]) + '</td><td style="padding:4px 0;color:#111">' +
      nl2br_(escapeHtml_(r[1])) + '</td></tr>';
  }).join('');

  var htmlBody =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;font-size:14px">' +
    (reminderNote ? '<p style="margin:0 0 12px;color:#b8790a;font-weight:600">' + escapeHtml_(reminderNote) + '</p>' : '') +
    '<p style="margin:0 0 16px">' + escapeHtml_(sentence) + '</p>' +
    (htmlDetailRows ? '<table style="border-collapse:collapse">' + htmlDetailRows + '</table>' : '') +
    (billLink ? '<p style="margin:16px 0 4px"><a href="' + escapeHtml_(billLink) + '">View bill / report image</a></p>' : '') +
    (refLinks ? '<p style="margin:4px 0"><a href="' + escapeHtml_(refLinks.split(';')[0].trim()) + '">Reference image(s)</a></p>' : '') +
    '</div>';

  var options = { htmlBody: htmlBody };
  if (CC_EMAIL) options.cc = CC_EMAIL;
  MailApp.sendEmail(to, subject, textBody, options);
}

function nl2br_(s) {
  return String(s).replace(/\n/g, '<br>');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
