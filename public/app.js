const REFRESH_INTERVAL_MS = 60000;

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
  document.querySelector('.dashboard-grid').hidden = isManager;
  el('managerView').hidden = !isManager;
  if (isManager) renderManagerView();
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
  renderCategory(category);
  if (state.role === 'manager') renderManagerView();

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
    renderCategory(category);
    if (state.role === 'manager') renderManagerView();
    toast(err.message, 'error');
  }
}

function renderCategory(category) {
  const list = state.failures[category] || [];
  const now = new Date();
  const today = list.filter((f) => isSameLocalDay(f.Timestamp, now)).length;

  animateStatValue(document.querySelector(`[data-stat="${category}-total"]`), list.length);
  animateStatValue(document.querySelector(`[data-stat="${category}-today"]`), today);

  const tbody = document.querySelector(`[data-body="${category}"]`);
  const table = document.querySelector(`[data-table="${category}"]`);
  const emptyState = document.querySelector(`[data-empty="${category}"]`);
  tbody.innerHTML = '';

  if (!list.length) {
    table.classList.add('hidden');
    emptyState.classList.add('visible');
    return;
  }
  table.classList.remove('hidden');
  emptyState.classList.remove('visible');

  [...list].reverse().forEach((f) => {
    const tr = document.createElement('tr');
    [
      formatTimestamp(f.Timestamp),
      f.SampleID,
      f.OrderID,
      f.PatientName,
      f.HospitalName,
      f.TestName,
      f.FailureType,
      f.Reason,
      f.ReportedBy,
    ].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value || '';
      tr.appendChild(td);
    });

    tr.appendChild(buildImagesCell(f));
    tr.appendChild(buildRecollectionCell(category, f, true));

    tbody.appendChild(tr);
  });
}

function renderDashboard() {
  renderCategory('before');
  renderCategory('after');
}

