const REFRESH_INTERVAL_MS = 60000;

// Mirrors server/types.ts FAILURE_TYPES - kept in sync manually since it's a
// short static list, not worth a round-trip endpoint just to fetch it.
const FAILURE_TYPES = {
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

const state = {
  role: localStorage.getItem('cfm.role') || 'wetlab',
  failures: { before: [], after: [] },
  filters: { from: '', to: '', category: 'all', status: 'all', search: '' },
};

const el = (id) => document.getElementById(id);

function animateStatValue(target, value) {
  const start = Number(target.textContent) || 0;
  if (start === value) { target.textContent = value; return; }
  const duration = 400;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - (1 - progress) ** 3;
    target.textContent = Math.round(start + (value - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
    else target.textContent = value;
  }
  requestAnimationFrame(step);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.1"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="spin"><path d="M21 12a9 9 0 1 1-9-9"/></svg>',
};

function svgNode(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

function toast(message, kind = 'info') {
  const area = el('toastArea');
  const div = document.createElement('div');
  div.className = `toast toast-${kind}`;
  if (kind === 'success' || kind === 'error') {
    div.appendChild(svgNode(ICONS[kind]));
  }
  const span = document.createElement('span');
  span.className = 'msg';
  span.textContent = message;
  div.appendChild(span);
  area.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

async function checkGoogleStatus() {
  const statusEl = el('sheetStatus');
  try {
    const res = await fetch('/auth/google/status');
    const data = await res.json();
    const textEl = statusEl.querySelector('.sheet-status-text');
    textEl.innerHTML = '';
    if (data.authenticated && data.sheetUrl) {
      statusEl.classList.add('ok');
      statusEl.classList.remove('warn');
      textEl.append('Google Sheet connected. ');
      const link = document.createElement('a');
      link.href = data.sheetUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open sheet';
      textEl.appendChild(link);
    } else if (data.authenticated) {
      statusEl.classList.add('ok');
      statusEl.classList.remove('warn');
      textEl.append('Google Sheet connected.');
    } else {
      statusEl.classList.add('warn');
      statusEl.classList.remove('ok');
      textEl.append('Google Sheet not connected. ');
      const link = document.createElement('a');
      link.href = '/auth/google';
      link.textContent = 'Connect now';
      textEl.appendChild(link);
    }
  } catch (err) {
    statusEl.querySelector('.sheet-status-text').textContent = 'Could not check Google Sheet status.';
  }
}

function isSameLocalDay(isoString, reference) {
  if (!isoString) return false;
  const d = new Date(isoString);
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  );
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function renderRoleUI() {
  el('roleWetLab').classList.toggle('active', state.role === 'wetlab');
  el('roleCoordinator').classList.toggle('active', state.role === 'coordinator');
  el('roleManager').classList.toggle('active', state.role === 'manager');
  document.querySelectorAll('.report-failure-btn').forEach((btn) => {
    btn.hidden = state.role !== 'wetlab';
  });

  const isManager = state.role === 'manager';
  el('combinedView').hidden = isManager;
  el('managerView').hidden = !isManager;
  renderActiveView();
}

function renderActiveView() {
  if (state.role === 'manager') renderManagerView();
  else renderCombined();
}

function buildImagesCell(f) {
  const tdImages = document.createElement('td');
  const links = [];
  if (f.BillImageLink) links.push({ href: f.BillImageLink, label: 'Bill' });
  (f.ReferenceImageLinks || '').split(';').map((s) => s.trim()).filter(Boolean).forEach((href, i) => {
    links.push({ href, label: `Ref ${i + 1}` });
  });
  if (!links.length) {
    tdImages.textContent = '—';
  } else {
    links.forEach((l, i) => {
      const a = document.createElement('a');
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = l.label;
      a.className = 'link';
      tdImages.appendChild(a);
      if (i < links.length - 1) tdImages.appendChild(document.createTextNode(' · '));
    });
  }
  return tdImages;
}

function buildRecollectionCell(category, f, editable) {
  const td = document.createElement('td');
  const status = f.RecollectionStatus === 'Resolved' ? 'Resolved' : 'Pending';
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = `recollection-pill tone-${status.toLowerCase()}`;
  pill.textContent = status;
  if (editable) {
    pill.addEventListener('click', () => toggleRecollection(category, f.rowNumber, status));
  } else {
    pill.disabled = true;
  }
  td.appendChild(pill);
  return td;
}

async function toggleRecollection(category, rowNumber, currentStatus) {
  const nextStatus = currentStatus === 'Resolved' ? 'Pending' : 'Resolved';
  const target = (state.failures[category] || []).find((f) => f.rowNumber === rowNumber);
  if (!target) return;
  const previousStatus = target.RecollectionStatus;

  target.RecollectionStatus = nextStatus;
  renderActiveView();

  try {
    const res = await fetch(`/api/failures/${category}/${rowNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recollectionStatus: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update recollection status');
  } catch (err) {
    target.RecollectionStatus = previousStatus;
    renderActiveView();
    toast(err.message, 'error');
  }
}

// Builds one <tr> for a flattened failure (has ._category). Used by both the
// combined main table and the manager table; only the recollection cell's
// editability differs.
function buildFailureRow(f, editableRecollection) {
  const tr = document.createElement('tr');

  const tdTs = document.createElement('td');
  tdTs.textContent = formatTimestamp(f.Timestamp);
  tr.appendChild(tdTs);

  const tdCat = document.createElement('td');
  const catPill = document.createElement('span');
  catPill.className = `cat-pill tone-${f._category === 'before' ? 'self' : 'fish'}`;
  catPill.textContent = f._category === 'before' ? 'Before' : 'After';
  tdCat.appendChild(catPill);
  tr.appendChild(tdCat);

  [f.SampleID, f.OrderID, f.PatientName, f.HospitalName, f.TestName, f.FailureType, f.Reason, f.ReportedBy]
    .forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value || '';
      tr.appendChild(td);
    });

  tr.appendChild(buildImagesCell(f));
  tr.appendChild(buildRecollectionCell(f._category, f, editableRecollection));
  return tr;
}

function renderCombined() {
  const all = getAllFailuresFlat();
  const now = new Date();
  animateStatValue(document.querySelector('[data-combined-stat="total"]'), all.length);
  animateStatValue(document.querySelector('[data-combined-stat="before"]'), all.filter((f) => f._category === 'before').length);
  animateStatValue(document.querySelector('[data-combined-stat="after"]'), all.filter((f) => f._category === 'after').length);
  animateStatValue(document.querySelector('[data-combined-stat="today"]'), all.filter((f) => isSameLocalDay(f.Timestamp, now)).length);

  const tbody = el('combinedTableBody');
  const table = el('combinedTable');
  const emptyState = el('combinedEmptyState');
  tbody.innerHTML = '';

  if (!all.length) {
    table.classList.add('hidden');
    emptyState.classList.add('visible');
    return;
  }
  table.classList.remove('hidden');
  emptyState.classList.remove('visible');

  [...all]
    .sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''))
    .forEach((f) => tbody.appendChild(buildFailureRow(f, true)));
}

async function fetchFailures() {
  try {
    const res = await fetch('/api/failures');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load failures');
    state.failures = { before: data.before || [], after: data.after || [] };
    renderActiveView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function resetReportForm() {
  ['reportOrderId', 'reportSampleId', 'reportPatientName', 'reportHospitalName',
    'reportTestName', 'reportReason', 'reportNotes', 'reportReportedBy'].forEach((id) => {
    el(id).value = '';
  });
  el('reportCategory').value = '';
  el('reportBillImage').value = '';
  el('reportReferenceImages').value = '';
  el('reportModalError').hidden = true;
  el('reportModalError').textContent = '';
  const ocrStatus = el('ocrStatus');
  ocrStatus.hidden = true;
  ocrStatus.className = 'ocr-status';
  ocrStatus.textContent = '';
}

// Tailored to the Anderson Diagnostics bill/receipt layout, which uses
// "Label Value" with NO colon separator (e.g. "Patient No. AKP0000014662"),
// unlike a generic "Label: Value" form. This is deliberately specific to
// that one template rather than a generic bill parser. OCR text is noisy
// (misread characters, garbled table borders) so this is a head start only -
// the wet lab team reviews/corrects every field before submitting.
function parseOcrText(text) {
  const found = {};
  const norm = text.replace(/\s+/g, ' ').trim(); // collapse OCR'd line breaks for easier matching

  // Sample ID <- "Patient No. <value>"
  const patientNo = norm.match(/patient\s*no\.?\s*([A-Za-z0-9]+)/i);
  if (patientNo) found.reportSampleId = patientNo[1];

  // Order ID <- first part of "Bill/Lab No <value1> / <value2>"
  const billLabNo = norm.match(/bill\s*\/?\s*lab\s*no\.?\s*([A-Za-z0-9]+)\s*\/\s*([A-Za-z0-9]+)/i);
  if (billLabNo) found.reportOrderId = billLabNo[1];

  // Patient Name <- "Name <value>" up to the age/gender parenthesis, e.g.
  // "Name MRS.SELVI (51 Y 0 M 0 D | Female)". \bname (word-boundary) avoids
  // matching "TestName"/"PanelName" which have no boundary before "Name".
  const name = norm.match(/\bname\s+([A-Za-z.\s]+?)\s*[([]/i);
  if (name) found.reportPatientName = name[1].trim();

  // Hospital Name <- the "PanelName" field (referring hospital/centre). It
  // reliably sits between the "Bill User <name>" line and the "# Test Code"
  // table header, so we grab that whole region rather than anchoring on the
  // "PanelName" label - the label is often mis-OCR'd (e.g. "PancIName") and,
  // when the name wraps to two lines, the label gets interleaved into the
  // value. We then strip that label token (however it was garbled) and any
  // leading punctuation. Best-effort; the field stays editable for review.
  const panelRegion = norm.match(/bill\s*user\s+\S+\s+(.*?)\s*(?:#|test\s*code|test\s*name)/i);
  if (panelRegion) {
    const hospital = panelRegion[1]
      // Remove the "PanelName" label token however OCR garbled it (e.g.
      // "PancIName", "Panc¢IName") - \S* tolerates stray characters inside it.
      .replace(/pan\S*name/ig, ' ')
      .replace(/\s{2,}/g, ' ')
      // Strip leading junk (table-border "|", commas, spaces, OCR specks).
      .replace(/^[^A-Za-z0-9]+/, '')
      .trim();
    if (hospital.length > 3) found.reportHospitalName = hospital;
  }

  // Test Name <- best-effort: the text between the "TestName ... Total/Rate"
  // column headers and the "Bill Amount" line. Starts at an ALL-CAPS token
  // (the test code/name) but then allows following mixed-case words so names
  // like "NIPS - All Chromosomes" or "HCV RT PCR QUANTITATIVE" are captured
  // whole. Table borders/serial numbers sometimes OCR as extra noise - check
  // and trim this field before submitting.
  const testRow = norm.match(/test\s*name.*?(?:total|rate)\s*(.+?)\s*(?:bill\s*amount|rate)/i);
  if (testRow) {
    const capsRuns = testRow[1].match(/[A-Z]{2,}(?:[\s-]+[A-Za-z0-9]{2,})*/g);
    if (capsRuns && capsRuns.length) {
      // Trailing numbers are the rate/amount columns bleeding in (e.g.
      // "NIPS - All Chromosomes 5000") - strip them off the test name.
      found.reportTestName = capsRuns
        .sort((a, b) => b.length - a.length)[0]
        .replace(/[\s\d.,]+$/, '')
        .trim();
    }
  }

  return found;
}

// These bill scans are often ~800px wide, which puts the small patient/table
// text below Tesseract's reliable size (it wants ~30px+ cap height). Upscaling
// to ~2000px wide and converting to grayscale+contrast dramatically improves
// recognition of that middle section. Returns a canvas Tesseract can read
// directly; falls back to the original file if anything goes wrong.
function preprocessBillImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const targetWidth = 2000;
        const scale = img.naturalWidth < targetWidth ? targetWidth / img.naturalWidth : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        // ctx.filter is supported in modern Chrome/Firefox/Safari; if a browser
        // ignores it, we still benefit from the upscale alone.
        ctx.filter = 'grayscale(1) contrast(1.3)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      } catch (err) {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

async function runOcrOnBillImage(file) {
  const status = el('ocrStatus');
  status.hidden = false;
  status.className = 'ocr-status';
  status.textContent = 'Reading image…';

  if (typeof Tesseract === 'undefined') {
    status.className = 'ocr-status ocr-warn';
    status.textContent = 'Auto-read unavailable (offline?) - please fill in the details manually.';
    return;
  }

  try {
    const ocrInput = await preprocessBillImage(file);
    const { data } = await Tesseract.recognize(ocrInput, 'eng');
    const rawText = data.text || '';

    const rawDetails = el('ocrRawTextDetails');
    el('ocrRawText').textContent = rawText.trim() || '(no text detected in image)';
    rawDetails.hidden = false;

    const found = parseOcrText(rawText);
    const filledCount = Object.keys(found).length;
    Object.entries(found).forEach(([id, value]) => {
      el(id).value = value;
    });
    if (filledCount > 0) {
      status.className = 'ocr-status ocr-done';
      status.textContent = `Read ${filledCount} field(s) from the image - please check them before submitting.`;
    } else {
      status.className = 'ocr-status ocr-warn';
      status.textContent = "Couldn't detect fields automatically - please fill in the details manually.";
    }
  } catch (err) {
    status.className = 'ocr-status ocr-warn';
    status.textContent = "Couldn't read the image automatically - please fill in the details manually.";
  }
}

function populateFailureTypeSelect(category) {
  const select = el('reportFailureType');
  select.innerHTML = '<option value="" disabled selected>Select…</option>';
  (FAILURE_TYPES[category] || []).forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    select.appendChild(opt);
  });
  select.disabled = !FAILURE_TYPES[category];
}

function openReportModal() {
  const overlay = el('reportFailureModalOverlay');
  resetReportForm();
  populateFailureTypeSelect('');
  updateReasonRequiredHint();
  overlay.hidden = false;
  el('reportCategory').focus();
}

function updateReasonRequiredHint() {
  const isOther = el('reportFailureType').value === 'Other';
  const label = el('reportReasonLabel');
  if (isOther) {
    label.innerHTML = 'Reason <span class="required-mark">*</span>';
  } else {
    label.textContent = 'Reason (optional)';
  }
}

function closeReportModal() {
  el('reportFailureModalOverlay').hidden = true;
}

async function submitReport() {
  const category = el('reportCategory').value;
  const errorBox = el('reportModalError');
  errorBox.hidden = true;

  if (category !== 'before' && category !== 'after') {
    errorBox.textContent = 'Please select a Category (Before or After Processing).';
    errorBox.hidden = false;
    return;
  }

  const fields = {
    category,
    orderId: el('reportOrderId').value.trim(),
    sampleId: el('reportSampleId').value.trim(),
    patientName: el('reportPatientName').value.trim(),
    hospitalName: el('reportHospitalName').value.trim(),
    testName: el('reportTestName').value.trim(),
    failureType: el('reportFailureType').value,
    reason: el('reportReason').value.trim(),
    notes: el('reportNotes').value.trim(),
    reportedBy: el('reportReportedBy').value.trim(),
  };
  const billImageFile = el('reportBillImage').files[0];
  const referenceImageFiles = Array.from(el('reportReferenceImages').files || []);

  if (!billImageFile) {
    errorBox.textContent = 'Please upload the bill/report screenshot.';
    errorBox.hidden = false;
    return;
  }
  if (!fields.failureType) {
    errorBox.textContent = 'Please select a Failure Type.';
    errorBox.hidden = false;
    return;
  }
  if (fields.failureType === 'Other' && !fields.reason) {
    errorBox.textContent = 'Reason is required when Failure Type is "Other".';
    errorBox.hidden = false;
    return;
  }
  if (!fields.reportedBy) {
    errorBox.textContent = 'Reported By is required.';
    errorBox.hidden = false;
    return;
  }
  if (!fields.sampleId && !fields.orderId) {
    errorBox.textContent = 'Enter at least a Sample ID or Order ID.';
    errorBox.hidden = false;
    return;
  }

  const submitBtn = el('reportModalSubmit');
  const original = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '';
  submitBtn.appendChild(svgNode(ICONS.spinner));
  submitBtn.appendChild(document.createTextNode(' Uploading & Submitting…'));

  try {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
    formData.append('billImage', billImageFile);
    referenceImageFiles.forEach((file) => formData.append('referenceImages', file));

    const res = await fetch('/api/failures', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to report failure');
    toast('Failure reported and saved. (WhatsApp notification to the coordinator isn\'t connected yet.)', 'success');
    closeReportModal();
    await fetchFailures();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = original;
  }
}

function setRole(role) {
  state.role = role;
  localStorage.setItem('cfm.role', role);
  renderRoleUI();
}

// ---- Manager view: filtering, unified table, charts ----

function getAllFailuresFlat() {
  const before = (state.failures.before || []).map((f) => ({ ...f, _category: 'before' }));
  const after = (state.failures.after || []).map((f) => ({ ...f, _category: 'after' }));
  return [...before, ...after];
}

function matchesFilters(f) {
  const { from, to, category, status, search } = state.filters;
  if (category !== 'all' && f._category !== category) return false;
  if (status !== 'all' && (f.RecollectionStatus || 'Pending') !== status) return false;
  if (from || to) {
    const day = f.Timestamp ? f.Timestamp.slice(0, 10) : '';
    if (from && day < from) return false;
    if (to && day > to) return false;
  }
  if (search) {
    const haystack = [
      f.Reason, f.FailureType, f.TestName, f.PatientName, f.HospitalName, f.SampleID, f.OrderID,
    ].join(' ').toLowerCase();
    if (!haystack.includes(search.toLowerCase())) return false;
  }
  return true;
}

function getFilteredFailures() {
  return getAllFailuresFlat().filter(matchesFilters);
}

function readFiltersFromUI() {
  state.filters = {
    from: el('filterFrom').value,
    to: el('filterTo').value,
    category: el('filterCategory').value,
    status: el('filterStatus').value,
    search: el('filterSearch').value.trim(),
  };
}

function renderManagerTable(filtered) {
  const tbody = el('managerTableBody');
  const table = el('managerTable');
  const emptyState = el('managerEmptyState');
  tbody.innerHTML = '';

  if (!filtered.length) {
    table.classList.add('hidden');
    emptyState.classList.add('visible');
    return;
  }
  table.classList.remove('hidden');
  emptyState.classList.remove('visible');

  [...filtered]
    .sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''))
    .forEach((f) => tbody.appendChild(buildFailureRow(f, false)));
}

function buildDateRange(fromStr, toStr) {
  const to = toStr ? new Date(`${toStr}T00:00:00`) : new Date();
  const from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(to.getTime() - 29 * 86400000);
  const days = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end && days.length < 366) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// Integer-friendly axis ticks: pick a step that yields ~4-5 gridlines and
// leave a little headroom above the peak so the top point doesn't touch the
// frame (matches the reference design's 0..8 axis for a max of 6).
function niceTicks(maxVal) {
  const max = Math.max(1, maxVal);
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (max / s <= 4) { step = s; break; }
  }
  let niceMax = Math.ceil(max / step) * step;
  if (niceMax === max) niceMax += step; // headroom
  const ticks = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v));
  return { niceMax, ticks };
}

function renderTrendChart(filtered) {
  const container = el('trendChart');
  const days = buildDateRange(state.filters.from, state.filters.to);
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const beforeCounts = new Map(days.map((d) => [dayKey(d), 0]));
  const afterCounts = new Map(days.map((d) => [dayKey(d), 0]));
  filtered.forEach((f) => {
    if (!f.Timestamp) return;
    const key = f.Timestamp.slice(0, 10);
    const map = f._category === 'before' ? beforeCounts : afterCounts;
    if (map.has(key)) map.set(key, map.get(key) + 1);
  });

  // viewBox is sized close to the full-width display so it scales ~1:1 (a
  // narrow viewBox would magnify everything, making the chart absurdly tall).
  const width = 1120;
  const height = 320;
  const padL = 40;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const dayData = days.map((d) => {
    const before = beforeCounts.get(dayKey(d));
    const after = afterCounts.get(dayKey(d));
    return {
      date: d,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      before,
      after,
      total: before + after,
    };
  });
  // Two separate lines, so the tallest point is the largest daily count in
  // either series (not the stacked total).
  const { niceMax, ticks } = niceTicks(Math.max(1, ...dayData.map((x) => Math.max(x.before, x.after))));

  const slotW = plotW / days.length;
  const xCenter = (i) => padL + (i + 0.5) * slotW;
  const yFor = (v) => padT + plotH - (v / niceMax) * plotH;

  // Horizontal dashed gridlines + y-axis value labels.
  const yGrid = ticks.map((t) => {
    const y = yFor(t).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--gridline)" stroke-width="1" stroke-dasharray="4 4" />`
      + `<text x="${padL - 8}" y="${(yFor(t) + 3.5).toFixed(1)}" font-size="10" fill="var(--text-muted)" text-anchor="end">${t}</text>`;
  }).join('');

  // X-axis date labels at spaced intervals.
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const xLabels = dayData.map((x, i) => {
    if (i % labelEvery !== 0 && i !== days.length - 1) return '';
    return `<text x="${xCenter(i).toFixed(1)}" y="${height - 8}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${escapeHtml(x.label)}</text>`;
  }).join('');

  // Two lines: Before (blue) and After (orange), with a small dot at each
  // data point so single-day values remain visible even on flat runs.
  const lineFor = (key, color) => {
    const points = dayData.map((x, i) => `${xCenter(i).toFixed(1)},${yFor(x[key]).toFixed(1)}`).join(' ');
    const dots = dayData.map((x, i) => `<circle cx="${xCenter(i).toFixed(1)}" cy="${yFor(x[key]).toFixed(1)}" r="3" fill="${color}" />`).join('');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />${dots}`;
  };
  const lines = lineFor('before', 'var(--cat-self)') + lineFor('after', 'var(--cat-fish)');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Failures over time (before vs. after processing)" preserveAspectRatio="xMidYMid meet">
      ${yGrid}
      <rect class="bar-hover" x="0" y="${padT}" width="0" height="${plotH}" rx="4" fill="var(--accent-wash)" style="display:none" />
      ${lines}
      ${xLabels}
    </svg>
    <div class="trend-tooltip" hidden></div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:var(--cat-self)"></span>Before Processing</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--cat-fish)"></span>After Processing</span>
    </div>
  `;

  const svg = container.querySelector('svg');
  const tooltip = container.querySelector('.trend-tooltip');
  const hoverBand = svg.querySelector('.bar-hover');

  const onMove = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((vbX - padL) / slotW);
    if (i < 0 || i >= dayData.length) { onLeave(); return; }
    const x = dayData[i];

    hoverBand.setAttribute('x', (xCenter(i) - slotW / 2).toFixed(1));
    hoverBand.setAttribute('width', slotW.toFixed(1));
    hoverBand.style.display = '';

    tooltip.innerHTML = `
      <div class="tt-date">${escapeHtml(x.label)}</div>
      <div class="tt-row"><span class="tt-dot" style="background:var(--cat-self)"></span>Before Processing<span class="tt-val">${x.before}</span></div>
      <div class="tt-row"><span class="tt-dot" style="background:var(--cat-fish)"></span>After Processing<span class="tt-val">${x.after}</span></div>
      <div class="tt-row tt-total">Total<span class="tt-val">${x.total}</span></div>`;
    tooltip.hidden = false;
    const pxX = (xCenter(i) / width) * rect.width;
    const ttW = tooltip.offsetWidth;
    let left = pxX + 14;
    if (left + ttW > rect.width) left = pxX - ttW - 14;
    tooltip.style.left = `${Math.max(4, left)}px`;
    tooltip.style.top = '14px';
  };
  const onLeave = () => {
    tooltip.hidden = true;
    hoverBand.style.display = 'none';
  };
  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', onLeave);
}

function renderBreakdownChart(filtered) {
  const container = el('breakdownChart');
  const counts = new Map();
  const catCounts = new Map();
  filtered.forEach((f) => {
    const type = f.FailureType || '(none)';
    counts.set(type, (counts.get(type) || 0) + 1);
    const cats = catCounts.get(type) || { before: 0, after: 0 };
    cats[f._category === 'before' ? 'before' : 'after'] += 1;
    catCounts.set(type, cats);
  });
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    container.innerHTML = '<p class="chart-empty">No data for the current filters.</p>';
    return;
  }

  // Wide viewBox so it scales ~1:1 at full-width display (matches trend chart).
  const width = 1120;
  const rowHeight = 34;
  const padTop = 8;
  const padL = 8;
  const labelWidth = 280;
  const padR = 44;
  const padBottom = 28;
  const plotX0 = padL + labelWidth;
  const plotX1 = width - padR;
  const plotW = plotX1 - plotX0;
  const height = padTop + entries.length * rowHeight + padBottom;
  const plotBottom = padTop + entries.length * rowHeight;
  const { niceMax, ticks } = niceTicks(Math.max(...entries.map(([, c]) => c)));
  const xScale = (v) => plotX0 + (v / niceMax) * plotW;
  const truncate = (s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

  // X-axis dashed gridlines + tick labels.
  const xGrid = ticks.map((t) => {
    const x = xScale(t).toFixed(1);
    return `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${plotBottom}" stroke="var(--gridline)" stroke-width="1" stroke-dasharray="4 4" />`
      + `<text x="${x}" y="${height - 8}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${t}</text>`;
  }).join('');

  const rows = entries.map(([type, count], i) => {
    const y = padTop + i * rowHeight;
    const barY = y + 6;
    const barH = rowHeight - 12;
    const barW = Math.max(3, xScale(count) - plotX0);
    const cats = catCounts.get(type);
    const color = cats.after > cats.before ? 'var(--cat-fish)' : 'var(--cat-self)';
    return `
      <rect class="bd-track" x="${plotX0}" y="${barY.toFixed(1)}" width="${plotW}" height="${barH}" rx="5" fill="var(--page-plane)" opacity="0" />
      <text x="${plotX0 - 10}" y="${(y + rowHeight / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-secondary)" text-anchor="end">${escapeHtml(truncate(type))}<title>${escapeHtml(type)}</title></text>
      <rect x="${plotX0}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH}" rx="5" fill="${color}" />
      <text x="${(plotX0 + barW + 8).toFixed(1)}" y="${(y + rowHeight / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-secondary)">${count}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Failure type breakdown" preserveAspectRatio="xMidYMid meet">
      ${xGrid}
      ${rows}
    </svg>
    <div class="trend-tooltip" hidden></div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:var(--cat-self)"></span>Mostly Before Processing</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--cat-fish)"></span>Mostly After Processing</span>
    </div>
  `;

  // Row hover highlight + tooltip.
  const svg = container.querySelector('svg');
  const tooltip = container.querySelector('.trend-tooltip');
  const tracks = Array.from(svg.querySelectorAll('.bd-track'));

  const onMove = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const vbY = ((e.clientY - rect.top) / rect.height) * height;
    const i = Math.floor((vbY - padTop) / rowHeight);
    tracks.forEach((t, k) => { t.setAttribute('opacity', k === i ? '1' : '0'); });
    if (i < 0 || i >= entries.length) { tooltip.hidden = true; return; }
    const [type, count] = entries[i];
    const cats = catCounts.get(type);
    tooltip.innerHTML = `
      <div class="tt-date">${escapeHtml(type)}</div>
      <div class="tt-row"><span class="tt-dot" style="background:var(--cat-self)"></span>Before Processing<span class="tt-val">${cats.before}</span></div>
      <div class="tt-row"><span class="tt-dot" style="background:var(--cat-fish)"></span>After Processing<span class="tt-val">${cats.after}</span></div>
      <div class="tt-row tt-total">Total<span class="tt-val">${count}</span></div>`;
    tooltip.hidden = false;
    const ttW = tooltip.offsetWidth;
    const pxX = e.clientX - rect.left;
    let left = pxX + 14;
    if (left + ttW > rect.width) left = pxX - ttW - 14;
    tooltip.style.left = `${Math.max(4, left)}px`;
    const rowPxY = ((padTop + i * rowHeight) / height) * rect.height;
    tooltip.style.top = `${rowPxY}px`;
  };
  const onLeave = () => {
    tooltip.hidden = true;
    tracks.forEach((t) => t.setAttribute('opacity', '0'));
  };
  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', onLeave);
}

function renderManagerView() {
  const filtered = getFilteredFailures();
  const pending = filtered.filter((f) => (f.RecollectionStatus || 'Pending') !== 'Resolved').length;
  const resolved = filtered.length - pending;

  animateStatValue(document.querySelector('[data-mgr-stat="total"]'), filtered.length);
  animateStatValue(document.querySelector('[data-mgr-stat="pending"]'), pending);
  animateStatValue(document.querySelector('[data-mgr-stat="resolved"]'), resolved);

  renderTrendChart(filtered);
  renderBreakdownChart(filtered);
  renderManagerTable(filtered);
}

document.querySelectorAll('.report-failure-btn').forEach((btn) => {
  btn.addEventListener('click', () => openReportModal());
});
el('reportCategory').addEventListener('change', () => {
  populateFailureTypeSelect(el('reportCategory').value);
  updateReasonRequiredHint();
});
el('roleWetLab').addEventListener('click', () => setRole('wetlab'));
el('roleCoordinator').addEventListener('click', () => setRole('coordinator'));
el('roleManager').addEventListener('click', () => setRole('manager'));

['filterFrom', 'filterTo', 'filterCategory', 'filterStatus'].forEach((id) => {
  el(id).addEventListener('change', () => { readFiltersFromUI(); renderManagerView(); });
});
el('filterSearch').addEventListener('input', () => { readFiltersFromUI(); renderManagerView(); });
el('filterReset').addEventListener('click', () => {
  el('filterFrom').value = '';
  el('filterTo').value = '';
  el('filterCategory').value = 'all';
  el('filterStatus').value = 'all';
  el('filterSearch').value = '';
  readFiltersFromUI();
  renderManagerView();
});
el('reportModalCancel').addEventListener('click', closeReportModal);
el('reportModalClose').addEventListener('click', closeReportModal);
el('reportModalSubmit').addEventListener('click', submitReport);
el('reportBillImage').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) runOcrOnBillImage(file);
});
el('reportFailureType').addEventListener('change', updateReasonRequiredHint);

renderRoleUI();
fetchFailures();
checkGoogleStatus();
setInterval(fetchFailures, REFRESH_INTERVAL_MS);
