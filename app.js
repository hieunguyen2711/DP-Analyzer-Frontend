// ── Navbar tab switching ───────────────────────────────────────────────────
const mainContainer = document.querySelector('.container');

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    const tab = link.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
    document.getElementById('tab-' + tab).classList.remove('hidden');

    // Widen container for dashboard-style tabs
    if (tab === 'scoring') {
      mainContainer.classList.add('scoring-wide');
      mainContainer.classList.remove('obf-wide');
    } else if (tab === 'obfuscated') {
      mainContainer.classList.add('obf-wide');
      mainContainer.classList.remove('scoring-wide');
      loadObfuscatedData();
    } else {
      mainContainer.classList.remove('scoring-wide', 'obf-wide');
    }
  });
});

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const fileNameLabel = document.getElementById('file-name');
const submitBtn = document.getElementById('submit-btn');
const chatMessages = document.getElementById('chat-messages');
const chatPlaceholder = document.getElementById('chat-placeholder');

const generateForm = document.getElementById('generate-form');
const patternSelect = document.getElementById('pattern-select');
const generateContext = document.getElementById('generate-context');
const generateBtn = document.getElementById('generate-btn');
const generateResponseBox = document.getElementById('generate-response-box');
const createFilesBtn = document.getElementById('create-files-btn');
const startMetricsBtn = document.getElementById('start-metrics-btn');
const downloadBundleBtn = document.getElementById('download-bundle-btn');

let lastGeneratedFiles = [];
let lastPattern = '';
let lastDescription = '';
let lastBatchJobId = '';
let lastBatchBundleFilename = 'generated_projects_bundle.zip';
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatForm = document.getElementById('chat-form');

let lastAnalysis = '';

const API_BASE_URL = 'http://localhost:8000';
const BATCH_GENERATE_MODEL = 'qwen3-coder-30b-a3b-instruct';
const BATCH_GENERATE_CONCURRENCY = 1;
const BATCH_POLL_INTERVAL_MS = 2500;

// ── Chat helpers ───────────────────────────────────────────────────────────
function appendBubble(html, role, state = '') {
  if (chatPlaceholder) chatPlaceholder.remove();
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}${state ? ' ' + state : ''}`;
  bubble.innerHTML = html;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function enableChat() {
  chatInput.disabled = false;
  chatSendBtn.disabled = false;
  chatInput.focus();
}

// ── File selection via Browse ──────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  handleFile(fileInput.files[0]);
});

// ── Drag & drop ────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) {
    fileInput.files = e.dataTransfer.files; // sync with input
    handleFile(file);
  }
});

// ── Handle selected file ───────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;

  if (!file.name.endsWith('.zip')) {
    appendBubble('Please select a valid .zip file.', 'ai', 'error');
    fileNameLabel.textContent = 'No file selected';
    fileNameLabel.classList.remove('has-file');
    submitBtn.disabled = true;
    return;
  }

  fileNameLabel.textContent = file.name;
  fileNameLabel.classList.add('has-file');
  submitBtn.disabled = false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeServerError(status, statusText, bodyText = '') {
  return new Error(`Server error: ${status} ${statusText}${bodyText ? ` — ${bodyText}` : ''}`);
}

function openTab(tabName) {
  const targetLink = document.querySelector(`.nav-link[data-tab="${tabName}"]`);
  if (targetLink) targetLink.click();
}

async function packageGeneratedFiles(pattern, description, files) {
  const response = await fetch(`${API_BASE_URL}/package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pattern,
      description,
      files: files.map(f => ({
        filename: f.filename ?? f.name ?? 'File.java',
        content: f.content ?? f.code ?? '',
      })),
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw makeServerError(response.status, response.statusText, errBody);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch ? filenameMatch[1] : 'design-pattern.zip';
  return { blob, filename };
}

async function requestMetricsFromGenerateInput(pattern, projectContext, files) {
  const { blob, filename } = await packageGeneratedFiles(pattern, projectContext, files);

  const formData = new FormData();
  formData.append('file', blob, filename);

  const response = await fetch(`${API_BASE_URL}/api/v1/analyze-metrics`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw makeServerError(response.status, response.statusText, errBody);
  }

  return response.json();
}

function extractBundleFilename(statusData) {
  const relativePath = String(statusData?.final_bundle_relative_path ?? '').trim();
  if (!relativePath) return 'generated_projects_bundle.zip';
  const parts = relativePath.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'generated_projects_bundle.zip';
}

function renderBatchProgress(statusData, subtext = '') {
  const total = statusData?.total_patterns ?? 0;
  const completed = statusData?.completed_patterns ?? 0;
  const successful = statusData?.successful_patterns ?? 0;
  const failed = statusData?.failed_patterns ?? 0;
  const status = statusData?.status ?? 'running';
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const failedHtml = failed > 0
    ? `<span style="color:#c2410c;font-weight:600;">${failed} failed</span>`
    : `${failed} failed`;

  generateResponseBox.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.65rem;">
      <div style="font-weight:600;color:#374151;">Generating pass-pattern projects (83 patterns)</div>
      <div style="font-size:0.82rem;color:#6b7280;">Job: ${escapeHtml(statusData?.job_id ?? '—')}</div>
      <div style="font-size:0.82rem;color:#6b7280;">Status: <strong style="color:#4f46e5;">${escapeHtml(String(status))}</strong> · ${completed}/${total} completed · ${successful} successful · ${failedHtml}</div>
      <div style="height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
        <div style="width:${percent}%;height:100%;background:#6366f1;transition:width 0.25s;"></div>
      </div>
      ${subtext ? `<div style="font-size:0.8rem;color:#6b7280;">${subtext}</div>` : ''}
    </div>
  `;
}

async function startBatchPassProjects(projectContext) {
  const response = await fetch(`${API_BASE_URL}/api/v1/generate-pass-projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_context: projectContext,
      model: BATCH_GENERATE_MODEL,
      concurrency: BATCH_GENERATE_CONCURRENCY,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw makeServerError(response.status, response.statusText, errBody);
  }

  const data = await response.json();
  if (!data.job_id) throw new Error('Batch generation did not return a job_id.');
  return data;
}

