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
  role: null,
  failures: { before: [], after: [] },
  filters: { from: '', to: '', department: 'all', client: 'all', category: 'all', failureType: 'all', status: 'all', search: '' },
  combinedFilter: 'all',
  combinedCategory: 'all',
  headerSearch: '',
};

const ROLE_LABELS = { wetlab: 'Wet Lab', coordinator: 'Coordinator', manager: 'Manager' };
const ROLE_SUBTITLES = {
  wetlab: 'Report culture failures as they happen — recollection status is updated by the Coordinator.',
  coordinator: 'Chase repeat samples with the client and mark recollections resolved once arranged.',
  manager: 'Real-time status for before/after-processing samples',
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
  before: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6l-5 9a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-5-9V2"/><path d="M9 2h6"/></svg>',
  after: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3c0 4 3 4 3 8s-3 4-3 8M18 3c0 4-3 4-3 8s3 4 3 8"/><path d="M8 7h8M8 17h8"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 4.5-5 3 3L17 11l2 3"/></svg>',
  externalLink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
};

function timeAgo(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatTimestamp(isoString);
}

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
    statusEl.title = 'Google Sheet connection status';
    if (data.authenticated && data.sheetUrl) {
      statusEl.classList.add('ok');
      statusEl.classList.remove('warn');
      textEl.append('Sheet connected');
      const link = document.createElement('a');
      link.href = data.sheetUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'sheet-status-action';
      link.appendChild(svgNode(ICONS.externalLink));
      link.appendChild(document.createTextNode('Open sheet'));
      textEl.appendChild(link);
    } else if (data.authenticated) {
      statusEl.classList.add('ok');
      statusEl.classList.remove('warn');
      textEl.append('Sheet connected');
    } else {
      statusEl.classList.add('warn');
      statusEl.classList.remove('ok');
      textEl.append('Sheet not connected');
      const link = document.createElement('a');
      link.href = '/auth/google';
      link.className = 'sheet-status-action';
      link.textContent = 'Connect now';
      textEl.appendChild(link);
    }
  } catch (err) {
    statusEl.querySelector('.sheet-status-text').textContent = 'Could not check Google Sheet status.';
  }
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
  el('userRoleName').textContent = ROLE_LABELS[state.role] || 'Wet Lab';
  el('overviewSubtitle').textContent = ROLE_SUBTITLES[state.role] || ROLE_SUBTITLES.wetlab;
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

  [f.SampleID, f.OrderID, f.PatientName, f.HospitalName, f.TestName, f.FailureType, f.Reason, f.ReportedBy, f.MailSent]
    .forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value || '';
      tr.appendChild(td);
    });

  tr.appendChild(buildImagesCell(f));
  tr.appendChild(buildRecollectionCell(f._category, f, editableRecollection));
  return tr;
}

function isResolved(f) {
  return f.RecollectionStatus === 'Resolved';
}

function driveImageSrc(link) {
  if (!link) return '';
  const match = link.match(/\/file\/d\/([^/]+)/);
  if (match) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
  return link;
}

function firstImageLink(f) {
  if (f.BillImageLink) return f.BillImageLink;
  const ref = (f.ReferenceImageLinks || '').split(';').map((s) => s.trim()).filter(Boolean)[0];
  return ref || '';
}

