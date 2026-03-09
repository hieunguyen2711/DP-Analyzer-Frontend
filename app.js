// ── Navbar tab switching ───────────────────────────────────────────────────
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    const tab = link.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
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

let lastGeneratedFiles = [];
let lastPattern = '';
let lastDescription = '';
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatForm = document.getElementById('chat-form');

let lastAnalysis = '';

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

// ── Generate form submit ───────────────────────────────────────────────────
generateForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const pattern = patternSelect.value;
  const description = generateContext.value.trim();

  if (!pattern || !description) return;

  generateBtn.disabled = true;
  generateResponseBox.innerHTML = '<span style="color:#6366f1;font-style:italic;">Generating…</span>';

  try {
    const response = await fetch('http://localhost:8000/generate', {
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

    createFilesBtn.hidden = false;
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
    const response = await fetch('http://localhost:8000/package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: lastPattern,
        description: lastDescription,
        files: lastGeneratedFiles.map(f => ({
          filename: f.filename ?? f.name ?? 'File.java',
          content: f.content ?? f.code ?? '',
        })),
      }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    a.download = filenameMatch ? filenameMatch[1] : 'design-pattern.zip';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Failed to create files: ${err.message}`);
  } finally {
    createFilesBtn.disabled = false;
    createFilesBtn.textContent = 'Create Java Files';
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
const pigsScore         = document.getElementById('piqs-score');
const pigsBar           = document.getElementById('piqs-bar');
const breakdownSection  = document.getElementById('breakdown-section');
const breakdownTbody    = document.getElementById('breakdown-tbody');

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
  scoreEl.textContent = value !== null ? value.toFixed(1) : '--';
  barEl.style.width = value !== null ? `${Math.min(value, 100)}%` : '0%';

  // Colour the bar based on score range
  const pct = value ?? 0;
  const isPiqs = barEl.classList.contains('piqs');
  let colour;
  if (isPiqs) {
    colour = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : pct >= 40 ? '#f97316' : '#ef4444';
  } else {
    colour = pct >= 75 ? '#22c55e' : pct >= 50 ? '#eab308' : pct >= 10 ? '#f97316' : '#ef4444';
  }
  barEl.style.background = colour;
}

function scorePillClass(score, isPiqs = false) {
  if (isPiqs) return score >= 80 ? 'good' : score >= 60 ? 'moderate' : score >= 40 ? 'low' : 'poor';
  return score >= 75 ? 'good' : score >= 50 ? 'moderate' : score >= 10 ? 'low' : 'poor';
}

scoringForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Endpoint not yet available — placeholder for future integration
  scoringSubmitBtn.disabled = true;
  scoringSubmitBtn.textContent = 'Coming soon…';
  setTimeout(() => {
    scoringSubmitBtn.disabled = false;
    scoringSubmitBtn.textContent = 'Run Analysis';
  }, 2000);
});

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