async function pollBatchPassProjects(jobId) {
  const normalizedJobId = encodeURIComponent(jobId);

  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const response = await fetch(`${API_BASE_URL}/api/v1/generate-pass-projects/${normalizedJobId}`);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw makeServerError(response.status, response.statusText, errBody);
    }

    const statusData = await response.json();
    renderBatchProgress(statusData);

    const status = String(statusData.status ?? '').toLowerCase();
    if (status === 'completed') return statusData;
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(`Batch generation ended with status: ${statusData.status ?? 'unknown'}`);
    }

    await sleep(BATCH_POLL_INTERVAL_MS);
  }

  throw new Error('Batch generation timed out while waiting for completion.');
}

async function downloadBatchPassProjects(jobId) {
  const normalizedJobId = encodeURIComponent(jobId);
  const response = await fetch(`${API_BASE_URL}/api/v1/generate-pass-projects/${normalizedJobId}/download`);

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw makeServerError(response.status, response.statusText, errBody);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = disposition.match(/filename="?([^\"]+)"?/);
  const filename = filenameMatch ? filenameMatch[1] : 'generated_projects_bundle.zip';
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);

  return filename;
}

// ── Generate form submit ───────────────────────────────────────────────────
generateForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const pattern = patternSelect.value;
  const description = generateContext.value.trim();

  if (!pattern || !description) return;

  generateBtn.disabled = true;
  createFilesBtn.disabled = true;
  createFilesBtn.textContent = 'Generate Java Files';
  startMetricsBtn.disabled = true;
  startMetricsBtn.textContent = 'Start Calculating Metric';
  downloadBundleBtn.hidden = true;
  lastBatchJobId = '';
  lastBatchBundleFilename = 'generated_projects_bundle.zip';
  generateResponseBox.innerHTML = '<span style="color:#6366f1;font-style:italic;">Generating…</span>';

  try {
    if (pattern === 'Select All') {
      lastGeneratedFiles = [];
      lastPattern = '';
      lastDescription = description;
      createFilesBtn.disabled = true;
      startMetricsBtn.disabled = true;

      generateResponseBox.innerHTML = '<span style="color:#6366f1;font-style:italic;">Starting async generation for all pass patterns…</span>';

      const startData = await startBatchPassProjects(description);

      renderBatchProgress(
        {
          job_id: startData.job_id,
          status: startData.status ?? 'queued',
          total_patterns: startData.total_patterns ?? 83,
          completed_patterns: 0,
          successful_patterns: 0,
          failed_patterns: 0,
        },
        'Polling job progress every 2.5s…',
      );

      const finalStatus = await pollBatchPassProjects(startData.job_id);
      renderBatchProgress(finalStatus, 'Generation completed. Bundle is ready to download.');

      lastBatchJobId = startData.job_id;
      lastBatchBundleFilename = extractBundleFilename(finalStatus);
      downloadBundleBtn.hidden = false;
      downloadBundleBtn.textContent = `Download ${lastBatchBundleFilename}`;

      generateResponseBox.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0.55rem;">
          <div style="font-weight:600;color:#15803d;">Batch generation completed</div>
          <div style="font-size:0.82rem;color:#6b7280;">${finalStatus.completed_patterns ?? 0}/${finalStatus.total_patterns ?? 83} patterns processed · ${finalStatus.successful_patterns ?? 0} successful · ${finalStatus.failed_patterns ?? 0} failed</div>
          <div style="font-size:0.82rem;color:#4b5563;">Bundle ready: <strong>${escapeHtml(lastBatchBundleFilename)}</strong>. Click the download button below.</div>
        </div>
      `;

      return;
    }

    const response = await fetch(`${API_BASE_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, description }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log('[generate] response:', data);

    if (data.error) {
      generateResponseBox.innerHTML = `<span style="color:#dc2626;">${data.error}</span>`;
      return;
    }

    if (!data.files || data.files.length === 0) {
      generateResponseBox.innerHTML = '<span style="color:#dc2626;font-style:italic;">No files returned from server.</span>';
      return;
    }

    generateResponseBox.innerHTML = data.files.map(file => `
      <div class="gen-file">
        <button type="button" class="gen-file-header" aria-expanded="false">
          <span>${file.filename ?? file.name ?? 'File'}</span>
          <svg class="gen-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="gen-file-body" style="display:none;">
          <pre class="gen-file-code"><code>${escapeHtml(file.content ?? file.code ?? '')}</code></pre>
        </div>
      </div>
    `).join('');

    createFilesBtn.disabled = false;
    startMetricsBtn.disabled = false;
    lastGeneratedFiles = data.files;
    lastPattern = pattern;
    lastDescription = description;

    generateResponseBox.querySelectorAll('.gen-file-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        btn.nextElementSibling.style.display = expanded ? 'none' : 'block';
      });
    });
  } catch (err) {
    const isCors = err.message === 'Failed to fetch';
    const msg = isCors
      ? 'Failed to fetch — CORS error. Add Access-Control-Allow-Origin: * to your backend.'
      : `Error: ${err.message}`;
    generateResponseBox.innerHTML = `<span style="color:#dc2626;">${msg}</span>`;
  } finally {
    generateBtn.disabled = false;
  }
});

