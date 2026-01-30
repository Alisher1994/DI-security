// API Configuration
const API_BASE = window.location.origin + '/api';
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let realtimeMap = null;
let scansChart = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (!authToken) {
    window.location.href = '/';
    return;
  }

  initializeApp();
});

async function initializeApp() {
  try {
    const data = await apiRequest('/auth/me');
    currentUser = data.user;

    if (currentUser.role !== 'admin') {
      alert('Доступ только для администраторов');
      window.location.href = '/';
      return;
    }

    document.getElementById('admin-name').textContent = currentUser.full_name;

    setupNavigation();
    setupEventListeners();
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Load initial page
    loadDashboard();
  } catch (error) {
    console.error('Failed to load user:', error);
    localStorage.removeItem('authToken');
    window.location.href = '/';
  }
}

// API Helper
async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(API_BASE + endpoint, {
    ...options,
    headers
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }

  return data;
}

// Navigation
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();

      const page = item.dataset.page;

      // Update active nav item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Update active page
      document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
      document.getElementById(`${page}-page`).classList.add('active');

      // Update page title
      const titles = {
        'dashboard': 'Дашборд',
        'realtime': 'Карта Realtime',
        'scans': 'История',
        'checkpoints': 'Контрольные точки',
        'employees': 'Сотрудники'
      };
      document.getElementById('page-title').textContent = titles[page];

      // Load page content
      switch (page) {
        case 'dashboard':
          loadDashboard();
          break;
        case 'realtime':
          loadRealtimeMap();
          break;
        case 'scans':
          loadScans();
          break;
        case 'checkpoints':
          loadCheckpoints();
          break;
        case 'employees':
          loadEmployees();
          break;
      }
    });
  });
}

function setupEventListeners() {
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('refresh-map').addEventListener('click', loadRealtimeMap);
  document.getElementById('add-checkpoint-map').addEventListener('click', () => {
    showNotification('Кликните на карту, чтобы выбрать место для новой точки', 'info');
    // Мы можем просто открыть модалку, но лучше дать пользователю кликнуть на карте
    // Для простоты пока просто открываем модалку, но с функционалом клика на самой карте Realtime позже.
    showCheckpointModal();
  });
  document.getElementById('addCheckpoint').addEventListener('click', () => showCheckpointModal());
  document.getElementById('addEmployee').addEventListener('click', () => showEmployeeModal());
  document.getElementById('applyScanFilter').addEventListener('click', loadScans);
  document.getElementById('clearScanFilter').addEventListener('click', clearScanFilter);
  document.getElementById('exportScans').addEventListener('click', exportScansToCSV);

  // Excel import/export
  document.getElementById('exportEmployees').addEventListener('click', exportEmployeesToXLSX);
  document.getElementById('downloadTemplate').addEventListener('click', downloadImportTemplate);
  document.getElementById('importEmployeesBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importEmployeesFromXLSX);
}

function handleLogout() {
  if (confirm('Вы уверены, что хотите выйти?')) {
    localStorage.removeItem('authToken');
    window.location.href = '/';
  }
}

function updateDateTime() {
  const now = new Date();
  document.getElementById('current-datetime').textContent = now.toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Dashboard
async function loadDashboard() {
  try {
    // Load stats
    const stats = await apiRequest('/scans/stats');
    const checkpoints = await apiRequest('/checkpoints');
    const activePatrols = await apiRequest('/gps/active');

    document.getElementById('totalScans').textContent = stats.stats.total_scans || 0;
    document.getElementById('activeEmployees').textContent = stats.stats.active_users || 0;
    document.getElementById('totalCheckpoints').textContent = checkpoints.checkpoints.length;
    document.getElementById('activePatrols').textContent = activePatrols.active_patrols.length;

    // Load recent scans
    const scans = await apiRequest('/scans?limit=10');
    renderRecentScans(scans.scans);

    // Load charts
    await loadDashboardCharts();
  } catch (error) {
    console.error('Failed to load dashboard:', error);
    showNotification('Ошибка загрузки дашборда', 'error');
  }
}

async function loadDashboardCharts() {
  try {
    // Scans chart - last 7 days
    const scansData = await loadScansChartData();
    renderScansChart(scansData);
  } catch (error) {
    console.error('Failed to load charts:', error);
  }
}

async function loadScansChartData() {
  const days = 7;
  const labels = [];
  const data = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    labels.push(date.toLocaleDateString('ru-RU', {
      timeZone: 'Asia/Tashkent',
      month: 'short',
      day: 'numeric'
    }));

    try {
      const scans = await apiRequest(`/scans?from_date=${dateStr}T00:00:00&to_date=${dateStr}T23:59:59`);
      data.push(scans.scans.length);
    } catch (error) {
      data.push(0);
    }
  }

  return { labels, data };
}

function renderScansChart(chartData) {
  const ctx = document.getElementById('scansChart');

  if (scansChart) {
    scansChart.destroy();
  }

  scansChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: 'Сканирования',
        data: chartData.data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#cbd5e1'
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: '#94a3b8'
          },
          grid: {
            color: '#334155'
          }
        },
        x: {
          ticks: {
            color: '#94a3b8'
          },
          grid: {
            color: '#334155'
          }
        }
      }
    }
  });
}



