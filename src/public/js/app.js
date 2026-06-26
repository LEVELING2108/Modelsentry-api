// ── Configuration ──────────────────────────────────────────────────────────
const API_URL = window.location.origin;
let currentUser = null;
let currentToken = localStorage.getItem('token') || null;
let historyPage = 1;
const historyLimit = 10;
let analyticsChart = null;

// Character counter for textarea
const inferenceTextarea = document.getElementById('inference-text');
const charCounter = document.getElementById('char-counter');
if (inferenceTextarea) {
  inferenceTextarea.addEventListener('input', (e) => {
    const len = e.target.value.length;
    charCounter.textContent = `${len} / 5000 chars`;
  });
}

// ── Authentication Checks ───────────────────────────────────────────────────
async function initApp() {
  if (currentToken) {
    const success = await loadUserProfile();
    if (success) {
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
    const response = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const result = await response.json();
    if (result.success) {
      currentUser = result.data.user;
      renderUserSection();
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to load profile:', err);
    return false;
  }
}

function renderUserSection() {
  if (!currentUser) return;
  // Avatar initials
  const initials = currentUser.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('avatar-letters').textContent = initials;
  document.getElementById('user-display-name').textContent = currentUser.name;
  
  const roleSpan = document.getElementById('user-display-role');
  roleSpan.textContent = currentUser.role;
  if (currentUser.role === 'admin') {
    roleSpan.className = 'user-role badge-admin';
    document.getElementById('nav-admin').classList.remove('hidden');
  } else {
    roleSpan.className = 'user-role badge-user';
    document.getElementById('nav-admin').classList.add('hidden');
  }
}

// ── Auth View Controllers ───────────────────────────────────────────────────
function switchAuthTab(mode) {
  const loginTabBtn = document.getElementById('tab-login-btn');
  const registerTabBtn = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authAlert = document.getElementById('auth-alert');
  
  authAlert.classList.add('hidden');

  if (mode === 'login') {
    loginTabBtn.classList.add('active');
    registerTabBtn.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    loginTabBtn.classList.remove('active');
    registerTabBtn.classList.add('active');
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const alertBox = document.getElementById('auth-alert');
  const alertMsg = document.getElementById('auth-alert-msg');
  
  alertBox.classList.add('hidden');

  try {
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const result = await response.json();
    if (result.success) {
      currentToken = result.data.token;
      localStorage.setItem('token', currentToken);
      showToast('Successfully logged in', 'success');
      await initApp();
    } else {
      alertMsg.textContent = result.error.message || 'Invalid credentials';
      alertBox.classList.remove('hidden');
    }
  } catch (err) {
    alertMsg.textContent = 'Server connection failed. Try again.';
    alertBox.classList.remove('hidden');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const isAdmin = document.getElementById('reg-admin').checked;
  const alertBox = document.getElementById('auth-alert');
  const alertMsg = document.getElementById('auth-alert-msg');

  alertBox.classList.add('hidden');

  try {
    const role = isAdmin ? 'admin' : 'user';
    const response = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });

    const result = await response.json();
    if (result.success) {
      currentToken = result.data.token;
      localStorage.setItem('token', currentToken);
      showToast('Registration successful!', 'success');
      await initApp();
    } else {
      alertMsg.textContent = result.error.message || 'Registration failed';
      alertBox.classList.remove('hidden');
    }
  } catch (err) {
    alertMsg.textContent = 'Connection error. Please try again.';
    alertBox.classList.remove('hidden');
  }
}

function handleLogout() {
  currentToken = null;
  currentUser = null;
  localStorage.removeItem('token');
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
  // Clean inputs
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

// ── Tab View Switcher ───────────────────────────────────────────────────────
function showTab(tabId) {
  document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));

  const navBtn = document.getElementById(`nav-${tabId}`);
  const viewPanel = document.getElementById(`tab-${tabId}`);
  if (navBtn) navBtn.classList.add('active');
  if (viewPanel) viewPanel.classList.add('active');

  // Trigger loads on specific tab activations
  if (tabId === 'history') {
    loadHistory(1);
  } else if (tabId === 'keys') {
    loadAPIKeys();
  } else if (tabId === 'admin') {
    loadAdminDashboard();
  }
}

// ── Playground - Inference Execution ────────────────────────────────────────
async function handleInference(e) {
  e.preventDefault();
  const text = document.getElementById('inference-text').value;
  const modelVersion = document.getElementById('inference-version').value;
  const returnScores = document.getElementById('inference-scores').checked;

  const btnText = document.getElementById('inference-btn-text');
  const spinner = document.getElementById('inference-spinner');
  const submitBtn = document.getElementById('inference-submit-btn');

  // Disable button, show loading
  submitBtn.disabled = true;
  btnText.textContent = 'Processing...';
  spinner.classList.remove('hidden');

  try {
    const start = Date.now();
    const response = await fetch(`${API_URL}/api/v1/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        text,
        modelVersion,
        options: { returnScores }
      })
    });

    const result = await response.json();
    if (result.success) {
      renderPredictionResult(result.data);
    } else {
      showToast(result.error.message || 'Inference execution failed', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to serving gateway', 'error');
  } finally {
    submitBtn.disabled = false;
    btnText.textContent = 'Execute Inference';
    spinner.classList.add('hidden');
  }
}

function renderPredictionResult(data) {
  document.getElementById('playground-result-empty').classList.add('hidden');
  const display = document.getElementById('playground-result-display');
  display.classList.remove('hidden');

  const { prediction, model, performance } = data;
  
  // Set labels and latency
  const labelSpan = document.getElementById('result-sentiment-label');
  labelSpan.textContent = prediction.label;
  document.getElementById('result-confidence').textContent = `${(prediction.confidence * 100).toFixed(1)}%`;
  document.getElementById('result-latency').textContent = `${performance.latencyMs} ms`;
  document.getElementById('result-model-version').textContent = model.version;

  // Set colors based on label
  const sBox = document.getElementById('result-sentiment-box');
  sBox.className = 'sentiment-box'; // reset
  if (prediction.label === 'POSITIVE') sBox.classList.add('pos-style');
  else if (prediction.label === 'NEGATIVE') sBox.classList.add('neg-style');
  else sBox.classList.add('neut-style');

  // Render score bars
  const scores = prediction.scores || {
    [prediction.label]: prediction.confidence,
    // fill mock/others if scores not returned
  };
  
  // Populate fills
  const posScore = scores.POSITIVE || 0;
  const negScore = scores.NEGATIVE || 0;
  const neutScore = scores.NEUTRAL || 0;

  document.getElementById('bar-pos-val').textContent = `${(posScore * 100).toFixed(1)}%`;
  document.getElementById('bar-pos-fill').style.width = `${posScore * 100}%`;
  
  document.getElementById('bar-neg-val').textContent = `${(negScore * 100).toFixed(1)}%`;
  document.getElementById('bar-neg-fill').style.width = `${negScore * 100}%`;

  document.getElementById('bar-neut-val').textContent = `${(neutScore * 100).toFixed(1)}%`;
  document.getElementById('bar-neut-fill').style.width = `${neutScore * 100}%`;

  // Set code block
  document.getElementById('result-json-block').textContent = JSON.stringify({ success: true, data }, null, 2);
}

function copyRawResult() {
  const code = document.getElementById('result-json-block').textContent;
  navigator.clipboard.writeText(code);
  showToast('Response JSON copied to clipboard', 'info');
}

// ── API Key Management ──────────────────────────────────────────────────────
async function loadAPIKeys() {
  const tableBody = document.getElementById('keys-table-body');
  tableBody.innerHTML = '<tr><td colspan="6" class="table-loading">Syncing API credentials...</td></tr>';

  // Force load profile to fetch active keys from database
  await loadUserProfile();

  if (!currentUser) return;
  
  tableBody.innerHTML = '';
  if (!currentUser.apiKeyPrefix) {
    tableBody.innerHTML = '<tr><td colspan="6" class="table-loading">No active API keys found. Click "Generate API Key" to create one.</td></tr>';
    return;
  }

  // Display the active key prefix
  const dateStr = currentUser.updatedAt ? new Date(currentUser.updatedAt).toLocaleString() : 'N/A';
  const rowHtml = `
    <tr>
      <td><code class="badge-model">${currentUser.apiKeyPrefix}••••</code></td>
      <td>${currentUser.name}</td>
      <td><span class="user-role badge-admin">${currentUser.role}</span></td>
      <td><span class="badge-status success">Active</span></td>
      <td>${currentUser.lastLogin ? new Date(currentUser.lastLogin).toLocaleDateString() : 'Active now'}</td>
      <td>${dateStr}</td>
    </tr>
  `;
  tableBody.innerHTML = rowHtml;
}

async function handleGenerateKey() {
  const modal = document.getElementById('new-key-modal');
  const rawSpan = document.getElementById('new-key-raw');
  modal.classList.add('hidden');

  try {
    const response = await fetch(`${API_URL}/api/v1/auth/api-key`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    const result = await response.json();
    if (result.success) {
      rawSpan.textContent = result.data.apiKey;
      modal.classList.remove('hidden');
      loadAPIKeys();
      showToast('New API key generated', 'success');
    } else {
      showToast(result.error.message || 'Key generation failed', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to auth server', 'error');
  }
}

function copyNewKey() {
  const key = document.getElementById('new-key-raw').textContent;
  navigator.clipboard.writeText(key);
  showToast('API Key copied! Store it somewhere safe.', 'success');
}

// ── Inference History Logs ──────────────────────────────────────────────────
async function loadHistory(page = 1) {
  historyPage = page;
  const tableBody = document.getElementById('history-table-body');
  tableBody.innerHTML = '<tr><td colspan="8" class="table-loading">Fetching historical prediction runs...</td></tr>';

  const filterModel = document.getElementById('history-filter-model').value;
  const filterStatus = document.getElementById('history-filter-status').value;

  let queryUrl = `${API_URL}/api/v1/predict/history?page=${historyPage}&limit=${historyLimit}`;
  if (filterModel) queryUrl += `&modelVersion=${filterModel}`;
  if (filterStatus) queryUrl += `&status=${filterStatus}`;

  try {
    const response = await fetch(queryUrl, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    const result = await response.json();
    if (result.success) {
      renderHistoryTable(result.data.predictions, result.meta.pagination);
    } else {
      tableBody.innerHTML = `<tr><td colspan="8" class="table-loading error-alert">${result.error.message || 'Failed to load log history'}</td></tr>`;
    }
  } catch (err) {
    tableBody.innerHTML = '<tr><td colspan="8" class="table-loading error-alert">Failed to establish server connection.</td></tr>';
  }
}

function renderHistoryTable(predictions, pagination) {
  const tableBody = document.getElementById('history-table-body');
  tableBody.innerHTML = '';

  if (predictions.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" class="table-loading">No inference runs match selected filters.</td></tr>';
    document.getElementById('pagination-info').textContent = 'Showing page 0 of 0';
    document.getElementById('pagination-prev').disabled = true;
    document.getElementById('pagination-next').disabled = true;
    return;
  }

  predictions.forEach((p) => {
    const rawText = p.input?.text || '';
    const cleanText = rawText.length > 42 ? rawText.substring(0, 42) + '...' : rawText;
    const timeStr = new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><button class="copy-cell-btn font-mono" title="Copy Request ID" onclick="navigator.clipboard.writeText('${p.requestId}'); showToast('Request ID copied', 'info');">${p.requestId.substring(0, 8)}...</button></td>
      <td class="font-outfit text-secondary" title="${rawText.replace(/"/g, '&quot;')}">${cleanText}</td>
      <td><span class="badge-model">${p.modelVersion}</span></td>
      <td><span class="font-outfit font-bold">${p.output?.label || 'N/A'}</span></td>
      <td>${p.output?.confidence ? `${(p.output.confidence * 100).toFixed(1)}%` : 'N/A'}</td>
      <td>${p.latencyMs} ms</td>
      <td><span class="badge-status ${p.status}">${p.status}</span></td>
      <td class="text-secondary font-outfit" title="${dateStr}">${timeStr}</td>
    `;
    tableBody.appendChild(row);
  });

  // Handle pagination info
  document.getElementById('pagination-info').textContent = `Showing page ${pagination.page} of ${pagination.pages} (${pagination.total} total logs)`;
  document.getElementById('pagination-prev').disabled = pagination.page <= 1;
  document.getElementById('pagination-next').disabled = pagination.page >= pagination.pages;
}

function changeHistoryPage(dir) {
  loadHistory(historyPage + dir);
}

// ── Admin Panel & Operations Dashboard ──────────────────────────────────────
async function loadAdminDashboard() {
  try {
    // 1. Load model metadata & weights
    const metadataRes = await fetch(`${API_URL}/api/v1/admin/models`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const metadataResult = await metadataRes.json();
    
    // 2. Load 24h operational analytics
    const analyticsRes = await fetch(`${API_URL}/api/v1/admin/analytics?hours=24`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const analyticsResult = await analyticsRes.json();

    if (metadataResult.success && analyticsResult.success) {
      renderAdminMetadata(metadataResult.data.models);
      renderAdminAnalytics(analyticsResult.data);
    } else {
      showToast('Access denied or analytics service offline', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to administration routes', 'error');
  }
}

function renderAdminMetadata(models) {
  const list = document.getElementById('model-metadata-list');
  list.innerHTML = '';

  models.forEach((m) => {
    // Determine active weight to populate weights
    const weightPct = Math.round(m.trafficWeight * 100);
    
    // Update live configs of slider if we match v1
    if (m.version === 'v1') {
      document.getElementById('traffic-slider').value = weightPct;
      document.getElementById('split-v1-label').textContent = `${weightPct}%`;
      document.getElementById('split-v2-label').textContent = `${100 - weightPct}%`;
    }

    const item = document.createElement('div');
    item.className = 'meta-item-row';
    item.innerHTML = `
      <div class="meta-item-left">
        <span class="meta-item-title font-outfit text-gradient">${m.version.toUpperCase()} — ${m.modelType.toUpperCase()}</span>
        <span class="meta-item-desc text-secondary">${m.description}</span>
      </div>
      <div class="meta-item-right">
        <div class="stat-group">
          <span class="stat-val text-violet">${weightPct}%</span>
          <span class="stat-lbl">Split Ratio</span>
        </div>
        <div class="stat-group">
          <span class="stat-val font-mono">${m.totalPredictions}</span>
          <span class="stat-lbl">Runs</span>
        </div>
        <div class="stat-group">
          <span class="stat-val font-mono">${Math.round(m.avgLatencyMs)}ms</span>
          <span class="stat-lbl">Avg Delay</span>
        </div>
      </div>
    `;
    list.appendChild(item);
  });
}

function updateSliderLabels(val) {
  document.getElementById('split-v1-label').textContent = `${val}%`;
  document.getElementById('split-v2-label').textContent = `${100 - val}%`;
}

async function saveTrafficWeights(val) {
  const weight = parseFloat((val / 100).toFixed(4));
  try {
    const response = await fetch(`${API_URL}/api/v1/admin/models/weights`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ version: 'v1', weight })
    });
    
    const result = await response.json();
    if (result.success) {
      showToast('A/B traffic weights updated live', 'success');
      loadAdminDashboard(); // reload descriptions
    } else {
      showToast(result.error.message || 'Failed to update traffic weights', 'error');
    }
  } catch (err) {
    showToast('Network error updating weights', 'error');
  }
}

function renderAdminAnalytics(data) {
  // Update metric text blocks
  document.getElementById('admin-metric-total').textContent = data.summary.totalPredictions;
  document.getElementById('admin-metric-success').textContent = data.summary.successRate;
  document.getElementById('admin-metric-latency').textContent = data.latency ? `${data.latency.avgMs} ms` : 'N/A';
  
  const errCount = data.summary.errorCount + data.summary.timeoutCount;
  document.getElementById('admin-metric-errors').textContent = errCount;

  // Setup analytics chart
  const ctx = document.getElementById('latencyChart').getContext('2d');
  
  if (analyticsChart) {
    analyticsChart.destroy();
  }

  // Generate dataset lists
  const labels = data.byModel.map(m => m.version.toUpperCase());
  const predictions = data.byModel.map(m => m.predictions);
  const latencies = data.byModel.map(m => m.avgLatencyMs);

  analyticsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Prediction Counts',
          data: predictions,
          backgroundColor: 'rgba(139, 92, 246, 0.4)',
          borderColor: '#8b5cf6',
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Avg Latency (ms)',
          data: latencies,
          backgroundColor: 'rgba(6, 182, 212, 0.4)',
          borderColor: '#06b6d4',
          borderWidth: 2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#9ca3af' }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#9ca3af' },
          title: { display: true, text: 'Total Runs', color: '#9ca3af' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#9ca3af' },
          title: { display: true, text: 'Latency (ms)', color: '#9ca3af' }
        }
      },
      plugins: {
        legend: { labels: { color: '#f3f4f6' } }
      }
    }
  });
}