// ── Create Java Files ──────────────────────────────────────────────────────
createFilesBtn.addEventListener('click', async () => {
  if (!lastGeneratedFiles.length) return;

  createFilesBtn.disabled = true;
  createFilesBtn.textContent = 'Packaging…';

  try {
    const { blob, filename } = await packageGeneratedFiles(lastPattern, lastDescription, lastGeneratedFiles);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Failed to create files: ${err.message}`);
  } finally {
    createFilesBtn.disabled = false;
    createFilesBtn.textContent = 'Generate Java Files';
  }
});

downloadBundleBtn.addEventListener('click', async () => {
  if (!lastBatchJobId) return;

  downloadBundleBtn.disabled = true;
  downloadBundleBtn.textContent = 'Downloading…';

  try {
    const downloadedFilename = await downloadBatchPassProjects(lastBatchJobId);
    lastBatchBundleFilename = downloadedFilename || lastBatchBundleFilename;
    generateResponseBox.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.55rem;">
        <div style="font-weight:600;color:#15803d;">Batch generation completed</div>
        <div style="font-size:0.82rem;color:#4b5563;">Download started: <strong>${escapeHtml(lastBatchBundleFilename)}</strong></div>
      </div>
    `;
  } catch (err) {
    const isCors = err.message === 'Failed to fetch';
    const msg = isCors
      ? 'Failed to fetch — CORS error. Add Access-Control-Allow-Origin: * to your backend.'
      : `Error: ${err.message}`;
    generateResponseBox.innerHTML = `<span style="color:#dc2626;">${msg}</span>`;
  } finally {
    downloadBundleBtn.disabled = false;
    downloadBundleBtn.textContent = `Download ${lastBatchBundleFilename}`;
  }
});

startMetricsBtn.addEventListener('click', async () => {
  if (!lastPattern || !lastDescription || !lastGeneratedFiles.length || lastPattern === 'Select All') return;

  startMetricsBtn.disabled = true;
  startMetricsBtn.textContent = 'Calculating…';

  try {
    const metricsData = await requestMetricsFromGenerateInput(lastPattern, lastDescription, lastGeneratedFiles);
    renderScoreResult(metricsData);

    const generatedLabel = `${lastPattern} (generated context)`;
    scoringFileName.textContent = generatedLabel;
    scoringFileName.classList.add('has-file');

    saveScoringHistory({
      id:       Date.now(),
      fileName: generatedLabel,
      date:     new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      mi:       metricsData.summary?.avg_mi_score     ?? null,
      ck:       metricsData.summary?.ck_overall_score ?? null,
      pattern:  metricsData.summary?.pattern_name     ?? lastPattern,
      snapshot: metricsData,
    });

    openTab('scoring');
  } catch (err) {
    const isCors = err.message === 'Failed to fetch';
    const msg = isCors
      ? 'Failed to fetch — CORS error. Add Access-Control-Allow-Origin: * to your backend.'
      : `Failed to calculate metrics: ${err.message}`;
    generateResponseBox.innerHTML = `<span style="color:#dc2626;">${msg}</span>`;
  } finally {
    startMetricsBtn.disabled = false;
    startMetricsBtn.textContent = 'Start Calculating Metric';
  }
});

// ── Scoring Dashboard ──────────────────────────────────────────────────────
const scoringForm       = document.getElementById('scoring-upload-form');
const scoringFileInput  = document.getElementById('scoring-file-input');
const scoringDropZone   = document.getElementById('scoring-drop-zone');
const scoringFileName   = document.getElementById('scoring-file-name');
const scoringSubmitBtn  = document.getElementById('scoring-submit-btn');
const miScore           = document.getElementById('mi-score');
const miBar             = document.getElementById('mi-bar');
const ckScoreEl         = document.getElementById('ck-score');
const ckBar             = document.getElementById('ck-bar');
const ckCard            = document.getElementById('ck-card');
const summaryStatsEl    = document.getElementById('summary-stats');
const halsteadSection   = document.getElementById('halstead-section');
const breakdownSection  = document.getElementById('breakdown-section');
const breakdownTbody    = document.getElementById('breakdown-tbody');
const breakdownThead    = document.getElementById('breakdown-thead');

function handleScoringFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.zip')) {
    scoringFileName.textContent = 'Please select a .zip file';
    scoringSubmitBtn.disabled = true;
    return;
  }
  scoringFileName.textContent = file.name;
  scoringFileName.classList.add('has-file');
  scoringSubmitBtn.disabled = false;
}

scoringFileInput.addEventListener('change', () => handleScoringFile(scoringFileInput.files[0]));