function renderRecentScans(scans) {
  const container = document.getElementById('recentScans');

  if (scans.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
        <div>Нет недавних сканирований</div>
      </div>
    `;
    return;
  }

  container.innerHTML = scans.map(scan => `
    <div class="activity-item">
      <div class="activity-icon">${scan.is_valid ? '✅' : '❌'}</div>
      <div class="activity-content">
        <div class="activity-title">${scan.checkpoint_name}</div>
        <div class="activity-meta">
          ${scan.user_name} • ${formatDateTime(scan.scan_time)} • ${Math.round(scan.distance_meters)}м
        </div>
      </div>
    </div>
  `).join('');
}

// Realtime Map
async function loadRealtimeMap() {
  try {
    const [checkpoints, activePatrols] = await Promise.all([
      apiRequest('/checkpoints'),
      apiRequest('/gps/active')
    ]);

    if (!realtimeMap) {
      initializeRealtimeMap();
    }

    renderRealtimeMap(checkpoints.checkpoints, activePatrols.active_patrols);
    renderActivePatrolsList(activePatrols.active_patrols);
  } catch (error) {
    console.error('Failed to load realtime map:', error);
    showNotification('Ошибка загрузки карты', 'error');
  }
}

function initializeRealtimeMap() {
  ymaps.ready(() => {
    realtimeMap = new ymaps.Map('realtime-map', {
      center: [41.204358, 69.234420],
      zoom: 14,
      controls: ['zoomControl', 'fullscreenControl', 'typeSelector']
    });

    // Правый клик для добавления точки
    realtimeMap.events.add('contextmenu', (e) => {
      const coords = e.get('coords');
      const menuId = 'map-context-menu';
      let menu = document.getElementById(menuId);

      if (!menu) {
        menu = document.createElement('div');
        menu.id = menuId;
        menu.style.cssText = `
          position: fixed;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px;
          z-index: 10000;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(menu);
      }

      menu.style.display = 'block';
      menu.style.left = e.get('domEvent').get('pageX') + 'px';
      menu.style.top = e.get('domEvent').get('pageY') + 'px';

      menu.innerHTML = `
        <button class="btn btn-success" style="width: 100%; white-space: nowrap; font-size: 0.875rem;" onclick="showCheckpointModal({ latitude: ${coords[0].toFixed(6)}, longitude: ${coords[1].toFixed(6)}, is_new_from_map: true }); document.getElementById('${menuId}').style.display = 'none';">
          ➕ Добавить QR точку
        </button>
      `;

      // Close menu on click elsewhere
      const closeMenu = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 10);

      // Prevent browser default context menu
      e.preventDefault();
    });

    // Клик по карте для добавления точки (сохраняем для удобства)
    realtimeMap.events.add('click', (e) => {
      const coords = e.get('coords');
      showCheckpointModal({ latitude: coords[0].toFixed(6), longitude: coords[1].toFixed(6), is_new_from_map: true });
    });
  });
}

function renderRealtimeMap(checkpoints, patrols) {
  if (!realtimeMap) return;

  realtimeMap.geoObjects.removeAll();

  // Add checkpoints
  checkpoints.forEach(cp => {
    const marker = new ymaps.Placemark([cp.latitude, cp.longitude], {
      balloonContent: `
        <div style="min-width: 200px; padding: 5px; color: #1e293b;">
            <strong style="font-size: 1.1rem; display: block; margin-bottom: 5px;">${cp.name}</strong>
            <div style="margin-bottom: 10px; color: #64748b; font-size: 0.85rem;">
                ${cp.checkpoint_type === 'kpp' ? '🔴 КПП' : '🟢 Патруль'}<br>
                ${cp.description || ''}
            </div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 6px; margin-bottom: 10px;">
                <span style="font-size: 0.85rem;">Активность</span>
                <label class="switch" style="transform: scale(0.8);">
                    <input type="checkbox" ${cp.is_active ? 'checked' : ''} onchange="toggleCheckpointStatus(${cp.id}, this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 5px;">
                <button class="btn btn-primary" onclick="window.open('/print-qr.html?id=${cp.id}&token=${authToken}', '_blank')" style="font-size: 0.85rem; padding: 8px;">
                    📄 PDF
                </button>
                <button class="btn btn-secondary" onclick="editCheckpoint(${cp.id})" style="font-size: 0.85rem; padding: 8px;">
                    ✏️ Изменить
                </button>
            </div>
        </div>
      `
    }, {
      preset: cp.checkpoint_type === 'kpp' ? 'islands#redDotIcon' : 'islands#greenDotIcon'
    });

    realtimeMap.geoObjects.add(marker);

    // Добавляем радиус только если точка активна
    if (cp.is_active) {
      const circle = new ymaps.Circle([[cp.latitude, cp.longitude], cp.radius_meters], {}, {
        fillColor: cp.checkpoint_type === 'kpp' ? '#ef444420' : '#10b98120',
        strokeColor: cp.checkpoint_type === 'kpp' ? '#ef4444' : '#10b981',
        strokeOpacity: 0.5,
        strokeWidth: 2
      });

      realtimeMap.geoObjects.add(circle);
    }
  });

  // Add active patrols
  patrols.forEach(patrol => {
    if (patrol.latitude && patrol.longitude) {
      const marker = new ymaps.Placemark([patrol.latitude, patrol.longitude], {
        hintContent: patrol.full_name,
        balloonContent: `
          <strong>${patrol.full_name}</strong><br>
          <small>Последнее обновление: ${formatDateTime(patrol.recorded_at)}</small><br>
          <small>Точность: ${Math.round(patrol.accuracy)}м</small>
        `
      }, {
        // Используем эмодзи вместо стандартного значка
        iconLayout: 'default#imageWithContent',
        iconImageHref: '',
        iconImageSize: [52, 52],
        iconImageOffset: [-26, -45],
        iconContentLayout: ymaps.templateLayoutFactory.createClass(
          `<div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">👮</div>
            <div style="background: rgba(15, 23, 42, 0.9); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
                <div style="font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 2px; padding-bottom: 1px;">${patrol.full_name.split(' ')[0]}</div>
                <div>${new Date(patrol.recorded_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
           </div>`
        )
      });

      realtimeMap.geoObjects.add(marker);
    }
  });
}

