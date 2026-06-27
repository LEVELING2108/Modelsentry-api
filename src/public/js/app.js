// ═══════════════════════════════════════════════
//  ModelSentry — Frontend v2.0
// ═══════════════════════════════════════════════

const API_URL = window.location.origin;
let currentUser  = null;
let currentToken = localStorage.getItem('token') || null;
let historyPage  = 1;
const HISTORY_LIMIT = 10;
let analyticsChart = null;
let hourlyTrendChartInstance = null;
let sentimentChartInstance = null;

// ── Char counter ────────────────────────────────
const inferenceTA = document.getElementById('inference-text');
const charCounter = document.getElementById('char-counter');
if (inferenceTA) {
  inferenceTA.addEventListener('input', () => {
    const len = inferenceTA.value.length;
    charCounter.textContent = `${len} / 5000`;
    charCounter.classList.toggle('warn-count', len > 4500);
  });
}

// ── Traffic slider gradient fill ────────────────
function updateSliderFill(slider) {
  const pct = slider.value;
  slider.style.background = `linear-gradient(90deg, var(--lime) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
}

// ═══════════════════════════════════════════════
//  INIT & AUTH
// ═══════════════════════════════════════════════
async function initApp() {
  if (currentToken) {
    const ok = await loadUserProfile();
    if (ok) {
      document.getElementById('auth-overlay').classList.add('hidden');
      document.getElementById('app-container').classList.remove('hidden');
      showTab('playground');
    } else {
      handleLogout();
    }
  } else {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    switchAuthTab('login');
  }
}

async function loadUserProfile() {
  try {
    const res  = await fetch(`${API_URL}/api/v1/auth/me`, { headers: authHeader() });
    const data = await res.json();
    if (data.success) { currentUser = data.data.user; renderUserSection(); return true; }
    return false;
  } catch { return false; }
}

function renderUserSection() {
  if (!currentUser) return;
  const initials = currentUser.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('avatar-letters').textContent = initials;
  document.getElementById('user-display-name').textContent = currentUser.name;

  const roleEl = document.getElementById('user-display-role');
  roleEl.textContent = currentUser.role;
  roleEl.className = `user-role ${currentUser.role === 'admin' ? 'badge-admin' : 'badge-user'}`;

  const adminNav = document.getElementById('nav-admin');
  if (currentUser.role === 'admin') adminNav.classList.remove('hidden');
  else adminNav.classList.add('hidden');
}

function authHeader() {
  return { 'Authorization': `Bearer ${currentToken}` };
}

// ═══════════════════════════════════════════════
//  AUTH FORMS
// ═══════════════════════════════════════════════
function switchAuthTab(mode) {
  document.getElementById('tab-login-btn').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register-btn').classList.toggle('active', mode !== 'login');
  document.getElementById('login-form').classList.toggle('hidden', mode !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', mode === 'login');
  showAuthAlert(null);
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  showAuthAlert(null);
  try {
    const res  = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success) {
      currentToken = data.data.token;
      localStorage.setItem('token', currentToken);
      showToast('Signed in successfully', 'success');
      await initApp();
    } else { showAuthAlert(data.error.message || 'Invalid credentials'); }
  } catch { showAuthAlert('Connection failed — check the server is running'); }
}

async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById('reg-name').value;
  const email    = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const role     = document.getElementById('reg-admin').checked ? 'admin' : 'user';
  showAuthAlert(null);
  try {
    const res  = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await res.json();
    if (data.success) {
      currentToken = data.data.token;
      localStorage.setItem('token', currentToken);
      showToast('Account created!', 'success');
      await initApp();
    } else { showAuthAlert(data.error.message || 'Registration failed'); }
  } catch { showAuthAlert('Connection error — try again'); }
}

function showAuthAlert(msg) {
  const el = document.getElementById('auth-alert');
  if (!msg) { el.classList.add('hidden'); return; }
  document.getElementById('auth-alert-msg').textContent = msg;
  el.classList.remove('hidden');
}

function handleLogout() {
  currentToken = null; currentUser = null;
  localStorage.removeItem('token');
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

// ═══════════════════════════════════════════════
//  TAB NAVIGATION
// ═══════════════════════════════════════════════
function showTab(tabId) {
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

  const navBtn  = document.getElementById(`nav-${tabId}`);
  const tabView = document.getElementById(`tab-${tabId}`);
  if (navBtn)  navBtn.classList.add('active');
  if (tabView) tabView.classList.add('active');

  if (tabId === 'history') loadHistory(1);
  else if (tabId === 'keys')  loadAPIKeys();
  else if (tabId === 'admin') loadAdminDashboard();
}

// ═══════════════════════════════════════════════
//  PLAYGROUND
// ═══════════════════════════════════════════════
async function handleInference(e) {
  e.preventDefault();
  const text         = document.getElementById('inference-text').value;
  const modelVersion = document.getElementById('inference-version').value;
  const returnScores = document.getElementById('inference-scores').checked;
  const btnText      = document.getElementById('inference-btn-text');
  const spinner      = document.getElementById('inference-spinner');
  const btn          = document.getElementById('inference-submit-btn');

  btn.disabled = true;
  btnText.textContent = 'Processing…';
  spinner.classList.remove('hidden');

  try {
    const res  = await fetch(`${API_URL}/api/v1/predict`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, modelVersion, options: { returnScores } })
    });
    const data = await res.json();
    if (data.success) renderPredictionResult(data.data);
    else showToast(data.error.message || 'Inference failed', 'error');
  } catch { showToast('Could not reach the gateway', 'error'); }
  finally {
    btn.disabled = false;
    btnText.textContent = 'Run Inference';
    spinner.classList.add('hidden');
  }
}

function renderPredictionResult(data) {
  document.getElementById('playground-result-empty').classList.add('hidden');
  const display = document.getElementById('playground-result-display');
  display.classList.remove('hidden');

  const { prediction, model, performance } = data;

  document.getElementById('result-sentiment-label').textContent = prediction.label;
  document.getElementById('result-confidence').textContent = `${(prediction.confidence * 100).toFixed(1)}%`;
  document.getElementById('result-latency').textContent     = `${performance.latencyMs} ms`;
  document.getElementById('result-model-version').textContent = model.version;

  const sBox = document.getElementById('result-sentiment-box');
  sBox.className = 'sentiment-box';
  if (prediction.label === 'POSITIVE') sBox.classList.add('pos-style');
  else if (prediction.label === 'NEGATIVE') sBox.classList.add('neg-style');
  else sBox.classList.add('neut-style');

  const scores = prediction.scores || {};
  const pos = scores.POSITIVE || 0;
  const neg = scores.NEGATIVE || 0;
  const neu = scores.NEUTRAL  || 0;

  setBar('pos', pos);
  setBar('neg', neg);
  setBar('neut', neu);

  document.getElementById('result-json-block').textContent = JSON.stringify({ success: true, data }, null, 2);
}

function setBar(key, val) {
  document.getElementById(`bar-${key}-val`).textContent  = `${(val * 100).toFixed(1)}%`;
  document.getElementById(`bar-${key}-fill`).style.width = `${val * 100}%`;
}

function copyRawResult() {
  navigator.clipboard.writeText(document.getElementById('result-json-block').textContent);
  showToast('JSON copied to clipboard', 'info');
}

// ═══════════════════════════════════════════════
//  API KEYS
// ═══════════════════════════════════════════════
async function loadAPIKeys() {
  const tbody = document.getElementById('keys-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Fetching credentials…</td></tr>';
  await loadUserProfile();
  if (!currentUser) return;

  tbody.innerHTML = '';
  if (!currentUser.apiKeyPrefix) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No active keys — configure options above and click "Generate Key".</td></tr>';
    return;
  }

  const lastLogin = currentUser.lastLogin ? new Date(currentUser.lastLogin).toLocaleDateString() : 'Active now';
  const createdAt = currentUser.updatedAt  ? new Date(currentUser.updatedAt).toLocaleString()    : '—';
  const scopesBadges = (currentUser.apiKeyScopes || []).map(s => `<span class="badge badge-mono" style="margin-right: 4px; border: 1px solid var(--ink-border);">${s}</span>`).join('') || '—';
  const rateLimitVal = `${currentUser.apiKeyRateLimit || 100} req/min`;

  tbody.innerHTML = `
    <tr>
      <td><span class="badge badge-mono">${currentUser.apiKeyPrefix}••••</span></td>
      <td><div style="display:flex; flex-wrap:wrap; gap:4px;">${scopesBadges}</div></td>
      <td><span class="badge badge-mono">${rateLimitVal}</span></td>
      <td><span class="badge badge-ok">● Active</span></td>
      <td>${lastLogin}</td>
      <td style="font-family:var(--f-mono);font-size:11px;color:var(--t-mid);">${createdAt}</td>
    </tr>`;
}

async function handleGenerateKey() {
  try {
    const scopes = [];
    if (document.getElementById('scope-v1')?.checked) scopes.push('predict:v1');
    if (document.getElementById('scope-v2')?.checked) scopes.push('predict:v2');
    if (document.getElementById('scope-batch')?.checked) scopes.push('predict:batch');
    if (document.getElementById('scope-history')?.checked) scopes.push('history:read');

    const rateLimit = parseInt(document.getElementById('key-rate-limit')?.value, 10) || 100;

    const res  = await fetch(`${API_URL}/api/v1/auth/api-key`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopes, rateLimit })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('new-key-raw').textContent = data.data.apiKey;
      document.getElementById('new-key-modal').classList.remove('hidden');
      loadAPIKeys();
      showToast('New API key generated', 'success');
    } else { showToast(data.error.message || 'Key generation failed', 'error'); }
  } catch { showToast('Failed to reach auth service', 'error'); }
}

function copyNewKey() {
  navigator.clipboard.writeText(document.getElementById('new-key-raw').textContent);
  showToast('API key copied — store it safely', 'success');
}

// ═══════════════════════════════════════════════
//  HISTORY LOG
// ═══════════════════════════════════════════════
async function loadHistory(page = 1) {
  historyPage = page;
  const tbody = document.getElementById('history-table-body');
  tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Loading log…</td></tr>';

  const mv  = document.getElementById('history-filter-model').value;
  const st  = document.getElementById('history-filter-status').value;
  let url   = `${API_URL}/api/v1/predict/history?page=${historyPage}&limit=${HISTORY_LIMIT}`;
  if (mv) url += `&modelVersion=${mv}`;
  if (st) url += `&status=${st}`;

  try {
    const res  = await fetch(url, { headers: authHeader() });
    const data = await res.json();
    if (data.success) renderHistoryTable(data.data.predictions, data.meta.pagination);
    else tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${data.error.message}</td></tr>`;
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Connection error.</td></tr>';
  }
}