scoringDropZone.addEventListener('dragover', e => { e.preventDefault(); scoringDropZone.classList.add('dragover'); });
scoringDropZone.addEventListener('dragleave', () => scoringDropZone.classList.remove('dragover'));
scoringDropZone.addEventListener('drop', e => {
  e.preventDefault();
  scoringDropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) { scoringFileInput.files = e.dataTransfer.files; handleScoringFile(file); }
});
scoringDropZone.addEventListener('click', () => scoringFileInput.click());

function setMetric(scoreEl, barEl, value) {
  scoreEl.textContent = value !== null && value !== undefined ? value.toFixed(1) : '--';
  barEl.style.width   = value !== null && value !== undefined ? `${Math.min(value, 100)}%` : '0%';

  const pct  = value ?? 0;
  const isCK = barEl.classList.contains('ck');
  let colour;
  if (isCK) {
    colour = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : pct >= 40 ? '#f97316' : '#ef4444';
  } else {
    colour = pct >= 75 ? '#22c55e' : pct >= 50 ? '#eab308' : pct >= 10 ? '#f97316' : '#ef4444';
  }
  barEl.style.background = colour;
}

function scorePillClass(score) {
  return score >= 75 ? 'good' : score >= 50 ? 'moderate' : score >= 10 ? 'low' : 'poor';
}

function miStatusHtml(mi) {
  if (mi === null || mi === undefined) return '—';
  if (mi >= 75) return '<span style="color:#15803d;font-weight:600">Good</span>';
  if (mi >= 50) return '<span style="color:#854d0e;font-weight:600">Moderate</span>';
  if (mi >= 10) return '<span style="color:#c2410c;font-weight:600">Low</span>';
  return '<span style="color:#b91c1c;font-weight:600">Unmaintainable</span>';
}

function renderScoreResult(data) {
  const s = data.summary;

  // Dismiss any previous error
  document.getElementById('scoring-error-banner')?.remove();

  // Summary stats
  document.getElementById('stat-files').textContent   = s.total_files   ?? '--';
  document.getElementById('stat-classes').textContent = s.total_classes ?? '--';
  document.getElementById('stat-methods').textContent = s.total_methods ?? '--';
  document.getElementById('stat-pattern').textContent = s.pattern_name  || '—';
  summaryStatsEl.style.display = '';

  // Maintainability Index
  setMetric(miScore, miBar, s.avg_mi_score ?? null);
  const miRangeRow = document.getElementById('mi-range-row');
  const miDistEl   = document.getElementById('mi-dist');
  if (s.min_mi_score !== undefined && s.max_mi_score !== undefined) {
    document.getElementById('mi-min').textContent = s.min_mi_score.toFixed(1);
    document.getElementById('mi-max').textContent = s.max_mi_score.toFixed(1);
    miRangeRow.style.display = '';
  }
  if (s.mi_distribution) {
    document.getElementById('mi-dc-green').textContent  = s.mi_distribution.green  ?? 0;
    document.getElementById('mi-dc-yellow').textContent = s.mi_distribution.yellow ?? 0;
    document.getElementById('mi-dc-red').textContent    = s.mi_distribution.red    ?? 0;
    miDistEl.style.display = '';
  }

  // CK Quality Score
  if (s.ck_overall_score != null) {
    setMetric(ckScoreEl, ckBar, s.ck_overall_score);
    document.getElementById('ck-wmc').textContent  = s.avg_wmc       != null ? s.avg_wmc.toFixed(1)       : '—';
    document.getElementById('ck-cbo').textContent  = s.avg_cbo       != null ? s.avg_cbo.toFixed(1)       : '—';
    document.getElementById('ck-rfc').textContent  = s.avg_rfc       != null ? s.avg_rfc.toFixed(1)       : '—';
    document.getElementById('ck-dit').textContent  = s.avg_dit       != null ? s.avg_dit.toFixed(1)       : '—';
    document.getElementById('ck-lcom').textContent = s.avg_lcom_star != null ? s.avg_lcom_star.toFixed(2) : '—';
    document.getElementById('ck-tcc').textContent  = s.avg_tcc       != null ? s.avg_tcc.toFixed(2)       : '—';
    ckCard.style.display = '';
  } else {
    ckCard.style.display = 'none';
  }

  // Halstead
  document.getElementById('h-volume').textContent     = s.avg_halstead_volume     != null ? s.avg_halstead_volume.toFixed(1)     : '--';
  document.getElementById('h-difficulty').textContent = s.avg_halstead_difficulty != null ? s.avg_halstead_difficulty.toFixed(2) : '--';
  document.getElementById('h-bugs').textContent       = s.total_estimated_bugs    != null ? s.total_estimated_bugs.toFixed(3)    : '--';
  document.getElementById('h-sloc').textContent       = s.avg_sloc               != null ? s.avg_sloc.toFixed(1)               : '--';
  halsteadSection.style.display = '';

  // Per-class Breakdown
  const hasCK = Array.isArray(data.methods) && data.methods.length > 0;
  console.log('[breakdown] data.classes:', data.classes, '| hasCK:', hasCK);
  if (data.classes?.length > 0) {
    console.log('[breakdown] first class sample:', JSON.stringify(data.classes[0], null, 2));
  }
  breakdownThead.innerHTML = `<tr>
    <th>Class</th><th>File</th><th>Type</th><th>MI Score</th>
    ${hasCK ? '<th>WMC</th><th>CBO</th><th>RFC</th>' : ''}
    <th>Status</th>
  </tr>`;
  if (Array.isArray(data.classes) && data.classes.length > 0) {
    breakdownTbody.innerHTML = data.classes.map(cls => {
      // mi is a nested object — try common field names
      const miObj   = cls.mi ?? {};
      const mi      = miObj.score ?? miObj.mi_score ?? miObj.value ?? cls.mi_score ?? null;
      const pillCls = mi !== null ? scorePillClass(mi) : 'poor';

      // ck metrics are nested inside cls.ck
      const ckObj   = cls.ck ?? {};
      const ckCols  = hasCK
        ? `<td>${ckObj.wmc ?? '—'}</td><td>${ckObj.cbo ?? '—'}</td><td>${ckObj.rfc ?? '—'}</td>`
        : '';

      // file path field
      const filePath = cls.file_path ?? cls.file_name ?? cls.file ?? '—';
      // show just the filename portion to keep the cell tight
      const fileName = filePath.split('/').pop();

      return `<tr>
        <td style="font-weight:600">${escapeHtml(cls.class_name ?? cls.name ?? '—')}</td>
        <td style="color:#9ca3af;font-size:0.8rem" title="${escapeHtml(filePath)}">${escapeHtml(fileName)}</td>
        <td><span class="type-badge type-${cls.type ?? 'class'}">${cls.type ?? '—'}</span></td>
        <td><span class="score-pill ${pillCls}">${mi !== null ? mi.toFixed(1) : '—'}</span></td>
        ${ckCols}
        <td>${miStatusHtml(mi)}</td>
      </tr>`;
    }).join('');
    breakdownSection.style.display = '';
  }
}