function renderActivePatrolsList(patrols) {
  const container = document.getElementById('activePatrolsList');

  if (patrols.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🚶</div>
        <div>Нет активных патрулей</div>
      </div>
    `;
    return;
  }

  container.innerHTML = patrols.map(patrol => `
    <div class="activity-item">
      <div class="activity-icon">👤</div>
      <div class="activity-content">
        <div class="activity-title">${patrol.full_name}</div>
        <div class="activity-meta">
          ${patrol.recorded_at ? `Последнее обновление: ${formatDateTime(patrol.recorded_at)}` : 'Нет GPS данных'}
        </div>
      </div>
      <span class="badge badge-success">Активен</span>
    </div>
  `).join('');
}

// Scans History
async function loadScans() {
  try {
    let endpoint = '/scans';
    const params = new URLSearchParams();

    const filterFrom = document.getElementById('scanFilterFrom');
    const filterTo = document.getElementById('scanFilterTo');

    // По умолчанию ставим сегодня, если фильтры пустые
    if (!filterFrom.value && !filterTo.value) {
      const today = new Date().toISOString().split('T')[0];
      filterFrom.value = today;
      filterTo.value = today;
      console.log('📅 Setting default filter to today:', today);
    }

    const fromDate = filterFrom.value;
    const toDate = filterTo.value;
    const userId = document.getElementById('scanFilterUser').value;

    if (fromDate) params.append('from_date', fromDate + 'T00:00:00');
    if (toDate) params.append('to_date', toDate + 'T23:59:59');
    if (userId) params.append('user_id', userId);
    params.append('limit', '500'); // Увеличили лимит для истории

    const queryString = params.toString();
    if (queryString) {
      endpoint += '?' + queryString;
    }

    const data = await apiRequest(endpoint);
    renderScansTable(data.scans);
    renderScansSummary(data.scans);

    // Load employees for filter if not loaded
    if (document.getElementById('scanFilterUser').options.length === 1) {
      const employees = await apiRequest('/employees');
      populateEmployeeFilter(employees.employees);
    }
  } catch (error) {
    console.error('Failed to load scans:', error);
    showNotification('Ошибка загрузки сканирований', 'error');
  }
}

function renderScansTable(scans) {
  const tbody = document.getElementById('scansTableBody');

  if (scans.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
          <div>Нет сканирований</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = scans.map(scan => `
    <tr>
      <td>${scan.id}</td>
      <td>${formatDateTime(scan.scan_time)}</td>
      <td>${scan.user_name}</td>
      <td>${scan.checkpoint_name}</td>
      <td>${Math.round(scan.distance_meters)}</td>
      <td>
        <span class="badge ${scan.is_valid ? 'badge-success' : 'badge-danger'}">
          ${scan.is_valid ? 'Валидно' : 'Невалидно'}
        </span>
      </td>
    </tr>
  `).join('');
}

function renderScansSummary(scans) {
  const summarySection = document.getElementById('scansSummarySection');
  const tbody = document.getElementById('scansSummaryTableBody');

  if (scans.length === 0) {
    summarySection.style.display = 'none';
    return;
  }

  summarySection.style.display = 'block';

  // Группировка
  const summary = scans.reduce((acc, scan) => {
    const key = scan.user_name || `ID: ${scan.user_id}`;
    if (!acc[key]) {
      acc[key] = {
        count: 0,
        lastSeen: scan.scan_time,
        checkpoints: new Set()
      };
    }
    acc[key].count++;
    acc[key].checkpoints.add(scan.checkpoint_name);
    if (new Date(scan.scan_time) > new Date(acc[key].lastSeen)) {
      acc[key].lastSeen = scan.scan_time;
    }
    return acc;
  }, {});

  tbody.innerHTML = Object.entries(summary).sort((a, b) => b[1].count - a[1].count).map(([name, stats]) => `
    <tr>
      <td style="font-weight: 600;">${name}</td>
      <td>
        <span class="badge badge-primary" style="font-size: 1rem; padding: 0.5rem 1rem;">${stats.count}</span>
      </td>
      <td>${formatDateTime(stats.lastSeen)}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">
        ${Array.from(stats.checkpoints).slice(0, 3).join(', ')}${stats.checkpoints.size > 3 ? '...' : ''}
      </td>
    </tr>
  `).join('');
}

function populateEmployeeFilter(employees) {
  const select = document.getElementById('scanFilterUser');
  employees.forEach(emp => {
    const option = document.createElement('option');
    option.value = emp.id;
    option.textContent = emp.full_name;
    select.appendChild(option);
  });
}

function clearScanFilter() {
  document.getElementById('scanFilterFrom').value = '';
  document.getElementById('scanFilterTo').value = '';
  document.getElementById('scanFilterUser').value = '';
  loadScans();
}

async function exportScansToCSV() {
  try {
    showNotification('Подготовка данных...', 'info');

    const fromDate = document.getElementById('scanFilterFrom').value;
    const toDate = document.getElementById('scanFilterTo').value;
    const userId = document.getElementById('scanFilterUser').value;

    let endpoint = '/scans?limit=5000';
    if (fromDate) endpoint += `&from_date=${fromDate}T00:00:00`;
    if (toDate) endpoint += `&to_date=${toDate}T23:59:59`;
    if (userId) endpoint += `&user_id=${userId}`;

    const data = await apiRequest(endpoint);
    const scans = data.scans;

    if (scans.length === 0) {
      showNotification('Нет данных для экспорта', 'warning');
      return;
    }

    // Формируем CSV
    const headers = ['ID', 'Дата/Время', 'Сотрудник', 'Контрольная точка', 'Тип', 'Расстояние (м)', 'Статус', 'Заметки'];
    const rows = scans.map(s => [
      s.id,
      formatDateTime(s.scan_time),
      s.user_name,
      s.checkpoint_name,
      s.checkpoint_type === 'kpp' ? 'КПП' : 'Патруль',
      Math.round(s.distance_meters),
      s.is_valid ? 'Валидно' : 'Невалидно',
      (s.notes || '').replace(/,/g, ';')
    ]);

    const csvContent = "\uFEFF" + [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `scans_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotification('CSV файл скачан', 'success');
  } catch (error) {
    console.error('Export failed:', error);
    showNotification('Ошибка экспорта', 'error');
  }
}

