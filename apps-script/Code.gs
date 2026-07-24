/**
 * Culture Failure Monitor — Apps Script backend (single file)
 *
 * Paste this whole file into the Apps Script project bound to the
 * "Culture Failure Monitor - Failure Log" spreadsheet
 * (Extensions → Apps Script from that sheet). It contains BOTH halves of the
 * backend:
 *
 *   PART 1 — DATA API (web app)
 *     doGet/doPost endpoints the standalone dashboard calls to read/write the
 *     sheet and upload images to Drive. Deploy via Deploy → New deployment →
 *     Web app (execute as Me, access Anyone) and paste the /exec URL into
 *     APPS_SCRIPT_URL in standalone/culture-failure.html.
 *
 *   PART 2 — EMAIL NOTIFIER (time trigger)
 *     Emails the coordinator each new failure + a 72h reminder for anything
 *     still pending. Run installTrigger() ONCE to start it. Runs on a 5-minute
 *     timer (not onEdit) because rows are added via the Sheets API, which does
 *     not fire edit/change triggers.
 *
 * The two parts are independent (no shared names); they only share the sheet.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * PART 1 — DATA API (web app)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Endpoints (all responses are JSON):
 *   GET  ?action=getAll   -> { before: [row...], after: [row...] }
 *   GET  ?action=status   -> { authenticated: true, sheetUrl }
 *   POST { action:'report', ...fields, billImage, referenceImages }
 *   POST { action:'setRecollection', category, rowNumber, recollectionStatus }
 *
 * CORS: the client fetches with `redirect:'follow'` and no custom headers, so
 * the /exec 302 -> googleusercontent.com response (which carries
 * Access-Control-Allow-Origin:*) is what the browser reads. Do NOT add a JSON
 * Content-Type on the client or a preflight will break it — send the body as
 * the default text/plain.
 */

// ─── Configuration ──────────────────────────────────────────────────────────
var CATEGORY_TABS = {
  before: 'Before Processing Failure',
  after: 'After Processing Failure',
};

var IMAGE_FOLDER_NAME = 'Culture Failure Monitor - Images';

// Must stay in lock-step with the dashboard and the FAILURE_PHRASES below.
var FAILURE_HEADERS = [
  'Timestamp',
  'OrderID',
  'SampleID',
  'PatientName',
  'HospitalName',
  'TestName',
  'BillDate',
  'Reason',
  'Notes',
  'ReportedBy',
  'BillImageLink',
  'ReferenceImageLinks',
  'FailureType',
  'RecollectionStatus',
  'MailSent',
];

var FAILURE_TYPES = {
  before: [
    'Onco blocks - low tumor %',
    'Blood Sample - Lysed/Hemolysed/Clotted',
    'Wrong sample tubes',
    'Other',
  ],
  after: [
    'Karyotyping - Metaphase not yielded/contaminated',
    'NIPS - QC matrix failed',
    'Onco - low DNA/RNA concentration',
    'Onco-sequencing QC failure',
    'Microarray - No fetal genotype After MCC',
    'Covid - IC failed',
    'Fish her2 - Non diagnostics sample',
    'Other',
  ],
};
// ──────────────────────────────────────────────────────────────────────────────

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getAll';
    if (action === 'status') return statusAction();
    return getAllAction();
  } catch (err) {
    return jsonOut({ error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.action === 'report') return reportAction(p);
    if (p.action === 'setRecollection') return setRecollectionAction(p);
    return jsonOut({ error: 'Unknown action: ' + p.action });
  } catch (err) {
    return jsonOut({ error: err.message || String(err) });
  }
}

// ─── Sheet helpers ──────────────────────────────────────────────────────────
function tabFor(category) {
  var name = CATEGORY_TABS[category];
  if (!name) throw new Error('Unknown category: ' + category);
  return name;
}

// Return the tab by name, creating it (with header row) if it is missing so a
// fresh log sheet still works.
function getOrCreateSheet(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, FAILURE_HEADERS.length).setValues([FAILURE_HEADERS]);
  }
  return sheet;
}

function readHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });
}

// Make sure every known header exists; append any missing ones to the right so
// the notifier's extra tracking columns (MailSent/ReminderSent) are never
// clobbered.
function ensureHeaders(sheet) {
  var headers = readHeaders(sheet);
  if (headers.length === 0) {
    sheet.getRange(1, 1, 1, FAILURE_HEADERS.length).setValues([FAILURE_HEADERS]);
    return FAILURE_HEADERS.slice();
  }
  var missing = FAILURE_HEADERS.filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

// ─── Actions ────────────────────────────────────────────────────────────────
function statusAction() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return jsonOut({ authenticated: true, sheetUrl: ss.getUrl() });
}