function appendScoringError(msg) {
  // Remove any existing error banner
  document.getElementById('scoring-error-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'scoring-error-banner';
  banner.className = 'scoring-error-banner';
  banner.textContent = msg;
  // Insert above the metrics grid
  const metricsGrid = document.getElementById('metrics-grid');
  metricsGrid.parentElement.insertBefore(banner, metricsGrid);
}

scoringForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const file = scoringFileInput.files[0];
  if (!file) return;

  scoringSubmitBtn.disabled = true;
  scoringSubmitBtn.textContent = 'Analyzing…';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('http://localhost:8000/api/v1/analyze-metrics', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Server error: ${response.status} ${response.statusText}${errBody ? ' — ' + errBody : ''}`);
    }

    const data = await response.json();
    console.log('[analyze-metrics] response:', data);

    renderScoreResult(data, file.name);

    // Save to history
    saveScoringHistory({
      id:       Date.now(),
      fileName: file.name,
      date:     new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      mi:       data.summary?.avg_mi_score     ?? null,
      ck:       data.summary?.ck_overall_score ?? null,
      pattern:  data.summary?.pattern_name     ?? null,
      snapshot: data,
    });

  } catch (err) {
    const msg = err.message === 'Failed to fetch'
      ? 'Could not reach the server. Make sure the backend is running and CORS is enabled.'
      : err.message;
    appendScoringError(msg);
  } finally {
    scoringSubmitBtn.disabled = false;
    if (scoringSubmitBtn.textContent === 'Analyzing…') scoringSubmitBtn.textContent = 'Run Analysis';
  }
});

// ── Scoring History ────────────────────────────────────────────────────────
const SCORING_HISTORY_KEY = 'dp_scoring_history';

function getScoringHistory() {
  try { return JSON.parse(localStorage.getItem(SCORING_HISTORY_KEY) ?? '[]'); }
  catch { return []; }
}

function saveScoringHistory(entry) {
  const history = getScoringHistory();
  history.unshift(entry);
  if (history.length > 50) history.length = 50;
  localStorage.setItem(SCORING_HISTORY_KEY, JSON.stringify(history));
  renderScoringHistory();
}

function renderScoringHistory() {
  const list = document.getElementById('history-list');
  const history = getScoringHistory();

  if (history.length === 0) {
    list.innerHTML = '<li class="history-empty">No uploads yet.</li>';
    return;
  }

  list.innerHTML = history.map((entry, i) => `
    <li class="history-item" data-index="${i}">
      <span class="history-item-name" title="${escapeHtml(entry.fileName)}">${escapeHtml(entry.fileName)}</span>
      <span class="history-item-date">${entry.date}${entry.pattern ? ` · ${escapeHtml(entry.pattern)}` : ''}</span>
      <div class="history-item-scores">
        <span class="history-score-pill mi">MI ${entry.mi !== null && entry.mi !== undefined ? Number(entry.mi).toFixed(1) : '--'}</span>
        ${entry.ck !== null && entry.ck !== undefined ? `<span class="history-score-pill ck">CK ${Number(entry.ck).toFixed(1)}</span>` : ''}
      </div>
    </li>
  `).join('');

  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index, 10);
      loadHistoryEntry(getScoringHistory()[idx]);
      list.querySelectorAll('.history-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
    });
  });
}

function loadHistoryEntry(entry) {
  scoringFileName.textContent = entry.fileName;
  scoringFileName.classList.add('has-file');

  if (entry.snapshot) {
    renderScoreResult(entry.snapshot, entry.fileName);
  } else {
    // Fallback for entries saved before full snapshot was stored
    setMetric(miScore, miBar, entry.mi ?? null);
    if (entry.ck !== null && entry.ck !== undefined) {
      setMetric(ckScoreEl, ckBar, entry.ck);
      ckCard.style.display = '';
    } else {
      ckCard.style.display = 'none';
    }
    breakdownSection.style.display = 'none';
    halsteadSection.style.display  = 'none';
  }
}

document.getElementById('clear-history-btn').addEventListener('click', () => {
  if (confirm('Clear all upload history?')) {
    localStorage.removeItem(SCORING_HISTORY_KEY);
    renderScoringHistory();
  }
});

// Populate history list on first load
renderScoringHistory();

// ── Analyze form submit ────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  submitBtn.disabled = true;
  const loadingBubble = appendBubble('Analyzing your project…', 'ai', 'loading');

  try {
    const response = await fetch('http://localhost:8000/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const raw = data.raw_analysis ?? data.choices?.[0]?.message?.content ?? data.result ?? data.message;

    loadingBubble.remove();

    if (!raw) {
      appendBubble('No analysis returned from the server.', 'ai', 'error');
      return;
    }

    lastAnalysis = raw;

    // Extract only pattern names marked as present (✅) from the summary table
    const patterns = [];
    const tableRowRegex = /^\|([^|]+)\|[^|]*✅[^|]*\|/gm;
    let match;
    while ((match = tableRowRegex.exec(raw)) !== null) {
      const name = match[1].trim();
      if (name && !name.match(/^-+$/)) patterns.push(name);
    }

    if (patterns.length > 0) {
      const html = `
        <p style="font-size:0.8rem;color:#6b7280;margin-bottom:0.5rem;">Design pattern(s) detected:</p>
        ${patterns.map(p => `<span class="pattern-badge">${p}</span>`).join('')}
      `;
      appendBubble(html, 'ai');
    } else {
      appendBubble(renderMarkdown(raw), 'ai');
    }
    console.log("This is the raw data from the server: ",raw),

    enableChat();

  } catch (err) {
    loadingBubble.remove();
    const isCors = err.message === 'Failed to fetch';
    const msg = isCors
      ? 'Failed to fetch — this is likely a CORS error.\n\nYour backend must include the header:\n  Access-Control-Allow-Origin: *\n\nSee the browser console (F12 → Console) for the exact error.'
      : `Error: ${err.message}`;
    appendBubble(msg.replace(/\n/g, '<br>'), 'ai', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// ── Chat follow-up ─────────────────────────────────────────────────────────
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendBubble(text, 'user');
  chatInput.value = '';
  chatInput.disabled = true;
  chatSendBtn.disabled = true;

  const loadingBubble = appendBubble('Thinking…', 'ai', 'loading');

  try {
    const response = await fetch('http://localhost:8000/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis: lastAnalysis, question: text }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log('[followup] response:', data);
    const raw = data.choices?.[0]?.message?.content ?? data.answer ?? data.reply ?? data.response ?? data.result ?? data.message;
    loadingBubble.remove();
    appendBubble(raw ? renderMarkdown(raw) : 'No response from server.', 'ai', raw ? '' : 'error');
  } catch (err) {
    loadingBubble.remove();
    appendBubble(`Error: ${err.message}`, 'ai', 'error');
  } finally {
    chatInput.disabled = false;
    chatSendBtn.disabled = false;
    chatInput.focus();
  }
});

// ── Minimal Markdown → HTML renderer ──────────────────────────────────────
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdown(text) {
  return text
    // Escape HTML entities first
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Bullet list items
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    // Simple table rows (markdown pipe tables)
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split('|').map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    // Remove separator rows (|---|---|)
    .replace(/<tr>(<td>[-: ]+<\/td>)+<\/tr>\n?/g, '')
    // Wrap consecutive <tr> in <table>
    .replace(/(<tr>.*<\/tr>\n?)+/g, (match) => `<table>${match}</table>`)
    // Paragraphs: double newline → <p>
    .replace(/\n{2,}/g, '</p><p>')
    // Single newline → <br>
    .replace(/\n/g, '<br>')
    // Wrap everything in a paragraph
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    // Clean up empty paragraphs
    .replace(/<p>\s*<\/p>/g, '');
}

// ── Obfuscated Metrics Dashboard ────────────────────────────────────────────
let _obfData = null;
let _obfSortCol = 'avg_mi_score';
let _obfSortDir = 'desc';
let _obfSelectedPattern = null;

const PATTERN_ACRONYMS = new Set(['MVC', 'MVP', 'DAO', 'DTO', 'CRTP', 'RAII']);

function formatPatternLabel(pattern) {
  return String(pattern ?? '')
    .split('-')
    .filter(Boolean)
    .map(token => {
      const upperToken = token.toUpperCase();
      if (PATTERN_ACRONYMS.has(upperToken)) return upperToken;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
}

function ckScorePillClass(score) {
  return score >= 80 ? 'good' : score >= 60 ? 'moderate' : score >= 40 ? 'low' : 'poor';
}

function describeProjectScale(files, classes) {
  const size = Math.max(files ?? 0, classes ?? 0);
  if (size >= 16) return 'Large';
  if (size >= 9) return 'Medium';
  return 'Small';
}

function describeMiProfile(score) {
  if (score == null) return 'Unknown';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Moderate';
  if (score >= 10) return 'Low';
  return 'Unmaintainable';
}

function describeCkProfile(score) {
  if (score == null) return 'Unknown';
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Moderate';
  if (score >= 40) return 'Low';
  return 'Weak';
}

function describeRiskProfile(bugs) {
  if (bugs > 2) return 'Elevated';
  if (bugs > 1) return 'Moderate';
  return 'Low';
}

async function loadObfuscatedData() {
  if (_obfData) { renderObfuscated(); return; }
  try {
    const res = await fetch('obfuscated_metrics_results.json');
    if (!res.ok) throw new Error(res.statusText);
    _obfData = await res.json();
    renderObfuscated();
  } catch (err) {
    const tbody = document.getElementById('obf-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#b91c1c;padding:2rem">Failed to load data: ${err.message}</td></tr>`;
    }
    renderContextSidebar(null, 'Project context is unavailable until the dataset loads.');
  }
}