// Checkpoints Management
async function loadCheckpoints() {
  try {
    const data = await apiRequest('/checkpoints');
    renderCheckpointsGrid(data.checkpoints);
  } catch (error) {
    console.error('Failed to load checkpoints:', error);
    showNotification('Ошибка загрузки контрольных точек', 'error');
  }
}

function renderCheckpointsGrid(checkpoints) {
  const grid = document.getElementById('checkpointsGrid');

  if (checkpoints.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">
        <div style="font-size: 3rem; margin-bottom: 1rem;">📍</div>
        <div>Нет контрольных точек</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = checkpoints.map(cp => `
    <div class="checkpoint-card">
      <div class="card-header">
        <div>
          <div class="card-title">${cp.name}</div>
          <div class="card-subtitle">${cp.checkpoint_type === 'kpp' ? 'КПП' : 'Точка патруля'}</div>
        </div>
        <div class="card-status-toggle">
          <label class="switch">
            <input type="checkbox" ${cp.is_active ? 'checked' : ''} onchange="toggleCheckpointStatus(${cp.id}, this.checked)">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="card-body">
        <div class="card-info">
          <div class="card-info-item">
            <span class="card-info-label">Код для ввода:</span>
            <span style="font-weight: bold; color: var(--primary); font-size: 1.1rem;">${cp.short_code || '—'}</span>
          </div>
          <div class="card-info-item">
            <span class="card-info-label">Координаты:</span>
            <span>${parseFloat(cp.latitude).toFixed(6)}, ${parseFloat(cp.longitude).toFixed(6)}</span>
          </div>
          <div class="card-info-item">
            <span class="card-info-label">Радиус:</span>
            <span>${cp.radius_meters} м</span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-secondary btn-icon" onclick="viewQRCode(${cp.id})" title="QR-код и печать">📷</button>
        <button class="btn btn-secondary btn-icon" onclick="editCheckpoint(${cp.id})" title="Редактировать">✏️</button>
        <button class="btn btn-danger btn-icon" onclick="deleteCheckpoint(${cp.id})" title="Удалить">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function viewQRCode(id) {
  try {
    const data = await apiRequest(`/checkpoints/${id}/qrcode`);

    showModal({
      title: `QR-код: ${data.name}`,
      content: `
        <div style="text-align: center; padding: 2rem;">
          <img src="${data.qr_code}" alt="QR Code" style="max-width: 250px; height: auto; border-radius: 1rem; border: 1px solid var(--border);">
          <div style="margin-top: 1.5rem;">
            <div style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem;">Код для ручного ввода:</div>
            <div style="font-size: 2.5rem; font-weight: bold; color: var(--text-primary); letter-spacing: 5px;">${data.short_code}</div>
          </div>
          <div style="margin-top: 2rem; display: flex; flex-direction: column; gap: 0.75rem;">
            <button class="btn btn-primary" onclick="window.open('/print-qr.html?id=${id}&token=${authToken}', '_blank')" style="width: 100%;">
              🖨️ Скачать для печати (A4 Прямая печать)
            </button>
            <button class="btn btn-secondary" onclick="downloadQRCode('${data.qr_code}', '${data.name}')" style="width: 100%;">
              💾 Скачать только QR
            </button>
          </div>
        </div>
      `
    });
  } catch (error) {
    showNotification('Ошибка загрузки QR-кода', 'error');
  }
}

function downloadQRCode(dataUrl, name) {
  const link = document.createElement('a');
  link.download = `QR_${name.replace(/\s+/g, '_')}.png`;
  link.href = dataUrl;
  link.click();
}

function showCheckpointModal(checkpoint = null) {
  const isEdit = checkpoint !== null && !checkpoint.is_new_from_map;
  const isNewFromMap = checkpoint?.is_new_from_map;

  showModal({
    title: isEdit ? 'Редактировать точку' : 'Новая контрольная точка',
    content: `
      <form id="checkpointForm" class="modal-form">
        <div class="form-group">
          <label>Название</label>
          <input type="text" name="name" class="input-field" value="${isEdit ? checkpoint.name : ''}" required>
        </div>
        
        <div class="form-group">
          <label>Выберите местоположение на карте (кликните или перетащите маркер)</label>
          <div id="modal-map" style="height: 350px; width: 100%; margin-bottom: 1rem; border-radius: 0.5rem; overflow: hidden; border: 1px solid var(--border);"></div>
        </div>

        <div class="form-group">
          <label>Описание</label>
          <textarea name="description" class="input-field" rows="2">${isEdit ? (checkpoint.description || '') : ''}</textarea>
        </div>
        <div class="form-group">
          <label>Тип</label>
          <select name="checkpoint_type" class="input-field" required>
            <option value="kpp" ${isEdit && checkpoint.checkpoint_type === 'kpp' ? 'selected' : ''}>КПП</option>
            <option value="patrol" ${isEdit && checkpoint.checkpoint_type === 'patrol' ? 'selected' : ''}>Патруль</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Широта</label>
            <input type="number" step="0.000001" name="latitude" id="modal-lat" class="input-field" value="${checkpoint ? checkpoint.latitude : '41.204358'}" required>
          </div>
          <div class="form-group">
            <label>Долгота</label>
            <input type="number" step="0.000001" name="longitude" id="modal-lng" class="input-field" value="${checkpoint ? checkpoint.longitude : '69.234420'}" required>
          </div>
        </div>
        <div class="form-group">
          <label>Радиус (метры)</label>
          <input type="number" name="radius_meters" class="input-field" value="${isEdit ? checkpoint.radius_meters : 50}" min="10" max="500" required>
        </div>

        <div class="switch-label-group">
          <span class="switch-label">Точка активна</span>
          <label class="switch">
            <input type="checkbox" name="is_active" ${!isEdit || checkpoint.is_active ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Отмена</button>
          <button type="submit" class="btn btn-success">${isEdit ? 'Сохранить' : 'Создать'}</button>
        </div>
      </form>
    `,
    onLoad: () => {
      // Initialize map inside timeout to ensure container is ready
      setTimeout(() => {
        const initialLat = parseFloat(checkpoint ? checkpoint.latitude : 41.204358);
        const initialLng = parseFloat(checkpoint ? checkpoint.longitude : 69.234420);

        ymaps.ready(() => {
          const mContainer = document.getElementById('modal-map');
          if (!mContainer) return;

          const modalMap = new ymaps.Map('modal-map', {
            center: [initialLat, initialLng],
            zoom: 15,
            controls: ['zoomControl', 'fullscreenControl', 'typeSelector']
          });

          // Create marker
          const modalMarker = new ymaps.Placemark([initialLat, initialLng], {
            balloonContent: 'Выбранная точка'
          }, {
            preset: 'islands#blueDotIconWithCaption',
            draggable: true
          });

          modalMap.geoObjects.add(modalMarker);

          // Update inputs when marker is dragged
          modalMarker.events.add('dragend', () => {
            const coords = modalMarker.geometry.getCoordinates();
            document.getElementById('modal-lat').value = coords[0].toFixed(6);
            document.getElementById('modal-lng').value = coords[1].toFixed(6);
          });

          // Click on map to move marker
          modalMap.events.add('click', (e) => {
            const coords = e.get('coords');
            modalMarker.geometry.setCoordinates(coords);
            document.getElementById('modal-lat').value = coords[0].toFixed(6);
            document.getElementById('modal-lng').value = coords[1].toFixed(6);
          });

          // Sync inputs back to map if manually changed
          ['modal-lat', 'modal-lng'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
              const latInput = document.getElementById('modal-lat');
              const lngInput = document.getElementById('modal-lng');
              if (!latInput || !lngInput) return;

              const lat = parseFloat(latInput.value);
              const lng = parseFloat(lngInput.value);
              if (!isNaN(lat) && !isNaN(lng)) {
                modalMarker.geometry.setCoordinates([lat, lng]);
                modalMap.setCenter([lat, lng]);
              }
            });
          });
        });
      }, 100);

      document.getElementById('checkpointForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Обработка чекбокса активности
        data.is_active = formData.get('is_active') === 'on';
        data.latitude = parseFloat(data.latitude);
        data.longitude = parseFloat(data.longitude);
        data.radius_meters = parseInt(data.radius_meters);

        try {
          if (isEdit) {
            await apiRequest(`/checkpoints/${checkpoint.id}`, {
              method: 'PUT',
              body: JSON.stringify(data)
            });
            showNotification('Точка обновлена', 'success');
          } else {
            await apiRequest('/checkpoints', {
              method: 'POST',
              body: JSON.stringify(data)
            });
            showNotification('Точка создана', 'success');
          }

          closeModal();
          // Обновляем текущую активную страницу
          const activePage = document.querySelector('.page-content.active')?.id;
          if (activePage === 'realtime-page') {
            loadRealtimeMap();
          } else {
            loadCheckpoints();
          }
        } catch (error) {
          showNotification(error.message, 'error');
        }
      });
    }
  });
}

async function editCheckpoint(id) {
  try {
    const data = await apiRequest(`/checkpoints/${id}`);
    showCheckpointModal(data.checkpoint);
  } catch (error) {
    showNotification('Ошибка загрузки точки', 'error');
  }
}

async function deleteCheckpoint(id) {
  if (!confirm('Удалить контрольную точку?')) return;

  try {
    await apiRequest(`/checkpoints/${id}`, { method: 'DELETE' });
    showNotification('Точка удалена', 'success');
    loadCheckpoints();
  } catch (error) {
    showNotification(error.message, 'error');
  }
}

async function toggleCheckpointStatus(id, isActive) {
  try {
    const cp = await apiRequest(`/checkpoints/${id}`);
    const data = { ...cp.checkpoint, is_active: isActive };

    // Очищаем лишние поля перед отправкой
    delete data.id;
    delete data.created_at;
    delete data.updated_at;

    await apiRequest(`/checkpoints/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });

    showNotification(`Точка ${isActive ? 'активирована' : 'деактивирована'}`, 'success');

    // Обновляем текущую активную страницу
    const activePage = document.querySelector('.page-content.active')?.id;
    if (activePage === 'realtime-page') {
      loadRealtimeMap();
    } else if (activePage === 'checkpoints-page') {
      loadCheckpoints();
    }
  } catch (error) {
    console.error(error);
    showNotification('Ошибка при смене статуса', 'error');

    // Возвращаем состояние если ошибка
    const activePage = document.querySelector('.page-content.active')?.id;
    if (activePage === 'realtime-page') loadRealtimeMap();
    else if (activePage === 'checkpoints-page') loadCheckpoints();
  }
}