async function fetchFailures() {
  try {
    const res = await fetch('/api/failures');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load failures');
    state.failures = { before: data.before || [], after: data.after || [] };
    renderDashboard();
    if (state.role === 'manager') renderManagerView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function resetReportForm() {
  ['reportOrderId', 'reportSampleId', 'reportPatientName', 'reportHospitalName',
    'reportTestName', 'reportReason', 'reportNotes', 'reportReportedBy'].forEach((id) => {
    el(id).value = '';
  });
  el('reportBillImage').value = '';
  el('reportReferenceImages').value = '';
  el('reportModalError').hidden = true;
  el('reportModalError').textContent = '';
  const ocrStatus = el('ocrStatus');
  ocrStatus.hidden = true;
  ocrStatus.className = 'ocr-status';
  ocrStatus.textContent = '';
}

function parseOcrText(text) {
  const found = {};
  const norm = text.replace(/\s+/g, ' ').trim();

  const patientNo = norm.match(/patient\s*no\.?\s*([A-Za-z0-9]+)/i);
  if (patientNo) found.reportSampleId = patientNo[1];

  const billLabNo = norm.match(/bill\s*\/?\s*lab\s*no\.?\s*([A-Za-z0-9]+)\s*\/\s*([A-Za-z0-9]+)/i);
  if (billLabNo) found.reportOrderId = billLabNo[1];

  const name = norm.match(/\bname\s+([A-Za-z.\s]+?)\s*[([]/i);
  if (name) found.reportPatientName = name[1].trim();

  const panelRegion = norm.match(/bill\s*user\s+\S+\s+(.*?)\s*(?:#|test\s*code|test\s*name)/i);
  if (panelRegion) {
    const hospital = panelRegion[1]
      .replace(/pan\S*name/ig, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[^A-Za-z0-9]+/, '')
      .trim();
    if (hospital.length > 3) found.reportHospitalName = hospital;
  }

  const testRow = norm.match(/test\s*name.*?(?:total|rate)\s*(.+?)\s*(?:bill\s*amount|rate)/i);
  if (testRow) {
    const capsRuns = testRow[1].match(/[A-Z]{2,}(?:[\s-]+[A-Za-z0-9]{2,})*/g);
    if (capsRuns && capsRuns.length) {
      found.reportTestName = capsRuns
        .sort((a, b) => b.length - a.length)[0]
        .replace(/[\s\d.,]+$/, '')
        .trim();
    }
  }

  return found;
}

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
  FAILURE_TYPES[category].forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    select.appendChild(opt);
  });
}

function openReportModal(category) {
  const overlay = el('reportFailureModalOverlay');
  const badge = el('reportModalCategoryBadge');
  badge.textContent = category === 'before' ? 'Before Processing' : 'After Processing';
  badge.className = `cat-pill tone-${category === 'before' ? 'self' : 'fish'}`;
  overlay.dataset.category = category;
  resetReportForm();
  populateFailureTypeSelect(category);
  updateReasonRequiredHint();
  overlay.hidden = false;
  el('reportOrderId').focus();
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
  const overlay = el('reportFailureModalOverlay');
  const category = overlay.dataset.category;
  const errorBox = el('reportModalError');
  errorBox.hidden = true;

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
    .forEach((f) => {
      const tr = document.createElement('tr');

      const tdTimestamp = document.createElement('td');
      tdTimestamp.textContent = formatTimestamp(f.Timestamp);
      tr.appendChild(tdTimestamp);

      const tdCategory = document.createElement('td');
      const catPill = document.createElement('span');
      catPill.className = `cat-pill tone-${f._category === 'before' ? 'self' : 'fish'}`;
      catPill.textContent = f._category === 'before' ? 'Before' : 'After';
      tdCategory.appendChild(catPill);
      tr.appendChild(tdCategory);

      [
        f.SampleID, f.OrderID, f.PatientName, f.HospitalName, f.TestName, f.FailureType, f.Reason, f.ReportedBy,
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '';
        tr.appendChild(td);
      });

      tr.appendChild(buildImagesCell(f));
      tr.appendChild(buildRecollectionCell(f._category, f, false));

      tbody.appendChild(tr);
    });
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

function smoothPath(points) {
  const n = points.length;
  if (n < 2) return '';
  if (n === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }

  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] === 0 || slope[i] === 0 || slope[i - 1] * slope[i] < 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cp1x = p0.x + dx[i] / 3;
    const cp1y = p0.y + (m[i] * dx[i]) / 3;
    const cp2x = p1.x - dx[i] / 3;
    const cp2y = p1.y - (m[i + 1] * dx[i]) / 3;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
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

  const width = 640;
  const height = 220;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxCount = Math.max(1, ...days.map((d) => beforeCounts.get(dayKey(d))), ...days.map((d) => afterCounts.get(dayKey(d))));

  const xFor = (i) => padL + (days.length <= 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxCount) * plotH;
  const linePoints = (counts) => days.map((d, i) => ({ x: xFor(i), y: yFor(counts.get(dayKey(d))) }));
  const pathFor = (counts) => smoothPath(linePoints(counts));
  const areaFor = (counts) => {
    const pts = linePoints(counts);
    const baseline = yFor(0).toFixed(1);
    return `${smoothPath(pts)} L ${pts[pts.length - 1].x.toFixed(1)} ${baseline} L ${pts[0].x.toFixed(1)} ${baseline} Z`;
  };
  const pointsFor = (counts, colorVar) => days.map((d, i) => {
    const v = counts.get(dayKey(d));
    return `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3" fill="${colorVar}"><title>${escapeHtml(d.toDateString())}: ${v}</title></circle>`;
  }).join('');

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = (padT + plotH * (1 - t)).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--gridline)" stroke-width="1" />`;
  }).join('');

  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  const xLabels = days.map((d, i) => {
    if (i % labelEvery !== 0 && i !== days.length - 1) return '';
    return `<text x="${xFor(i).toFixed(1)}" y="${height - 6}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${escapeHtml(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</text>`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Failures over time">
      <defs>
        <linearGradient id="trendFillBefore" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--cat-self)" stop-opacity="0.25" />
          <stop offset="100%" stop-color="var(--cat-self)" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="trendFillAfter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--cat-fish)" stop-opacity="0.25" />
          <stop offset="100%" stop-color="var(--cat-fish)" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaFor(beforeCounts)}" fill="url(#trendFillBefore)" stroke="none" />
      <path d="${areaFor(afterCounts)}" fill="url(#trendFillAfter)" stroke="none" />
      <path d="${pathFor(beforeCounts)}" fill="none" stroke="var(--cat-self)" stroke-width="2" stroke-linecap="round" />
      <path d="${pathFor(afterCounts)}" fill="none" stroke="var(--cat-fish)" stroke-width="2" stroke-linecap="round" />
      ${pointsFor(beforeCounts, 'var(--cat-self)')}
      ${pointsFor(afterCounts, 'var(--cat-fish)')}
      ${xLabels}
    </svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch" style="background:var(--cat-self)"></span>Before Processing</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--cat-fish)"></span>After Processing</span>
    </div>
  `;
}

function renderBreakdownChart(filtered) {
  const container = el('breakdownChart');
  const counts = new Map();
  filtered.forEach((f) => {
    const type = f.FailureType || '(none)';
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    container.innerHTML = '<p class="chart-empty">No data for the current filters.</p>';
    return;
  }

  const width = 680;
  const rowHeight = 30;
  const padTop = 8;
  const padL = 8;
  const padR = 46;
  const labelWidth = 300;
  const barAreaW = width - padL - padR - labelWidth;
  const height = padTop * 2 + entries.length * rowHeight;
  const maxCount = Math.max(...entries.map(([, c]) => c));

  const bars = entries.map(([type, count], i) => {
    const y = padTop + i * rowHeight;
    const barW = Math.max(2, (count / maxCount) * barAreaW);
    const label = type.length > 46 ? `${type.slice(0, 45)}…` : type;
    return `
      <text x="${padL}" y="${(y + rowHeight / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-secondary)">${escapeHtml(label)}<title>${escapeHtml(type)}</title></text>
      <rect x="${padL + labelWidth}" y="${(y + 5).toFixed(1)}" width="${barAreaW}" height="${rowHeight - 10}" rx="4" fill="var(--page-plane)" />
      <rect x="${padL + labelWidth}" y="${(y + 5).toFixed(1)}" width="${barW.toFixed(1)}" height="${rowHeight - 10}" rx="4" fill="url(#breakdownBarFill)"><title>${escapeHtml(type)}: ${count}</title></rect>
      <text x="${(padL + labelWidth + barW + 6).toFixed(1)}" y="${(y + rowHeight / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-secondary)">${count}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Failure type breakdown">
      <defs>
        <linearGradient id="breakdownBarFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.75" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="1" />
        </linearGradient>
      </defs>
      ${bars}
    </svg>
  `;
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
  btn.addEventListener('click', () => openReportModal(btn.dataset.category));
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