function miPillHtml(score) {
  if (score == null) return '—';
  const cls = score >= 75 ? 'good' : score >= 50 ? 'moderate' : score >= 10 ? 'low' : 'poor';
  return `<span class="score-pill ${cls}">${score.toFixed(1)}</span>`;
}

function ckPillHtml(score) {
  if (score == null) return '—';
  const cls = score >= 80 ? 'good' : score >= 60 ? 'moderate' : score >= 40 ? 'low' : 'poor';
  return `<span class="score-pill ${cls}">${score.toFixed(1)}</span>`;
}

function distBarHtml(dist) {
  const g = dist?.green  ?? 0;
  const y = dist?.yellow ?? 0;
  const r = dist?.red    ?? 0;
  const total = g + y + r || 1;
  const gPct = (g / total * 100).toFixed(1);
  const yPct = (y / total * 100).toFixed(1);
  const rPct = (r / total * 100).toFixed(1);
  return `
    <div class="obf-dist-bar" title="Good: ${g} | Moderate: ${y} | Low: ${r}">
      <div class="obf-dist-seg obf-seg-green"  style="width:${gPct}%"></div>
      <div class="obf-dist-seg obf-seg-yellow" style="width:${yPct}%"></div>
      <div class="obf-dist-seg obf-seg-red"    style="width:${rPct}%"></div>
    </div>
    <span class="obf-dist-labels"><span style="color:#15803d">${g}G</span> <span style="color:#854d0e">${y}M</span> <span style="color:#b91c1c">${r}L</span></span>
  `;
}