// Employees Management
async function loadEmployees() {
  try {
    const data = await apiRequest('/employees');
    renderEmployeesTable(data.employees);
  } catch (error) {
    console.error('Failed to load employees:', error);
    showNotification('Ошибка загрузки сотрудников', 'error');
  }
}

function renderEmployeesTable(employees) {
  const tbody = document.getElementById('employeesTableBody');

  if (employees.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">👥</div>
          <div>Нет сотрудников</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = employees.map(emp => `
    <tr>
      <td>${emp.id}</td>
      <td>${emp.full_name}</td>
      <td>${emp.phone || '-'}</td>
      <td>
        <span class="badge ${emp.role === 'admin' ? 'badge-danger' : 'badge-success'}">
          ${getRoleLabel(emp.role)}
        </span>
      </td>
      <td>
        <button class="btn btn-secondary btn-icon" onclick="editEmployee(${emp.id})" title="Редактировать">✏️</button>
        ${emp.id !== currentUser.id ? `<button class="btn btn-danger btn-icon" onclick="deleteEmployee(${emp.id})" title="Удалить">🗑️</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function getRoleLabel(role) {
  const labels = { 'admin': 'Администратор', 'kpp': 'КПП', 'patrol': 'Патруль' };
  return labels[role] || role;
}

function showEmployeeModal(employee = null) {
  const isEdit = employee !== null;

  showModal({
    title: isEdit ? 'Редактировать сотрудника' : 'Новый сотрудник',
    content: `
      <form id="employeeForm" class="modal-form">
        <div class="form-group">
          <label>Фамилия *</label>
          <input type="text" name="last_name" class="input-field" value="${isEdit ? (employee.last_name || '') : ''}" required>
        </div>
        <div class="form-group">
          <label>Имя *</label>
          <input type="text" name="first_name" class="input-field" value="${isEdit ? (employee.first_name || '') : ''}" required>
        </div>
        <div class="form-group">
          <label>Отчество</label>
          <input type="text" name="patronymic" class="input-field" value="${isEdit ? (employee.patronymic || '') : ''}">
        </div>
        <div class="form-group">
          <label>Телефон *</label>
          <div class="phone-input-group">
            <span class="phone-prefix-admin">+998</span>
            <input type="tel" name="phone_input" id="phone_input" class="input-field phone-field" value="${isEdit ? (employee.phone ? employee.phone.replace('+998', '') : '') : ''}" placeholder="XX XXX XX XX" maxlength="12" required>
          </div>
        </div>
        <div class="form-group">
          <label>Роль *</label>
          <select name="role" class="input-field" required>
            <option value="kpp" ${isEdit && employee.role === 'kpp' ? 'selected' : ''}>КПП</option>
            <option value="patrol" ${isEdit && employee.role === 'patrol' ? 'selected' : ''}>Патруль</option>
            <option value="admin" ${isEdit && employee.role === 'admin' ? 'selected' : ''}>Администратор</option>
          </select>
        </div>
        ${!isEdit ? `
          <div class="form-group">
            <label>Пароль *</label>
            <input type="password" name="password" class="input-field" minlength="6" required>
          </div>
        ` : `
          <div class="form-group">
            <label>Новый пароль (оставьте пустым, чтобы не менять)</label>
            <input type="password" name="password" class="input-field" minlength="6">
          </div>
        `}
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Отмена</button>
          <button type="submit" class="btn btn-success">${isEdit ? 'Сохранить' : 'Создать'}</button>
        </div>
      </form>
    `,
    onLoad: () => {
      document.getElementById('employeeForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const data = {};

        // Собираем данные
        data.first_name = formData.get('first_name');
        data.last_name = formData.get('last_name');
        data.patronymic = formData.get('patronymic') || '';
        data.phone = '+998' + formData.get('phone_input').replace(/\s/g, '');
        data.role = formData.get('role');

        const password = formData.get('password');
        if (password) data.password = password;

        try {
          if (isEdit) {
            await apiRequest(`/employees/${employee.id}`, {
              method: 'PUT',
              body: JSON.stringify(data)
            });
            showNotification('Сотрудник обновлен', 'success');
          } else {
            await apiRequest('/employees', {
              method: 'POST',
              body: JSON.stringify(data)
            });
            showNotification('Сотрудник создан', 'success');
          }

          closeModal();
          loadEmployees();
        } catch (error) {
          showNotification(error.message, 'error');
        }
      });
    }
  });
}

async function editEmployee(id) {
  try {
    const data = await apiRequest(`/employees/${id}`);
    showEmployeeModal(data.employee);
  } catch (error) {
    showNotification('Ошибка загрузки сотрудника', 'error');
  }
}

async function deleteEmployee(id) {
  if (!confirm('Удалить сотрудника?')) return;

  try {
    await apiRequest(`/employees/${id}`, { method: 'DELETE' });
    showNotification('Сотрудник удален', 'success');
    loadEmployees();
  } catch (error) {
    showNotification(error.message, 'error');
  }
}

// Excel Export/Import Functions
async function exportEmployeesToXLSX() {
  try {
    showNotification('Скачивание...', 'info');

    const response = await fetch('/api/employees/export/xlsx', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Ошибка экспорта');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employees_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    showNotification('Файл скачан', 'success');
  } catch (error) {
    showNotification('Ошибка экспорта: ' + error.message, 'error');
  }
}

async function downloadImportTemplate() {
  try {
    const response = await fetch('/api/employees/import/template', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Ошибка скачивания шаблона');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import_template.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    showNotification('Шаблон скачан', 'success');
  } catch (error) {
    showNotification('Ошибка: ' + error.message, 'error');
  }
}

async function importEmployeesFromXLSX(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    showNotification('Импорт данных...', 'info');

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/employees/import/xlsx', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Ошибка импорта');
    }

    // Показываем результаты импорта
    showImportResults(data);

    // Обновляем список сотрудников
    loadEmployees();

  } catch (error) {
    showNotification('Ошибка импорта: ' + error.message, 'error');
  }

  // Сбрасываем input
  e.target.value = '';
}

function showImportResults(data) {
  const successCount = data.results.success.length;
  const errorCount = data.results.errors.length;

  let content = `
    <div class="import-results">
      <div class="import-summary">
        <div class="summary-item success">
          <span class="count">${successCount}</span>
          <span class="label">Успешно добавлено</span>
        </div>
        <div class="summary-item ${errorCount > 0 ? 'error' : ''}">
          <span class="count">${errorCount}</span>
          <span class="label">Ошибок</span>
        </div>
      </div>
  `;

  if (data.results.success.length > 0) {
    content += `
      <div class="results-section">
        <h4>✅ Добавленные сотрудники:</h4>
        <ul class="results-list success-list">
          ${data.results.success.map(s => `<li>${s.name} (${s.phone})</li>`).join('')}
        </ul>
      </div>
    `;
  }

  if (data.results.errors.length > 0) {
    content += `
      <div class="results-section">
        <h4>❌ Ошибки:</h4>
        <ul class="results-list error-list">
          ${data.results.errors.map(e => `<li>Строка ${e.row}: ${e.error}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  content += `
      <div class="form-actions">
        <button type="button" class="btn btn-primary" onclick="closeModal()">Закрыть</button>
      </div>
    </div>
  `;

  showModal({
    title: 'Результаты импорта',
    content: content
  });
}

// Shifts Management
async function loadShifts() {
  try {
    const data = await apiRequest('/shifts');
    renderShiftsTable(data.shifts);
  } catch (error) {
    console.error('Failed to load shifts:', error);
    showNotification('Ошибка загрузки смен', 'error');
  }
}

function renderShiftsTable(shifts) {
  const tbody = document.getElementById('shiftsTableBody');

  if (shifts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🗓️</div>
          <div>Нет смен</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = shifts.map(shift => `
    <tr>
      <td>${shift.id}</td>
      <td>${formatDate(shift.shift_date)}</td>
      <td>${shift.full_name}</td>
      <td>${shift.shift_start.slice(0, 5)}</td>
      <td>${shift.shift_end.slice(0, 5)}</td>
      <td>
        <span class="badge ${shift.is_active ? 'badge-success' : 'badge-danger'}">
          ${shift.is_active ? 'Активна' : 'Неактивна'}
        </span>
      </td>
      <td>
        <button class="btn btn-secondary btn-icon" onclick="editShift(${shift.id})" title="Редактировать">✏️</button>
        <button class="btn btn-danger btn-icon" onclick="deleteShift(${shift.id})" title="Удалить">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function showShiftModal(shift = null) {
  const isEdit = shift !== null;

  // Load employees first
  apiRequest('/employees').then(data => {
    const employeesOptions = data.employees
      .filter(e => e.role !== 'admin')
      .map(e => `<option value="${e.id}" ${isEdit && shift.user_id === e.id ? 'selected' : ''}>${e.full_name}</option>`)
      .join('');

    showModal({
      title: isEdit ? 'Редактировать смену' : 'Новая смена',
      content: `
        <form id="shiftForm" class="modal-form">
          <div class="form-group">
            <label>Сотрудник</label>
            <select name="user_id" class="input-field" required>
              <option value="">Выберите сотрудника</option>
              ${employeesOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Дата</label>
            <input type="date" name="shift_date" class="input-field" value="${isEdit ? (shift.shift_date.includes('T') ? shift.shift_date.split('T')[0] : shift.shift_date) : new Date().toISOString().split('T')[0]}" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Начало</label>
              <input type="time" name="shift_start" class="input-field" value="${isEdit ? shift.shift_start.slice(0, 5) : '08:00'}" required>
            </div>
            <div class="form-group">
              <label>Конец</label>
              <input type="time" name="shift_end" class="input-field" value="${isEdit ? shift.shift_end.slice(0, 5) : '20:00'}" required>
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" onclick="closeModal()">Отмена</button>
            <button type="submit" class="btn btn-success">${isEdit ? 'Сохранить' : 'Создать'}</button>
          </div>
        </form>
      `,
      onLoad: () => {
        document.getElementById('shiftForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());

          try {
            if (isEdit) {
              await apiRequest(`/shifts/${shift.id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
              });
              showNotification('Смена обновлена', 'success');
            } else {
              await apiRequest('/shifts', {
                method: 'POST',
                body: JSON.stringify(data)
              });
              showNotification('Смена создана', 'success');
            }

            closeModal();
            loadShifts();
          } catch (error) {
            showNotification(error.message, 'error');
          }
        });
      }
    });
  });
}