function renderHistoryTable(rows, pg) {
  const tbody = document.getElementById('history-table-body');
  tbody.innerHTML = '';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No results match the current filters.</td></tr>';
    document.getElementById('pagination-info').textContent = '—';
    document.getElementById('pagination-prev').disabled = true;
    document.getElementById('pagination-next').disabled = true;
    return;
  }

  rows.forEach(p => {
    const txt  = (p.input?.text || '').substring(0, 44) + (p.input?.text?.length > 44 ? '…' : '');
    const time = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const statusCls = { success: 'badge-ok', error: 'badge-bad', timeout: 'badge-warn' }[p.status] || 'badge-mono';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <button class="icon-btn" style="font-family:var(--f-mono);font-size:11px;"
          title="Copy full ID" onclick="navigator.clipboard.writeText('${p.requestId}');showToast('ID copied','info');">
          ${p.requestId.substring(0, 8)}…
        </button>
      </td>
      <td style="color:var(--t-mid);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(p.input?.text || '').replace(/"/g,'&quot;')}">${txt || '—'}</td>
      <td><span class="badge badge-mono">${p.modelVersion}</span></td>
      <td style="font-weight:600;">${p.output?.label || '—'}</td>
      <td style="font-family:var(--f-mono);">${p.output?.confidence ? (p.output.confidence * 100).toFixed(1) + '%' : '—'}</td>
      <td style="font-family:var(--f-mono);">${p.latencyMs} ms</td>
      <td><span class="badge ${statusCls}">${p.status}</span></td>
      <td style="font-family:var(--f-mono);font-size:11px;color:var(--t-mid);">${time}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('pagination-info').textContent =
    `Page ${pg.page} of ${pg.pages} — ${pg.total} total`;
  document.getElementById('pagination-prev').disabled = pg.page <= 1;
  document.getElementById('pagination-next').disabled = pg.page >= pg.pages;
}

