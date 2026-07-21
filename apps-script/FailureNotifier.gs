var TABS = {
  'Before Processing Failure': 'Before Processing',
  'After Processing Failure': 'After Processing',
};

var COORDINATOR_EMAIL = 'jeevav936@gmail.com';

var CC_EMAIL = 'andersonreportautomation@gmail.com';

var POLL_MINUTES = 5;

function coordinatorEmail_() {
  var prop = PropertiesService.getScriptProperties().getProperty('COORDINATOR_EMAIL');
  return (prop && prop.trim()) || COORDINATOR_EMAIL.trim();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkForNewFailures') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('checkForNewFailures').timeBased().everyMinutes(POLL_MINUTES).create();

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

function checkForNewFailures() {
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

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var seen = Number(props.getProperty(lastRowKey_(tabName)) || '1');
    if (lastRow <= seen) return;

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col = {};
    headers.forEach(function (name, i) { col[String(name).trim()] = i; });

    var startRow = seen + 1;
    var numRows = lastRow - seen;
    var values = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

    values.forEach(function (row) {
      try {
        sendFailureEmail_(to, row, col, TABS[tabName]);
      } catch (err) {
        Logger.log('Email failed for a row in %s: %s', tabName, err);
      }
    });

    props.setProperty(lastRowKey_(tabName), String(lastRow));
  });
}

function cell_(row, col, name) {
  return name in col ? String(row[col[name]] || '').trim() : '';
}

function sendFailureEmail_(to, row, col, stageLabel) {
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

  var subject = '[Culture Failure] ' + failureType + ' - ' + (patient || sampleId || orderId || 'Unknown sample');

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

  var textBody = rows.map(function (r) { return r[0] + ': ' + (r[1] || '-'); }).join('\n');
  if (billLink) textBody += '\n\nBill / report image: ' + billLink;
  if (refLinks) textBody += '\nReference images: ' + refLinks;

  var htmlRows = rows.map(function (r) {
    return '<tr><td style="padding:6px 12px;color:#555;white-space:nowrap;vertical-align:top">' +
      escapeHtml_(r[0]) + '</td><td style="padding:6px 12px;font-weight:600;color:#111">' +
      escapeHtml_(r[1] || '-') + '</td></tr>';
  }).join('');

  var htmlBody =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.4">' +
    '<h2 style="margin:0 0 4px">Culture failure reported</h2>' +
    '<p style="margin:0 0 16px;color:#666">A new failure was uploaded by the wet-lab team.</p>' +
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