async function editShift(id) {
  try {
    const data = await apiRequest('/shifts');
    const shift = data.shifts.find(s => s.id === id);
    if (shift) showShiftModal(shift);
  } catch (error) {
    showNotification('Ошибка загрузки смены', 'error');
  }
}

async function deleteShift(id) {
  if (!confirm('Удалить смену?')) return;

  try {
    await apiRequest(`/shifts/${id}`, { method: 'DELETE' });
    showNotification('Смена удалена', 'success');
    loadShifts();
  } catch (error) {
    showNotification(error.message, 'error');
  }
}

// Modal System
function showModal({ title, content, onLoad }) {
  const container = document.getElementById('modalContainer');

  container.innerHTML = `
    <div class="modal active">
      <div class="modal-content">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    </div>
  `;

  if (onLoad) {
    setTimeout(onLoad, 100);
  }
}

function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

// Notifications
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'success' ? 'var(--success)' : 'var(--danger)'};
    color: white;
    border-radius: 0.5rem;
    box-shadow: var(--shadow-lg);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Utilities
function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Add modal and animation styles
const style = document.createElement('style');
style.textContent = `
  .modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  
  .modal.active {
    display: flex;
    animation: fadeIn 0.2s;
  }
  
  .modal-content {
    background: var(--bg-secondary);
    border-radius: 1rem;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
    border: 1px solid var(--border);
  }
  
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  
  .modal-header h2 {
    font-size: 1.25rem;
    font-weight: 700;
  }
  
  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    transition: all 0.2s;
  }
  
  .modal-close:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .modal-body {
    padding: 1.5rem;
  }
  
  .modal-form .form-group {
    margin-bottom: 1rem;
  }
  
  .modal-form label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  
  .modal-form textarea {
    resize: vertical;
    min-height: 80px;
  }
  
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  
  .form-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }
  
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