function changeHistoryPage(dir) { loadHistory(historyPage + dir); }

// ═══════════════════════════════════════════════
//  ADMIN DASHBOARD
// ═══════════════════════════════════════════════
async function loadAdminDashboard() {
  try {
    const [mRes, aRes] = await Promise.all([
      fetch(`${API_URL}/api/v1/admin/models`,        { headers: authHeader() }),
      fetch(`${API_URL}/api/v1/admin/analytics?hours=24`, { headers: authHeader() }),
    ]);
    const [mData, aData] = await Promise.all([mRes.json(), aRes.json()]);

    if (mData.success && aData.success) {
      renderAdminMetadata(mData.data.models);
      renderAdminAnalytics(aData.data);
    } else {
      showToast('Admin data unavailable — check your permissions', 'error');
    }
  } catch { showToast('Failed to reach admin endpoints', 'error'); }
}

function renderAdminMetadata(models) {
  const list = document.getElementById('model-metadata-list');
  list.innerHTML = '';

  models.forEach(m => {
    const pct = Math.round(m.trafficWeight * 100);
    if (m.version === 'v1') {
      const sl = document.getElementById('traffic-slider');
      sl.value = pct;
      updateSliderFill(sl);
      document.getElementById('split-v1-label').textContent = `${pct}%`;
      document.getElementById('split-v2-label').textContent = `${100 - pct}%`;
    }

    const div = document.createElement('div');
    div.className = 'model-meta-item';
    div.innerHTML = `
      <div class="model-meta-left">
        <span class="model-version-tag">${m.version.toUpperCase()} · ${m.modelType}</span>
        <span class="model-desc">${m.description}</span>
      </div>
      <div class="model-stats">
        <div class="stat-item">
          <span class="stat-v lime">${pct}%</span>
          <span class="stat-l">Traffic</span>
        </div>
        <div class="stat-item">
          <span class="stat-v">${m.totalPredictions}</span>
          <span class="stat-l">Runs</span>
        </div>
        <div class="stat-item">
          <span class="stat-v">${Math.round(m.avgLatencyMs)}ms</span>
          <span class="stat-l">Avg</span>
        </div>
      </div>`;
    list.appendChild(div);
  });
}