// ── Toast Notification Manager ──────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-solid fa-circle-info';
  if (type === 'success') icon = 'fa-solid fa-circle-check';
  else if (type === 'error') icon = 'fa-solid fa-circle-exclamation';

  toast.innerHTML = `
    <i class="${icon}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Animate slide-out and remove
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// ── Event Listeners Setup ───────────────────────────────────────────────────
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
  const playgroundForm = document.querySelector('#tab-playground form');
  playgroundForm?.addEventListener('submit', handleInference);

  // Copy buttons
  document.querySelector('.copy-json-btn')?.addEventListener('click', copyRawResult);
  document.querySelector('.copy-raw-btn')?.addEventListener('click', copyNewKey);
  
  // API key gen button in keys tab
  const genKeyBtn = document.querySelector('#tab-keys .view-header button');
  genKeyBtn?.addEventListener('click', handleGenerateKey);

  // History filters
  document.getElementById('history-filter-model')?.addEventListener('change', () => loadHistory(1));
  document.getElementById('history-filter-status')?.addEventListener('change', () => loadHistory(1));

  // Pagination buttons
  document.getElementById('pagination-prev')?.addEventListener('click', () => changeHistoryPage(-1));
  document.getElementById('pagination-next')?.addEventListener('click', () => changeHistoryPage(1));

  // Admin slider
  const slider = document.getElementById('traffic-slider');
  if (slider) {
    slider.addEventListener('input', (e) => updateSliderLabels(e.target.value));
    slider.addEventListener('change', (e) => saveTrafficWeights(e.target.value));
  }
}

// Start application
window.onload = () => {
  setupEventListeners();
  initApp();
};