function listFailures(category) {
  var sheet = getOrCreateSheet(tabFor(category));
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var headers = readHeaders(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  return data.map(function (row, i) {
    var entry = { rowNumber: i + 2 };
    FAILURE_HEADERS.forEach(function (h) { entry[h] = ''; });
    headers.forEach(function (name, j) {
      if (FAILURE_HEADERS.indexOf(name) !== -1) entry[name] = row[j] || '';
    });
    return entry;
  });
}

function getAllAction() {
  return jsonOut({
    before: listFailures('before'),
    after: listFailures('after'),
  });
}

function getImageFolder() {
  var it = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(IMAGE_FOLDER_NAME);
}

// image = { name, mimeType, data(base64) } -> returns a /file/d/<id>/view link
// (matches the format the dashboard parses for thumbnails).
function uploadImage(folder, image) {
  var bytes = Utilities.base64Decode(image.data);
  var blob = Utilities.newBlob(bytes, image.mimeType || 'application/octet-stream', image.name || 'upload');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/file/d/' + file.getId() + '/view';
}

function reportAction(p) {
  var category = p.category;
  if (category !== 'before' && category !== 'after') {
    return jsonOut({ error: 'category must be "before" or "after"' });
  }
  if (!p.failureType || FAILURE_TYPES[category].indexOf(p.failureType) === -1) {
    return jsonOut({ error: 'failureType must be one of the listed options for this category' });
  }
  if (p.failureType === 'Other' && !(p.reason && String(p.reason).trim())) {
    return jsonOut({ error: 'reason is required when failure type is "Other"' });
  }
  if (!(p.reportedBy && String(p.reportedBy).trim())) {
    return jsonOut({ error: 'reportedBy is required' });
  }
  if (!(p.sampleId && String(p.sampleId).trim()) && !(p.orderId && String(p.orderId).trim())) {
    return jsonOut({ error: 'at least one of sampleId or orderId is required' });
  }
  if (!p.billImage || !p.billImage.data) {
    return jsonOut({ error: 'billImage is required' });
  }

  var folder = getImageFolder();
  var billImageLink = uploadImage(folder, p.billImage);
  var referenceImageLinks = (p.referenceImages || []).map(function (img) {
    return uploadImage(folder, img);
  });

  var timestamp = new Date().toISOString();
  var values = {
    Timestamp: timestamp,
    OrderID: p.orderId || '',
    SampleID: p.sampleId || '',
    PatientName: p.patientName || '',
    HospitalName: p.hospitalName || '',
    TestName: p.testName || '',
    BillDate: p.billDate || '',
    Reason: p.reason || '',
    Notes: p.notes || '',
    ReportedBy: p.reportedBy || '',
    BillImageLink: billImageLink,
    ReferenceImageLinks: referenceImageLinks.join('; '),
    FailureType: p.failureType,
    RecollectionStatus: 'Pending',
    MailSent: '',
  };

  var sheet = getOrCreateSheet(tabFor(category));
  var headers = ensureHeaders(sheet);
  var row = headers.map(function (name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : '';
  });
  sheet.appendRow(row);

  return jsonOut({ ok: true, failure: values });
}

function setRecollectionAction(p) {
  var category = p.category;
  if (category !== 'before' && category !== 'after') {
    return jsonOut({ error: 'category must be "before" or "after"' });
  }
  var rowNumber = Number(p.rowNumber);
  if (!(rowNumber >= 2) || Math.floor(rowNumber) !== rowNumber) {
    return jsonOut({ error: 'rowNumber must be an integer >= 2' });
  }
  if (p.recollectionStatus !== 'Pending' && p.recollectionStatus !== 'Resolved') {
    return jsonOut({ error: 'recollectionStatus must be "Pending" or "Resolved"' });
  }

  var sheet = getOrCreateSheet(tabFor(category));
  var headers = ensureHeaders(sheet);
  var col = headers.indexOf('RecollectionStatus') + 1;
  if (col < 1) return jsonOut({ error: 'RecollectionStatus column not found' });

  sheet.getRange(rowNumber, col).setValue(p.recollectionStatus);
  return jsonOut({ ok: true });
}


/* ═══════════════════════════════════════════════════════════════════════════
 * PART 2 — EMAIL NOTIFIER (time trigger)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Run installTrigger() once to start the 5-minute poll. It emails the
 * coordinator each new failure and a 72h reminder for anything still pending.
 */

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

// Natural-language phrase for each FailureType (must match FAILURE_TYPES
// above exactly). 'Other' has no entry - it falls back to the reporter's own
// Reason text, since that's the only description we have.
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