function buildFailureCard(f) {
  const status = isResolved(f) ? 'Resolved' : 'Pending';
  const card = document.createElement('div');
  card.className = `failure-card tone-${status.toLowerCase()} cat-${f._category === 'before' ? 'self' : 'fish'}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const icon = document.createElement('span');
  icon.className = 'failure-card-icon';
  icon.appendChild(svgNode(ICONS[f._category === 'before' ? 'before' : 'after']));
  card.appendChild(icon);

  const body = document.createElement('span');
  body.className = 'failure-card-body';

  const title = document.createElement('span');
  title.className = 'failure-card-title';
  title.textContent = `${f.PatientName || 'Unknown patient'} — ${f.FailureType || f.Reason || `Sample ${f.SampleID || f.OrderID || ''}`}`;
  body.appendChild(title);

  const subtitle = document.createElement('span');
  subtitle.className = 'failure-card-subtitle';
  subtitle.textContent = `${f.HospitalName || 'Unknown client'} · ${f.TestName || '—'}`;
  body.appendChild(subtitle);

  const meta = document.createElement('span');
  meta.className = 'failure-card-meta';
  const reporterSpan = document.createElement('span');
  reporterSpan.appendChild(svgNode(ICONS.person));
  reporterSpan.appendChild(document.createTextNode(f.ReportedBy || 'Unknown'));
  meta.appendChild(reporterSpan);
  const timeSpan = document.createElement('span');
  timeSpan.appendChild(svgNode(ICONS.clock));
  timeSpan.appendChild(document.createTextNode(timeAgo(f.Timestamp)));
  meta.appendChild(timeSpan);
  body.appendChild(meta);
  card.appendChild(body);

  const side = document.createElement('span');
  side.className = 'failure-card-side';
  const canEditRecollection = state.role === 'coordinator';
  const pill = document.createElement(canEditRecollection ? 'button' : 'span');
  if (canEditRecollection) pill.type = 'button';
  pill.className = `recollection-pill tone-${status.toLowerCase()}`;
  pill.textContent = status;
  if (canEditRecollection) {
    pill.title = status === 'Resolved' ? 'Mark as Pending' : 'Mark as Resolved';
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRecollection(f._category, f.rowNumber, status);
    });
  }
  side.appendChild(pill);
  const chevron = document.createElement('span');
  chevron.className = 'chevron-btn';
  chevron.appendChild(svgNode(ICONS.chevron));
  side.appendChild(chevron);
  card.appendChild(side);

  card.addEventListener('click', () => openDetailModal(f));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetailModal(f);
    }
  });
  return card;
}

function renderLatestFailure(all) {
  const container = el('latestFailureCard');
  container.innerHTML = '';
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'latest-empty';
    empty.appendChild(svgNode(ICONS.photo));
    const p = document.createElement('p');
    p.textContent = 'No failures reported yet.';
    empty.appendChild(p);
    container.appendChild(empty);
    return;
  }
  const latest = [...all].sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''))[0];
  const imgLink = firstImageLink(latest);

  const frame = document.createElement('div');
  frame.className = 'latest-image-frame';
  if (imgLink) {
    const img = document.createElement('img');
    img.src = driveImageSrc(imgLink);
    img.alt = `Bill/reference image for sample ${latest.SampleID || latest.OrderID || ''}`;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      frame.classList.add('latest-empty');
      img.remove();
      frame.prepend(svgNode(ICONS.photo));
    }, { once: true });
    frame.appendChild(img);
  } else {
    frame.classList.add('latest-empty');
    frame.appendChild(svgNode(ICONS.photo));
  }
  const badge = document.createElement('span');
  badge.className = 'latest-live-badge';
  badge.textContent = latest._category === 'before' ? 'Before Processing' : 'After Processing';
  frame.appendChild(badge);
  container.appendChild(frame);

  const caption = document.createElement('div');
  caption.className = 'latest-caption';
  const captionTitle = document.createElement('div');
  captionTitle.className = 'latest-caption-title';
  captionTitle.textContent = latest.PatientName || latest.SampleID || 'Unnamed sample';
  caption.appendChild(captionTitle);
  const captionMeta = document.createElement('div');
  captionMeta.className = 'latest-caption-meta';
  captionMeta.textContent = `${latest.TestName || latest.FailureType || 'Culture failure'} · ${timeAgo(latest.Timestamp)}`;
  caption.appendChild(captionMeta);

  const links = document.createElement('div');
  links.className = 'latest-caption-links';
  const viewLink = document.createElement('a');
  viewLink.className = 'link';
  viewLink.href = '#';
  viewLink.textContent = 'View details';
  viewLink.addEventListener('click', (e) => { e.preventDefault(); openDetailModal(latest); });
  links.appendChild(viewLink);
  if (imgLink) {
    const openLink = document.createElement('a');
    openLink.className = 'link';
    openLink.href = imgLink;
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.textContent = 'Open image';
    links.appendChild(openLink);
  }
  caption.appendChild(links);
  container.appendChild(caption);
}

function matchesCombinedFilters(f) {
  if (state.combinedCategory !== 'all' && f._category !== state.combinedCategory) return false;
  if (state.headerSearch) {
    const haystack = [
      f.Reason, f.FailureType, f.TestName, f.PatientName, f.HospitalName, f.SampleID, f.OrderID,
    ].join(' ').toLowerCase();
    if (!haystack.includes(state.headerSearch.toLowerCase())) return false;
  }
  return true;
}

function sortFailuresForRole(a, b) {
  if (state.role === 'coordinator') {
    const aResolved = isResolved(a) ? 1 : 0;
    const bResolved = isResolved(b) ? 1 : 0;
    if (aResolved !== bResolved) return aResolved - bResolved;
  }
  return (b.Timestamp || '').localeCompare(a.Timestamp || '');
}

function renderCombined() {
  const showLatestPanel = state.role === 'coordinator';
  el('overviewGrid').classList.toggle('single-column', !showLatestPanel);
  el('latestPanel').hidden = !showLatestPanel;

  const all = getAllFailuresFlat();
  const pendingCount = all.filter((f) => !isResolved(f)).length;
  const resolvedCount = all.filter(isResolved).length;
  animateStatValue(document.querySelector('[data-combined-stat="total"]'), all.length);
  animateStatValue(document.querySelector('[data-combined-stat="pending"]'), pendingCount);
  animateStatValue(document.querySelector('[data-combined-stat="resolved"]'), resolvedCount);

  const pendingAnnex = document.querySelector('[data-combined-annex="pending"]');
  pendingAnnex.hidden = pendingCount === 0;
  const progressBar = document.querySelector('[data-combined-progress="resolved"]');
  progressBar.style.width = all.length ? `${Math.round((resolvedCount / all.length) * 100)}%` : '0%';

  document.querySelectorAll('[data-combined-filter]').forEach((card) => {
    card.classList.toggle('active', card.dataset.combinedFilter === state.combinedFilter);
  });

  let filtered = state.combinedFilter === 'pending'
    ? all.filter((f) => !isResolved(f))
    : state.combinedFilter === 'resolved'
      ? all.filter(isResolved)
      : all;
  filtered = filtered.filter(matchesCombinedFilters);

  const list = el('combinedCardList');
  const emptyState = el('combinedEmptyState');
  list.innerHTML = '';

  if (!filtered.length) {
    list.hidden = true;
    emptyState.classList.add('visible');
    emptyState.querySelector('p').textContent = all.length
      ? 'No failures match the current filters.'
      : 'No failures reported yet.';
  } else {
    list.hidden = false;
    emptyState.classList.remove('visible');
    [...filtered]
      .sort(sortFailuresForRole)
      .forEach((f) => list.appendChild(buildFailureCard(f)));
  }

  if (showLatestPanel) renderLatestFailure(all);
}

function exportCSV(list, filename) {
  const columns = ['Timestamp', 'Category', 'SampleID', 'OrderID', 'PatientName', 'HospitalName', 'TestName', 'BillDate', 'FailureType', 'Reason', 'ReportedBy', 'MailSent', 'RecollectionStatus', 'BillImageLink', 'ReferenceImageLinks'];
  const escapeCsv = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = list.map((f) => columns.map((c) => escapeCsv(c === 'Category' ? (f._category === 'before' ? 'Before Processing' : 'After Processing') : f[c])).join(','));
  const csv = [columns.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildDetailField(label, value, full) {
  const wrap = document.createElement('div');
  wrap.className = full ? 'detail-field full' : 'detail-field';
  const l = document.createElement('div');
  l.className = 'detail-field-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'detail-field-value';
  v.textContent = value || '—';
  wrap.appendChild(l);
  wrap.appendChild(v);
  return wrap;
}

function openDetailModal(f) {
  el('detailModalTitle').textContent = `${f.TestName || f.FailureType || 'Culture failure'} — ${f.SampleID || f.OrderID || ''}`;
  const body = el('detailModalBody');
  body.innerHTML = '';

  const patientHeading = document.createElement('div');
  patientHeading.className = 'detail-patient-name';
  patientHeading.textContent = f.PatientName || 'Unknown patient';
  body.appendChild(patientHeading);

  const status = isResolved(f) ? 'Resolved' : 'Pending';
  const recollectionRow = document.createElement('div');
  recollectionRow.className = 'detail-recollection';
  const catPill = document.createElement('span');
  catPill.className = `cat-pill tone-${f._category === 'before' ? 'self' : 'fish'}`;
  catPill.textContent = f._category === 'before' ? 'Before Processing' : 'After Processing';
  recollectionRow.appendChild(catPill);
  const canEditRecollection = state.role === 'coordinator';
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = `recollection-pill tone-${status.toLowerCase()}`;
  pill.textContent = status;
  if (canEditRecollection) {
    pill.addEventListener('click', () => {
      toggleRecollection(f._category, f.rowNumber, status);
      closeDetailModal();
    });
  } else {
    pill.disabled = true;
    pill.title = 'Only the Coordinator can update recollection status';
  }
  recollectionRow.appendChild(pill);
  body.appendChild(recollectionRow);

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  grid.appendChild(buildDetailField('Timestamp', formatTimestamp(f.Timestamp)));
  grid.appendChild(buildDetailField('Sample ID', f.SampleID));
  grid.appendChild(buildDetailField('Order ID', f.OrderID));
  grid.appendChild(buildDetailField('Hospital Name', f.HospitalName));
  grid.appendChild(buildDetailField('Test Name', f.TestName));
  grid.appendChild(buildDetailField('Bill Date', f.BillDate));
  grid.appendChild(buildDetailField('Failure Type', f.FailureType));
  grid.appendChild(buildDetailField('Reported By', f.ReportedBy));
  grid.appendChild(buildDetailField('Mail Sent', f.MailSent));
  grid.appendChild(buildDetailField('Reason', f.Reason, true));
  body.appendChild(grid);

  const imageLinks = [];
  if (f.BillImageLink) imageLinks.push({ href: f.BillImageLink, label: 'Bill' });
  (f.ReferenceImageLinks || '').split(';').map((s) => s.trim()).filter(Boolean).forEach((href, i) => {
    imageLinks.push({ href, label: `Ref ${i + 1}` });
  });
  if (imageLinks.length) {
    const imagesLabel = document.createElement('div');
    imagesLabel.className = 'detail-field-label';
    imagesLabel.textContent = 'Images';
    body.appendChild(imagesLabel);
    const imagesWrap = document.createElement('div');
    imagesWrap.className = 'detail-images';
    imageLinks.forEach((l) => {
      const a = document.createElement('a');
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'detail-image-thumb';
      a.title = l.label;
      const img = document.createElement('img');
      img.src = driveImageSrc(l.href);
      img.alt = l.label;
      img.referrerPolicy = 'no-referrer';
      a.appendChild(img);
      imagesWrap.appendChild(a);
    });
    body.appendChild(imagesWrap);
  }

  el('detailModalOverlay').hidden = false;
}

function closeDetailModal() {
  el('detailModalOverlay').hidden = true;
}

async function fetchFailures() {
  try {
    const res = await fetch('/api/failures');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load failures');
    state.failures = { before: data.before || [], after: data.after || [] };
    refreshManagerFilterOptions();
    renderActiveView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function resetReportForm() {
  ['reportOrderId', 'reportSampleId', 'reportPatientName', 'reportHospitalName',
    'reportTestName', 'reportBillDate', 'reportReason', 'reportNotes', 'reportReportedBy'].forEach((id) => {
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

  const visitDate = norm.match(/visit\s*date\s*[:\-]?\s*(\d{1,2}[-/][A-Za-z0-9]{2,9}[-/]\d{2,4})/i);
  if (visitDate) found.reportBillDate = visitDate[1];

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
    billDate: el('reportBillDate').value.trim(),
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

function getAllFailuresFlat() {
  const before = (state.failures.before || []).map((f) => ({ ...f, _category: 'before' }));
  const after = (state.failures.after || []).map((f) => ({ ...f, _category: 'after' }));
  return [...before, ...after];
}

const DEPARTMENT_RULES = [
  ['NIPS', /nips/i],
  ['Karyotyping', /karyotyp/i],
  ['Onco/NGS', /onco|ngs|cancer/i],
  ['Covid', /covid/i],
  ['Microarray', /microarray/i],
  ['FISH', /\bfish\b|her2/i],
  ['PCR/Molecular', /pcr|hcv|flu/i],
];

function deriveDepartment(f) {
  const text = `${f.TestName || ''} ${f.FailureType || ''}`;
  const hit = DEPARTMENT_RULES.find(([, re]) => re.test(text));
  return hit ? hit[0] : 'Other';
}

function matchesFilters(f) {
  const { from, to, category, status, search, department, client, failureType } = state.filters;
  if (category !== 'all' && f._category !== category) return false;
  if (status !== 'all' && (f.RecollectionStatus || 'Pending') !== status) return false;
  if (department && department !== 'all' && deriveDepartment(f) !== department) return false;
  if (client && client !== 'all' && (f.HospitalName || '') !== client) return false;
  if (failureType && failureType !== 'all' && (f.FailureType || '') !== failureType) return false;
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
    department: el('filterDepartment').value,
    client: el('filterClient').value,
    category: el('filterCategory').value,
    failureType: el('filterFailureType').value,
    status: el('filterStatus').value,
    search: el('filterSearch').value.trim(),
  };
}

function populateSelectOptions(select, values) {
  const previous = select.value;
  select.innerHTML = '<option value="all">All</option>';
  values.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
  select.value = values.includes(previous) ? previous : 'all';
}

function refreshManagerFilterOptions() {
  const all = getAllFailuresFlat();
  const departments = [...new Set(all.map(deriveDepartment))].sort();
  const clients = [...new Set(all.map((f) => f.HospitalName).filter(Boolean))].sort();
  const failureTypes = [...new Set(all.map((f) => f.FailureType).filter(Boolean))].sort();
  populateSelectOptions(el('filterDepartment'), departments);
  populateSelectOptions(el('filterClient'), clients);
  populateSelectOptions(el('filterFailureType'), failureTypes);
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

function niceTicks(maxVal) {
  const max = Math.max(1, maxVal);
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (max / s <= 4) { step = s; break; }
  }
  let niceMax = Math.ceil(max / step) * step;
  if (niceMax === max) niceMax += step;
  const ticks = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v));
  return { niceMax, ticks };
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

  renderBreakdownChart(filtered);
  renderManagerTable(filtered);
}

document.querySelectorAll('.report-failure-btn').forEach((btn) => {
  btn.addEventListener('click', () => openReportModal());
});
document.querySelectorAll('[data-combined-filter]').forEach((card) => {
  card.addEventListener('click', () => {
    const filter = card.dataset.combinedFilter;
    state.combinedFilter = state.combinedFilter === filter ? 'all' : filter;
    renderCombined();
  });
});
el('reportCategory').addEventListener('change', () => {
  populateFailureTypeSelect(el('reportCategory').value);
  updateReasonRequiredHint();
});
el('logoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
});

['filterFrom', 'filterTo', 'filterDepartment', 'filterClient', 'filterCategory', 'filterFailureType', 'filterStatus'].forEach((id) => {
  el(id).addEventListener('change', () => { readFiltersFromUI(); renderManagerView(); });
});
el('filterSearch').addEventListener('input', () => { readFiltersFromUI(); renderManagerView(); });
el('filterReset').addEventListener('click', () => {
  el('filterFrom').value = '';
  el('filterTo').value = '';
  el('filterDepartment').value = 'all';
  el('filterClient').value = 'all';
  el('filterCategory').value = 'all';
  el('filterFailureType').value = 'all';
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

el('headerSearch').addEventListener('input', (e) => {
  state.headerSearch = e.target.value.trim();
  if (state.role !== 'manager') renderCombined();
});
el('combinedFilterToggle').addEventListener('click', () => {
  el('combinedFilterBar').hidden = !el('combinedFilterBar').hidden;
});
el('combinedCategoryFilter').addEventListener('change', (e) => {
  state.combinedCategory = e.target.value;
  renderCombined();
});
el('combinedFilterReset').addEventListener('click', () => {
  state.combinedCategory = 'all';
  el('combinedCategoryFilter').value = 'all';
  el('headerSearch').value = '';
  state.headerSearch = '';
  renderCombined();
});
el('combinedExportBtn').addEventListener('click', () => {
  const all = getAllFailuresFlat().filter(matchesCombinedFilters);
  exportCSV(all, 'culture-failures.csv');
});
el('managerExportBtn').addEventListener('click', () => {
  exportCSV(getFilteredFailures(), 'culture-failures-filtered.csv');
});
el('detailModalClose').addEventListener('click', closeDetailModal);
el('detailModalOverlay').addEventListener('click', (e) => {
  if (e.target === el('detailModalOverlay')) closeDetailModal();
});

el('todayDateLabel').textContent = new Date().toLocaleDateString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
});

async function initSession() {
  try {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    if (!data.role) {
      window.location.href = '/login.html';
      return;
    }
    state.role = data.role;
  } catch {
    window.location.href = '/login.html';
    return;
  }
  renderRoleUI();
  fetchFailures();
  checkGoogleStatus();
  setInterval(fetchFailures, REFRESH_INTERVAL_MS);
}

initSession();