function updateSliderLabels(val) {
  document.getElementById('split-v1-label').textContent = `${val}%`;
  document.getElementById('split-v2-label').textContent = `${100 - val}%`;
  const sl = document.getElementById('traffic-slider');
  updateSliderFill(sl);
}

async function saveTrafficWeights(val) {
  const weight = parseFloat((val / 100).toFixed(4));
  try {
    const res  = await fetch(`${API_URL}/api/v1/admin/models/weights`, {
      method: 'PATCH',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'v1', weight })
    });
    const data = await res.json();
    if (data.success) { showToast('Traffic weights updated', 'success'); loadAdminDashboard(); }
    else showToast(data.error.message || 'Update failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

function renderAdminAnalytics(data) {
  document.getElementById('admin-metric-total').textContent   = data.summary.totalPredictions;
  document.getElementById('admin-metric-success').textContent = data.summary.successRate;
  document.getElementById('admin-metric-latency').textContent = data.latency ? `${data.latency.avgMs} ms` : '—';
  document.getElementById('admin-metric-errors').textContent  = (data.summary.errorCount || 0) + (data.summary.timeoutCount || 0);

  // 1. Throughput vs Latency (Model breakdown)
  const ctx = document.getElementById('latencyChart').getContext('2d');
  if (analyticsChart) { analyticsChart.destroy(); analyticsChart = null; }

  const labels     = data.byModel.map(m => m.version.toUpperCase());
  const predictions = data.byModel.map(m => m.predictions);
  const latencies  = data.byModel.map(m => m.avgLatencyMs);

  // Chart.js defaults override for dark theme
  Chart.defaults.color = '#555';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';

  analyticsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Predictions',
          data: predictions,
          backgroundColor: 'rgba(184,255,60,0.15)',
          borderColor: '#B8FF3C',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: 'Avg Latency (ms)',
          data: latencies,
          backgroundColor: 'rgba(61,235,138,0.1)',
          borderColor: '#3DEB8A',
          borderWidth: 1.5,
          borderRadius: 4,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#888', font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 12, padding: 16 } },
      },
      scales: {
        x:  { grid: { display: false }, ticks: { color: '#555', font: { family: 'JetBrains Mono', size: 11 } } },
        y:  { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#555', font: { family: 'JetBrains Mono', size: 11 } },
               title: { display: true, text: 'Requests', color: '#555', font: { size: 10 } }, position: 'left' },
        y1: { grid: { drawOnChartArea: false }, ticks: { color: '#555', font: { family: 'JetBrains Mono', size: 11 } },
               title: { display: true, text: 'Latency ms', color: '#555', font: { size: 10 } }, position: 'right' },
      },
    },
  });

  // 2. Hourly Trend (throughput, latency, errors)
  const hourlyCtx = document.getElementById('hourlyTrendChart').getContext('2d');
  if (hourlyTrendChartInstance) { hourlyTrendChartInstance.destroy(); hourlyTrendChartInstance = null; }

  const hourlyLabels = data.timeSeries.map(t => {
    const timeParts = t.time.split(' ');
    return timeParts.length > 1 ? timeParts[1] : t.time;
  });
  const hourlyThroughput = data.timeSeries.map(t => t.count);
  const hourlyLatencies = data.timeSeries.map(t => t.avgLatencyMs);
  const hourlyErrors = data.timeSeries.map(t => t.errorCount);

  hourlyTrendChartInstance = new Chart(hourlyCtx, {
    type: 'line',
    data: {
      labels: hourlyLabels,
      datasets: [
        {
          label: 'Requests',
          data: hourlyThroughput,
          borderColor: '#B8FF3C',
          backgroundColor: 'rgba(184,255,60,0.05)',
          fill: true,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 2,
          yAxisID: 'y',
        },
        {
          label: 'Avg Latency (ms)',
          data: hourlyLatencies,
          borderColor: '#3DEB8A',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          tension: 0.3,
          pointRadius: 2,
          yAxisID: 'y1',
        },
        {
          label: 'Errors',
          data: hourlyErrors,
          borderColor: '#EF4444',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          tension: 0.1,
          pointRadius: 2,
          yAxisID: 'y',
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#888', font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 12, padding: 8 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#555', font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#555', font: { family: 'JetBrains Mono', size: 10 } }, position: 'left', title: { display: true, text: 'Requests / Errors', color: '#555', font: { size: 9 } } },
        y1: { grid: { drawOnChartArea: false }, ticks: { color: '#555', font: { family: 'JetBrains Mono', size: 10 } }, position: 'right', title: { display: true, text: 'Latency (ms)', color: '#555', font: { size: 9 } } }
      }
    }
  });

  // 3. Sentiment Distribution (doughnut chart)
  const sentimentCtx = document.getElementById('sentimentChart').getContext('2d');
  if (sentimentChartInstance) { sentimentChartInstance.destroy(); sentimentChartInstance = null; }

  const sentimentLabels = data.sentimentDistribution.map(s => s.sentiment);
  const sentimentCounts = data.sentimentDistribution.map(s => s.count);

  const hasData = sentimentCounts.some(c => c > 0);
  const chartLabels = hasData ? sentimentLabels : ['NO DATA'];
  const chartData = hasData ? sentimentCounts : [1];
  const chartColors = hasData 
    ? sentimentLabels.map(label => {
        if (label === 'POSITIVE') return 'rgba(61,235,138,0.7)';
        if (label === 'NEGATIVE') return 'rgba(239,68,68,0.7)';
        return 'rgba(107,114,128,0.7)';
      })
    : ['rgba(255,255,255,0.08)'];

  const borderColors = hasData 
    ? sentimentLabels.map(label => {
        if (label === 'POSITIVE') return '#3DEB8A';
        if (label === 'NEGATIVE') return '#EF4444';
        return '#6B7280';
      })
    : ['rgba(255,255,255,0.12)'];

  sentimentChartInstance = new Chart(sentimentCtx, {
    type: 'doughnut',
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartData,
        backgroundColor: chartColors,
        borderColor: borderColors,
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { color: '#888', font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 12, padding: 12 } }
      }
    }
  });

  // 4. Stable vs Canary Side-by-Side Audit Table
  const abTbody = document.getElementById('ab-comparison-tbody');
  if (abTbody) {
    if (!data.byModel || data.byModel.length === 0) {
      abTbody.innerHTML = '<tr><td colspan="6" class="table-empty">No A/B telemetry logged yet.</td></tr>';
    } else {
      abTbody.innerHTML = data.byModel.map(m => {
        const verUpper = m.version.toUpperCase();
        
        // 1. Latency progress bar
        const maxLatencyMs = 200;
        const latencyPct = Math.min(100, Math.round((m.avgLatencyMs / maxLatencyMs) * 100));
        const latencyBarHtml = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--f-mono); font-size:12px; width:45px; text-align:right;">${m.avgLatencyMs}ms</span>
            <div class="track" style="width:70px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px;">
              <div class="bar" style="width:${latencyPct}%; height:100%; background:var(--lime); border-radius:3px;"></div>
            </div>
          </div>`;

        // 2. Error rate progress bar
        const errorPct = Math.min(100, Math.round(m.errorRate));
        const errorBarHtml = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--f-mono); font-size:12px; width:45px; text-align:right;">${m.errorRate}%</span>
            <div class="track" style="width:70px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px;">
              <div class="bar" style="width:${errorPct}%; height:100%; background:#EF4444; border-radius:3px;"></div>
            </div>
          </div>`;

        // 3. Confidence progress bar
        const confVal = (m.avgConfidence * 100).toFixed(1);
        const confPct = Math.round(m.avgConfidence * 100);
        const confBarHtml = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-family:var(--f-mono); font-size:12px; width:45px; text-align:right;">${confVal}%</span>
            <div class="track" style="width:70px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px;">
              <div class="bar" style="width:${confPct}%; height:100%; background:#3DEB8A; border-radius:3px;"></div>
            </div>
          </div>`;

        // 4. Sentiment segment bar
        const pos = m.sentiment?.POSITIVE || 0;
        const neg = m.sentiment?.NEGATIVE || 0;
        const neut = m.sentiment?.NEUTRAL || 0;
        const totalSent = pos + neg + neut;

        let sentBarHtml = '';
        if (totalSent === 0) {
          sentBarHtml = `<span style="font-size:11px; color:var(--t-low);">No sentiment inputs</span>`;
        } else {
          const posPct = ((pos / totalSent) * 100).toFixed(1);
          const negPct = ((neg / totalSent) * 100).toFixed(1);
          const neutPct = ((neut / totalSent) * 100).toFixed(1);

          sentBarHtml = `
            <div style="display:flex; flex-direction:column; gap:4px; width:100%;">
              <div class="track" style="width:100%; height:10px; background:rgba(255,255,255,0.05); border-radius:4px; display:flex; overflow:hidden;">
                <div style="width:${posPct}%; background:#3DEB8A; height:100%;" title="Positive: ${pos}"></div>
                <div style="width:${negPct}%; background:#EF4444; height:100%;" title="Negative: ${neg}"></div>
                <div style="width:${neutPct}%; background:#6B7280; height:100%;" title="Neutral: ${neut}"></div>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:9px; font-family:var(--f-mono); color:var(--t-low);">
                <span>Pos: ${posPct}%</span>
                <span>Neg: ${negPct}%</span>
                <span>Neut: ${neutPct}%</span>
              </div>
            </div>`;
        }

        return `
          <tr>
            <td><span class="badge ${m.version === 'v1' ? 'badge-lime' : 'badge-mono'}" style="font-weight:600;">${verUpper}</span></td>
            <td style="font-family:var(--f-mono); font-size:13px;">${m.predictions}</td>
            <td>${latencyBarHtml}</td>
            <td>${errorBarHtml}</td>
            <td>${confBarHtml}</td>
            <td style="min-width: 180px;">${sentBarHtml}</td>
          </tr>`;
      }).join('');
    }
  }
}

// ═══════════════════════════════════════════════
//  TOASTS
// ═══════════════════════════════════════════════
function showToast(msg, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3800);
}

function setupEventListeners() {
  // Auth tab buttons
  document.getElementById('tab-login-btn')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-register-btn')?.addEventListener('click', () => switchAuthTab('register'));

  // Forms submit
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('register-form')?.addEventListener('submit', handleRegister);

  // Sidebar navigation links
  document.getElementById('nav-playground')?.addEventListener('click', () => showTab('playground'));
  document.getElementById('nav-keys')?.addEventListener('click', () => showTab('keys'));
  document.getElementById('nav-history')?.addEventListener('click', () => showTab('history'));
  document.getElementById('nav-admin')?.addEventListener('click', () => showTab('admin'));

  // User logout button
  document.querySelector('.logout-btn')?.addEventListener('click', handleLogout);

  // Playground form submission
  document.getElementById('playground-inference-form')?.addEventListener('submit', handleInference);

  // Copy buttons
  document.getElementById('copy-json-btn')?.addEventListener('click', copyRawResult);
  document.getElementById('copy-new-key-btn')?.addEventListener('click', copyNewKey);
  
  // API key gen button in keys tab
  document.getElementById('gen-key-btn')?.addEventListener('click', handleGenerateKey);

  // History filters
  document.getElementById('history-filter-model')?.addEventListener('change', () => loadHistory(1));
  document.getElementById('history-filter-status')?.addEventListener('change', () => loadHistory(1));

  // Pagination buttons
  document.getElementById('pagination-prev')?.addEventListener('click', () => changeHistoryPage(-1));
  document.getElementById('pagination-next')?.addEventListener('click', () => changeHistoryPage(1));

  // Admin slider
  const sl = document.getElementById('traffic-slider');
  if (sl) {
    sl.addEventListener('input', e => updateSliderLabels(e.target.value));
    sl.addEventListener('change', e => saveTrafficWeights(e.target.value));
    updateSliderFill(sl);
  }
}

// ═══════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════
window.onload = () => {
  setupEventListeners();
  initApp();
};