function renderObfuscated() {
  if (!_obfData) return;

  const query   = (document.getElementById('obf-search')?.value ?? '').toLowerCase();
  const sortCol = _obfSortCol;
  const sortDir = _obfSortDir;

  // Filter
  let rows = _obfData.filter(d => d.pattern.toLowerCase().includes(query));

  // Sort
  rows.sort((a, b) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  // Aggregate stats (over full dataset, not filtered)
  const all = _obfData;
  document.getElementById('obf-total-count').textContent   = all.length;
  document.getElementById('obf-avg-mi').textContent        = (all.reduce((s, d) => s + (d.avg_mi_score ?? 0), 0) / all.length).toFixed(1);
  document.getElementById('obf-avg-ck').textContent        = (all.reduce((s, d) => s + (d.ck_overall_score ?? 0), 0) / all.length).toFixed(1);
  document.getElementById('obf-dist-green').textContent    = all.reduce((s, d) => s + (d.mi_distribution?.green  ?? 0), 0);
  document.getElementById('obf-dist-yellow').textContent   = all.reduce((s, d) => s + (d.mi_distribution?.yellow ?? 0), 0);
  document.getElementById('obf-dist-red').textContent      = all.reduce((s, d) => s + (d.mi_distribution?.red    ?? 0), 0);
  document.getElementById('obf-total-bugs').textContent    = all.reduce((s, d) => s + (d.total_estimated_bugs ?? 0), 0).toFixed(2);

  // Update sort indicator on headers
  document.querySelectorAll('.obf-table th').forEach(th => {
    th.classList.remove('obf-th-sorted-asc', 'obf-th-sorted-desc');
    if (th.dataset.col === sortCol) th.classList.add(`obf-th-sorted-${sortDir}`);
  });

  // Render rows
  const tbody = document.getElementById('obf-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#9ca3af;padding:2rem">No patterns match your search.</td></tr>`;
    _obfSelectedPattern = null;
    renderContextSidebar(null, 'No patterns match your search.');
    return;
  }

  if (!_obfSelectedPattern || !rows.some(d => d.pattern === _obfSelectedPattern)) {
    _obfSelectedPattern = rows[0].pattern;
  }

  tbody.innerHTML = rows.map(d => `
    <tr data-pattern="${escapeHtml(d.pattern)}" class="${d.pattern === _obfSelectedPattern ? 'obf-row-selected' : ''}">
      <td class="obf-pattern-name">${escapeHtml(formatPatternLabel(d.pattern))}</td>
      <td class="obf-num">${d.total_files}</td>
      <td class="obf-num">${d.total_classes}</td>
      <td>${miPillHtml(d.avg_mi_score)}</td>
      <td class="obf-range">
        <span class="obf-range-min">${d.min_mi_score?.toFixed(1) ?? '—'}</span>
        <span class="obf-range-sep">–</span>
        <span class="obf-range-max">${d.max_mi_score?.toFixed(1) ?? '—'}</span>
      </td>
      <td class="obf-dist-cell">${distBarHtml(d.mi_distribution)}</td>
      <td>${ckPillHtml(d.ck_overall_score)}</td>
      <td class="obf-num">${d.avg_wmc?.toFixed(1) ?? '—'}</td>
      <td class="obf-num">${d.avg_cbo?.toFixed(1) ?? '—'}</td>
      <td class="obf-num">${d.avg_rfc?.toFixed(1) ?? '—'}</td>
      <td class="obf-num">${d.avg_dit?.toFixed(1) ?? '—'}</td>
      <td class="obf-num ${(d.total_estimated_bugs ?? 0) > 2 ? 'obf-bugs-warn' : ''}">${d.total_estimated_bugs?.toFixed(3) ?? '—'}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-pattern]').forEach(tr => {
    tr.addEventListener('click', () => {
      _obfSelectedPattern = tr.dataset.pattern;
      renderObfuscated();
    });
  });

  const selectedRow = rows.find(d => d.pattern === _obfSelectedPattern) ?? rows[0];
  renderContextSidebar(selectedRow);
}

function renderContextSidebar(
  row,
  emptyMessage = 'Select a pattern row to view its project context.',
  sidebarId = 'obf-context-sidebar-body',
) {
  const sidebarBody = document.getElementById(sidebarId);
  if (!sidebarBody) return;

  if (!row) {
    sidebarBody.innerHTML = `<p class="context-placeholder">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  const patternName = formatPatternLabel(row.pattern);
  const status = row.status ?? 'Unknown';
  const files = row.total_files ?? 0;
  const classes = row.total_classes ?? 0;
  const mi = row.avg_mi_score ?? null;
  const ck = row.ck_overall_score ?? null;
  const bugs = row.total_estimated_bugs ?? 0;

  const scale = describeProjectScale(files, classes);
  const miProfile = describeMiProfile(mi);
  const ckProfile = describeCkProfile(ck);
  const riskProfile = describeRiskProfile(bugs);

  sidebarBody.innerHTML = `
    <div class="context-kv-grid">
      <div class="context-kv">
        <span class="context-k">Pattern</span>
        <span class="context-v">${escapeHtml(patternName)}</span>
      </div>
      <div class="context-kv">
        <span class="context-k">Status</span>
        <span class="context-v">${escapeHtml(status)}</span>
      </div>
    </div>

    <div class="context-badges">
      <span class="context-badge">Scale: ${scale}</span>
      <span class="context-badge">Risk: ${riskProfile}</span>
    </div>

    <div class="context-score-grid">
      <div class="context-score-card">
        <span class="context-score-label">Maintainability (MI)</span>
        <span class="score-pill ${mi != null ? scorePillClass(mi) : 'poor'}">${mi != null ? mi.toFixed(1) : '—'}</span>
      </div>
      <div class="context-score-card">
        <span class="context-score-label">OO Quality (CK)</span>
        <span class="score-pill ${ck != null ? ckScorePillClass(ck) : 'poor'}">${ck != null ? ck.toFixed(1) : '—'}</span>
      </div>
    </div>

    <p class="context-summary">
      This implementation has a ${scale.toLowerCase()} footprint with ${miProfile.toLowerCase()} maintainability,
      ${ckProfile.toLowerCase()} object-oriented quality, and ${riskProfile.toLowerCase()} estimated defect risk.
    </p>

    <ul class="context-list">
      <li><strong>Footprint:</strong> ${files} files across ${classes} classes.</li>
      <li><strong>MI Range:</strong> ${row.min_mi_score?.toFixed(1) ?? '—'} to ${row.max_mi_score?.toFixed(1) ?? '—'}.</li>
      <li><strong>Class Health:</strong> ${row.mi_distribution?.green ?? 0} good, ${row.mi_distribution?.yellow ?? 0} moderate, ${row.mi_distribution?.red ?? 0} low.</li>
      <li><strong>Complexity:</strong> WMC ${row.avg_wmc?.toFixed(1) ?? '—'}, CBO ${row.avg_cbo?.toFixed(1) ?? '—'}, RFC ${row.avg_rfc?.toFixed(1) ?? '—'}, DIT ${row.avg_dit?.toFixed(1) ?? '—'}.</li>
      <li><strong>Estimated Bugs:</strong> ${bugs.toFixed(3)}.</li>
    </ul>
  `;
}

// Click-to-sort on column headers
document.querySelectorAll('.obf-table th[data-col]').forEach(th => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    if (_obfSortCol === th.dataset.col) {
      _obfSortDir = _obfSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _obfSortCol = th.dataset.col;
      _obfSortDir = th.dataset.col === 'pattern' ? 'asc' : 'desc';
    }
    document.getElementById('obf-sort-col').value = _obfSortCol;
    document.getElementById('obf-sort-dir').value = _obfSortDir;
    renderObfuscated();
  });
});

document.getElementById('obf-search').addEventListener('input', renderObfuscated);
document.getElementById('obf-sort-col').addEventListener('change', e => { _obfSortCol = e.target.value; renderObfuscated(); });
document.getElementById('obf-sort-dir').addEventListener('change', e => { _obfSortDir = e.target.value; renderObfuscated(); });

