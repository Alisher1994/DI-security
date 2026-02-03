// API Configuration
const API_BASE = window.location.origin + '/api';
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let realtimeMap = null;
let scansChart = null;
let realtimeUpdateInterval = null;
let mapProvider = 'leaflet'; // 'leaflet' (OpenStreetMap), 'yandex', 'google'
let mapMarkers = []; // Хранение маркеров для Leaflet
let territoryPolygon = []; // Координаты территории
let territoryLayer = null; // Слой полигона на карте
let isTerritoryEditMode = false;
let territoryEditMarkers = []; // Маркеры границ при редактировании
let allEmployees = []; // Хранилище всех сотрудников для фильтрации
let employeeCurrentPage = 1;
let employeeItemsPerPage = 10;
let selectedEmployeeIds = [];
let isTerritoryModalOpen = false;
let recentScansLimit = 10;
let mapVisibility = {
  employees: true,
  empInfo: true,
  posts: true,
  points: true,
  names: true
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Даем браузеру время продышаться, если мы только что после редиректа
  await new Promise(resolve => setTimeout(resolve, 100));

  authToken = localStorage.getItem('authToken');
  console.log('💎 Проверка авторизации админа...');

  if (!authToken) {
    console.warn('🔑 Токен не найден, переход на логин');
    window.location.replace('/');
    return;
  }

  initializeApp();
});

async function initializeApp() {
  try {
    const data = await apiRequest('/auth/me');
    currentUser = data.user;

    if (currentUser.role !== 'admin') {
      console.error('🚫 Ошибка: пользователь не админ', currentUser.role);
      alert('Доступ только для администраторов');
      localStorage.removeItem('authToken');
      window.location.replace('/');
      return;
    }

    document.getElementById('admin-name').textContent = currentUser.full_name;

    setupNavigation();
    setupEventListeners();
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Dynamic copyright year
    const copyrightEl = document.getElementById('developer-copyright');
    if (copyrightEl) {
      const startYear = 2026;
      const currentYear = new Date().getFullYear();
      const yearStr = currentYear > startYear ? `${startYear} - ${currentYear}` : `${startYear}`;
      copyrightEl.textContent = `Приложение разработано YTT "MUSAYEV ALISHER" ${yearStr}`;
    }

    initializeKPIFilters();
    initializeMapTimeFilter();

    // Load initial page
    loadDashboard();
  } catch (error) {
    console.error('❌ Ошибка инициализации админа:', error);

    // Если сервер ответил "Unauthorized" или "Forbidden"
    if (error.status === 401 || error.status === 403 || error.message.toLowerCase().includes('токен') || error.message.toLowerCase().includes('аутентификация')) {
      console.warn('🔚 Сессия невалидна, сброс');
      localStorage.removeItem('authToken');
      window.location.replace('/');
    } else {
      showNotification('Ошибка связи с сервером. Попробуйте обновить страницу.', 'error');
    }
  }
}

function initializeMapTimeFilter() {
  const select = document.getElementById('map-time-filter');
  if (!select) return;

  const savedValue = select.value;
  const now = new Date();
  const currentHour = now.getHours();

  // Очищаем текущие опции
  select.innerHTML = '';

  let shiftStartHour = 8;
  let shiftBaseDate = new Date(now);

  if (currentHour >= 8 && currentHour < 20) {
    // Дневная смена: 08:00 - 20:00
    shiftStartHour = 8;
  } else {
    // Ночная смена: 20:00 - 08:00
    shiftStartHour = 20;
    if (currentHour < 8) {
      // Если сейчас глубокая ночь (00-07), то начало смены было вчера в 20:00
      shiftBaseDate.setDate(shiftBaseDate.getDate() - 1);
    }
  }

  // Создаем точки от начала смены до текущего момента
  const startDate = new Date(shiftBaseDate);
  startDate.setHours(shiftStartHour, 0, 0, 0);

  const tempDate = new Date(startDate);
  while (tempDate <= now) {
    const isToday = tempDate.getDate() === now.getDate();
    const h = tempDate.getHours();

    // ISO формат для значения (для API)
    const val = tempDate.toISOString();

    // Читаемый формат для текста
    let label = tempDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (!isToday) label += ' (вчера)';
    if (h === currentHour && isToday && now.getMinutes() > 0) label = 'Текущий час';

    const option = document.createElement('option');
    option.value = val;
    option.textContent = label;
    select.appendChild(option);

    tempDate.setHours(tempDate.getHours() + 1);
  }

  // Восстанавливаем значение если оно еще валидно
  const options = Array.from(select.options).map(o => o.value);
  if (savedValue && options.includes(savedValue)) {
    select.value = savedValue;
  } else {
    // По умолчанию - начало смены (первый элемент)
    select.value = startDate.toISOString();
  }

  if (!select.dataset.listenerAdded) {
    select.addEventListener('change', () => {
      loadRealtimeMap();
    });
    select.dataset.listenerAdded = "true";
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
    const error = new Error(data.error || 'Ошибка запроса');
    error.status = response.status;
    throw error;
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

      // Switch buttons in header
      const actionContainers = document.querySelectorAll('.tab-actions');
      actionContainers.forEach(container => container.style.display = 'none');
      const activeContainer = document.getElementById(`actions-${page}`);
      if (activeContainer) activeContainer.style.display = 'flex';

      // Close filters when switching tabs
      document.querySelectorAll('.filter-row').forEach(row => row.classList.remove('active'));
      document.querySelectorAll('.toggle-filter-btn').forEach(btn => btn.classList.remove('btn-active'));
      const scansFilters = document.querySelector('#scans-page .filters');
      if (scansFilters) scansFilters.style.display = 'none';

      // Load page content
      // Очищаем интервал обновления realtime карты при переходе на другую страницу
      if (realtimeUpdateInterval) {
        clearInterval(realtimeUpdateInterval);
        realtimeUpdateInterval = null;
      }

      switch (page) {
        case 'dashboard':
          loadDashboard();
          break;
        case 'realtime':
          initializeMapTimeFilter();
          loadRealtimeMap();
          // Force map resize after transition
          setTimeout(() => {
            if (realtimeMap && mapProvider === 'leaflet') {
              realtimeMap.invalidateSize();
            }
          }, 300);
          // Автоматическое обновление каждые 10 секунд
          realtimeUpdateInterval = setInterval(() => {
            loadRealtimeMap();
          }, 10000);
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
        case 'kpi':
          loadKPI();
          break;
      }
    });
  });
}

function safeAddEventListener(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`⚠️ Элемент с id "${id}" не найден в DOM. Событие "${event}" не привязано.`);
  }
}

function setupEventListeners() {
  safeAddEventListener('logout-btn', 'click', handleLogout);
  safeAddEventListener('mobile-logout-btn', 'click', handleLogout);
  safeAddEventListener('loadMoreRecentScans', 'click', loadMoreRecentScans);
  safeAddEventListener('refresh-dashboard', 'click', () => {
    showNotification('Обновление данных...', 'info');
    loadDashboardStats();
    loadRecentScans();
  });
  safeAddEventListener('refresh-map-header', 'click', loadRealtimeMap);
  safeAddEventListener('add-checkpoint-map-header', 'click', () => {
    showNotification('Кликните на карту, чтобы выбрать место для новой точки', 'info');
    showCheckpointModal();
  });
  safeAddEventListener('addCheckpointHeader', 'click', () => showCheckpointModal());
  safeAddEventListener('addEmployeeHeader', 'click', () => showEmployeeModal());
  safeAddEventListener('applyScanFilter', 'click', () => {
    // Assuming loadScans handles its own pagination reset or starts from page 1 by default
    loadScans();
  });
  safeAddEventListener('clearScanFilter', 'click', clearScanFilter);
  safeAddEventListener('exportScansHeader', 'click', exportScansToCSV);
  safeAddEventListener('exportScansSummaryBtn', 'click', exportScansSummaryReport);
  safeAddEventListener('apply-kpi-filter', 'click', loadKPI);

  // Map Legend Toggles
  ['employees', 'emp-info', 'posts', 'points', 'names'].forEach(key => {
    safeAddEventListener(`toggle-${key}`, 'change', (e) => {
      const stateKey = key === 'emp-info' ? 'empInfo' : key;
      mapVisibility[stateKey] = e.target.checked;
      const activePage = document.querySelector('.nav-item.active')?.dataset.page;
      if (activePage === 'realtime') {
        loadRealtimeMap();
      }
    });
  });

  // Excel import/export
  safeAddEventListener('exportEmployeesHeader', 'click', exportEmployeesToXLSX);
  safeAddEventListener('downloadTemplateHeader', 'click', downloadImportTemplate);
  safeAddEventListener('importEmployeesBtnHeader', 'click', () => {
    const fileInput = document.getElementById('importFile');
    if (fileInput) fileInput.click();
  });
  safeAddEventListener('importFile', 'change', importEmployeesFromXLSX);

  // Фильтрация сотрудников
  const empFilters = ['filter-emp-id', 'filter-emp-name', 'filter-emp-phone', 'filter-emp-role', 'filter-emp-status'];
  empFilters.forEach(id => {
    safeAddEventListener(id, 'input', () => {
      employeeCurrentPage = 1;
      applyEmployeeFilters();
    });
    safeAddEventListener(id, 'change', () => {
      employeeCurrentPage = 1;
      applyEmployeeFilters();
    });
  });

  safeAddEventListener('selectAllEmployees', 'change', (e) => toggleAllEmployees(e.target.checked));
  safeAddEventListener('bulk-deactivate', 'click', bulkDeactivateEmployees);

  safeAddEventListener('closeBulkQrModal', 'click', () => {
    document.getElementById('bulkQrModal').style.display = 'none';
  });

  safeAddEventListener('closeTerritoryModal', 'click', () => {
    document.getElementById('territoryModal').style.display = 'none';
    isTerritoryModalOpen = false;
  });

  safeAddEventListener('cancel-territory', 'click', () => {
    document.getElementById('territoryModal').style.display = 'none';
    isTerritoryModalOpen = false;
  });

  safeAddEventListener('save-territory-modal', 'click', saveTerritory);
  safeAddEventListener('territory-btn-header', 'click', showTerritoryModal);

  safeAddEventListener('selectAllBulkQr', 'change', (e) => {
    const checkboxes = document.querySelectorAll('.bulk-qr-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
    updateBulkQrSelectedCount();
  });

  safeAddEventListener('download-selected-qrs', 'click', downloadSelectedQrs);

  safeAddEventListener('delete-territory-btn-header', 'click', deleteTerritory);
  safeAddEventListener('delete-territory-btn', 'click', () => {
    deleteTerritory();
    document.getElementById('territoryModal').style.display = 'none';
  });

  safeAddEventListener('closeTimelineModal', 'click', () => {
    document.getElementById('scanTimelineModal').style.display = 'none';
  });

  // Toggle filter visibility
  document.querySelectorAll('.toggle-filter-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const tableType = this.getAttribute('data-table');
      if (tableType === 'employees') {
        const row = document.getElementById('employees-filter-row');
        row.classList.toggle('active');
        this.classList.toggle('btn-active');
      } else if (tableType === 'scans') {
        const filtersContainer = document.querySelector('#scans-page .filters');
        if (filtersContainer) {
          const isFlex = window.getComputedStyle(filtersContainer).display === 'flex';
          filtersContainer.style.display = isFlex ? 'none' : 'flex';
          this.classList.toggle('btn-active');
        }
      }
    });
  });
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
    recentScansLimit = 10;
    await fetchRecentScans();

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

  // Show/Hide "Load More" button
  const moreContainer = document.getElementById('recentScansMoreContainer');
  if (moreContainer) {
    if (scans.length >= recentScansLimit) {
      moreContainer.style.display = 'block';
    } else {
      moreContainer.style.display = 'none';
    }
  }
}

async function fetchRecentScans() {
  try {
    const scans = await apiRequest(`/scans?limit=${recentScansLimit}`);
    renderRecentScans(scans.scans);
  } catch (error) {
    console.error('Failed to fetch recent scans:', error);
  }
}

async function loadMoreRecentScans() {
  const btn = document.getElementById('loadMoreRecentScans');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
  }

  recentScansLimit += 10;
  await fetchRecentScans();

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Показать еще';
  }
}

// Realtime Map
async function loadRealtimeMap() {
  const refreshBtn = document.getElementById('refresh-map');
  const icon = refreshBtn?.querySelector('.btn-icon');
  const timeFilter = document.getElementById('map-time-filter')?.value;

  if (icon) icon.classList.add('fa-spin-custom'); // Добавим анимацию если нужно

  try {
    let activePatrolsUrl = '/gps/active';
    if (timeFilter) activePatrolsUrl += `?from=${timeFilter}`;

    const [checkpoints, activePatrols] = await Promise.all([
      apiRequest('/checkpoints'),
      apiRequest(activePatrolsUrl),
      loadTerritory() // Обновляем и территорию тоже
    ]);

    if (!realtimeMap) {
      initializeRealtimeMap();
    }

    renderRealtimeMap(checkpoints.checkpoints, activePatrols.active_patrols);
    renderActivePatrolsList(activePatrols.active_patrols);

    // Fix grey tiles issue
    if (realtimeMap && mapProvider === 'leaflet') {
      setTimeout(() => realtimeMap.invalidateSize(), 100);
    }

    showNotification('Данные карты обновлены', 'success');
  } catch (error) {
    console.error('Failed to load realtime map:', error);
    showNotification('Ошибка загрузки карты', 'error');
  } finally {
    if (icon) icon.classList.remove('fa-spin-custom');
  }
}

function initializeRealtimeMap() {
  // Проверяем доступность провайдеров карт
  if (typeof L !== 'undefined') {
    // Используем Leaflet (OpenStreetMap) - бесплатно, без API ключа
    mapProvider = 'leaflet';
    console.log('🗺️ Используется OpenStreetMap (Leaflet)');

    realtimeMap = L.map('realtime-map').setView([41.204358, 69.234420], 14);

    // Create a pane for territory to stay below markers but above tiles
    if (!realtimeMap.getPane('territoryPane')) {
      const pane = realtimeMap.createPane('territoryPane');
      pane.style.zIndex = 400; // Above tiles, below markers (usually 600+)
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(realtimeMap);

    // Правый клик для добавления точки
    realtimeMap.on('contextmenu', (e) => {
      const { lat, lng } = e.latlng;
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
      menu.style.left = e.originalEvent.pageX + 'px';
      menu.style.top = e.originalEvent.pageY + 'px';

      menu.innerHTML = `
        <button class="btn btn-success" style="width: 100%; white-space: nowrap; font-size: 0.875rem;" onclick="showCheckpointModal({ latitude: ${lat.toFixed(6)}, longitude: ${lng.toFixed(6)}, is_new_from_map: true }); document.getElementById('${menuId}').style.display = 'none';">
          ➕ Добавить QR точку
        </button>
      `;

      const closeMenu = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
      };
      setTimeout(() => document.addEventListener('click', closeMenu), 10);
    });

    // Клик по карте для добавления точки
    realtimeMap.on('click', (e) => {
      const { lat, lng } = e.latlng;
      if (isTerritoryEditMode) {
        addTerritoryPoint(lat, lng);
      } else {
        showCheckpointModal({ latitude: lat.toFixed(6), longitude: lng.toFixed(6), is_new_from_map: true });
      }
    });

    // Загружаем территорию
    loadTerritory();

    return;
  }

  // Fallback на Yandex Maps
  if (typeof ymaps === 'undefined') {
    console.error('❌ Ни один провайдер карт не доступен');
    showNotification('Карты недоступны. Проверьте подключение к интернету.', 'error');
    return;
  }

  mapProvider = 'yandex';
  console.log('🗺️ Используется Yandex Maps');
  ymaps.ready(() => {
    realtimeMap = new ymaps.Map('realtime-map', {
      center: [41.204358, 69.234420],
      zoom: 14,
      controls: ['zoomControl', 'fullscreenControl', 'typeSelector']
    });

    // Загружаем территорию для Яндекса (если нужно будет)
    loadTerritory();

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

  if (mapProvider === 'leaflet') {
    // Очищаем старые маркеры
    mapMarkers.forEach(marker => marker.remove());
    mapMarkers = [];

    // Добавляем контрольные точки
    checkpoints.forEach(cp => {
      // Filter by visibility settings
      if (cp.checkpoint_type === 'kpp' && !mapVisibility.posts) return;
      if (cp.checkpoint_type !== 'kpp' && !mapVisibility.points) return;

      const showName = mapVisibility.names;

      const icon = L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div style="display: flex; flex-direction: column; align-items: center; position: relative;">
            ${showName ? `
              <div style="margin-bottom: 4px; background: rgba(255,255,255,0.95); color: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; border: 1px solid #cbd5e1; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                ${cp.name}
              </div>
            ` : ''}
            <div style="width: 14px; height: 14px; background: ${cp.checkpoint_type === 'kpp' ? '#ef4444' : '#10b981'}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 0 2px ${cp.checkpoint_type === 'kpp' ? '#ef444440' : '#10b98140'};"></div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, showName ? 33 : 7] // Center of the dot
      });

      const marker = L.marker([cp.latitude, cp.longitude], { icon }).addTo(realtimeMap);

      marker.bindPopup(`
        <div style="min-width: 220px; padding: 5px; color: #1e293b;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <strong style="font-size: 1.1rem; flex: 1; margin-right: 10px;">${cp.name}</strong>
            <span style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-weight: bold; color: var(--primary); border: 1px solid var(--border);">
              ${cp.short_code || '----'}
            </span>
          </div>
          
          <div style="margin-bottom: 12px; color: #64748b; font-size: 0.85rem;">
            ${cp.checkpoint_type === 'kpp' ? '🔴 КПП' : '🟢 Патруль'}<br>
            ${cp.description || ''}
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 6px; margin-bottom: 12px;">
            <span style="font-size: 0.85rem; font-weight: 500;">Статус</span>
            <label class="switch" style="transform: scale(0.8);">
              <input type="checkbox" ${cp.is_active ? 'checked' : ''} onchange="toggleCheckpointStatus(${cp.id}, this.checked)">
              <span class="slider"></span>
            </label>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 44px; gap: 8px;">
            <button class="btn btn-primary" onclick="window.open('/print-qr.html?id=${cp.id}&token=${authToken}', '_blank')" style="font-size: 0.85rem; padding: 10px;">
              🖨️ Скачать QR код
            </button>
            <button class="btn btn-secondary" onclick="editCheckpoint(${cp.id})" title="Изменить" style="padding: 10px; display: flex; align-items: center; justify-content: center;">
              ✏️
            </button>
          </div>
        </div>
      `);

      mapMarkers.push(marker);

      // Добавляем радиус если точка активна
      if (cp.is_active) {
        const circle = L.circle([cp.latitude, cp.longitude], {
          radius: cp.radius_meters,
          color: cp.checkpoint_type === 'kpp' ? '#ef4444' : '#10b981',
          fillColor: cp.checkpoint_type === 'kpp' ? '#ef4444' : '#10b981',
          fillOpacity: 0.1,
          weight: 2
        }).addTo(realtimeMap);

        mapMarkers.push(circle);
      }
    });

    // Добавляем активных патрулей
    if (mapVisibility.employees) {
      patrols.forEach(patrol => {
        if (patrol.latitude && patrol.longitude) {
          const nameParts = patrol.full_name ? patrol.full_name.split(' ') : [];
          const displayName = nameParts.length >= 2 ? `${nameParts[0]} ${nameParts[1]}` : patrol.full_name;

          const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `
            <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
              <div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">👮</div>
              ${mapVisibility.empInfo ? `
                <div style="background: rgba(15, 23, 42, 0.95); color: white; padding: 4px 10px; border-radius: 8px; font-size: 10px; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; box-shadow: 0 4px 15px rgba(0,0,0,0.5); text-align: center; min-width: 100px;">
                  <div style="font-weight: 800; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.2); margin-bottom: 4px; padding-bottom: 2px;">${displayName}</div>
                  <div style="opacity: 0.9; font-weight: 600; color: #10b981; font-size: 9px;">● Онлайн</div>
                  <div style="opacity: 0.7; font-size: 9px; margin-top: 2px;">Обновлено: ${new Date(patrol.recorded_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              ` : ''}
            </div>
          `,
            iconSize: [120, 80],
            iconAnchor: [60, 40]
          });

          const marker = L.marker([patrol.latitude, patrol.longitude], { icon }).addTo(realtimeMap);

          marker.bindPopup(`
          <strong>${patrol.full_name}</strong><br>
          <small>Последнее обновление: ${formatDateTime(patrol.recorded_at)}</small><br>
          <small>Точность: ${Math.round(patrol.accuracy)}м</small>
        `);

          mapMarkers.push(marker);
        }
      });

      return;
    }
  }

  // Yandex Maps рендеринг
  realtimeMap.geoObjects.removeAll();

  // Add checkpoints
  checkpoints.forEach(cp => {
    // Filter by visibility settings
    if (cp.checkpoint_type === 'kpp' && !mapVisibility.posts) return;
    if (cp.checkpoint_type !== 'kpp' && !mapVisibility.points) return;

    const marker = new ymaps.Placemark([cp.latitude, cp.longitude], {
      iconCaption: mapVisibility.names ? cp.name : '',
      balloonContent: `
        <div style="min-width: 220px; padding: 5px; color: #1e293b;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <strong style="font-size: 1.1rem; flex: 1; margin-right: 10px;">${cp.name}</strong>
              <span style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-weight: bold; color: #2563eb; border: 1px solid rgba(0,0,0,0.1);">
                ${cp.short_code || '----'}
              </span>
            </div>
            
            <div style="margin-bottom: 12px; color: #64748b; font-size: 0.85rem;">
                ${cp.checkpoint_type === 'kpp' ? '🔴 КПП' : '🟢 Патруль'}<br>
                ${cp.description || ''}
            </div>
            
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 6px; margin-bottom: 12px;">
                <span style="font-size: 0.85rem; font-weight: 500;">Статус</span>
                <label class="switch" style="transform: scale(0.8);">
                    <input type="checkbox" ${cp.is_active ? 'checked' : ''} onchange="toggleCheckpointStatus(${cp.id}, this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 44px; gap: 8px;">
                <button class="btn btn-primary" onclick="window.open('/print-qr.html?id=${cp.id}&token=${authToken}', '_blank')" style="font-size: 0.85rem; padding: 10px;">
                    🖨️ Скачать QR код
                </button>
                <button class="btn btn-secondary" onclick="editCheckpoint(${cp.id})" title="Изменить" style="padding: 10px; display: flex; align-items: center; justify-content: center;">
                    ✏️
                </button>
            </div>
        </div>
      `
    }, {
      preset: cp.checkpoint_type === 'kpp' ? 'islands#redDotIconWithCaption' : 'islands#greenDotIconWithCaption',
      iconCaptionMaxWidth: 120
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
  if (mapVisibility.employees) {
    patrols.forEach(patrol => {
      if (patrol.latitude && patrol.longitude) {
        const nameParts = patrol.full_name ? patrol.full_name.split(' ') : [];
        const displayName = nameParts.length >= 2 ? `${nameParts[0]} ${nameParts[1]}` : patrol.full_name;

        const marker = new ymaps.Placemark([patrol.latitude, patrol.longitude], {
          hintContent: patrol.full_name,
          balloonContent: `
          <strong>${patrol.full_name}</strong><br>
          <small>Последнее обновление: ${formatDateTime(patrol.recorded_at)}</small><br>
          <small>Точность: ${Math.round(patrol.accuracy)}м</small>
        `
        }, {
          iconLayout: 'default#imageWithContent',
          iconImageHref: '',
          iconImageSize: [52, 52],
          iconImageOffset: [-26, -45],
          iconContentLayout: ymaps.templateLayoutFactory.createClass(
            `<div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">👮</div>
            ${mapVisibility.empInfo ? `
              <div style="background: rgba(15, 23, 42, 0.95); color: white; padding: 4px 10px; border-radius: 8px; font-size: 10px; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; box-shadow: 0 4px 15px rgba(0,0,0,0.5); text-align: center; min-width: 100px;">
                  <div style="font-weight: 800; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.2); margin-bottom: 4px; padding-bottom: 2px;">${displayName}</div>
                  <div style="opacity: 0.9; font-weight: 600; color: #10b981; font-size: 9px;">● Онлайн</div>
                  <div style="opacity: 0.7; font-size: 9px; margin-top: 2px;">${new Date(patrol.recorded_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ` : ''}
           </div>`
          )
        });

        realtimeMap.geoObjects.add(marker);
      }
    });
  }
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

  // Группировка по userId
  const summary = scans.reduce((acc, scan) => {
    // console.log('DEBUG: scan object:', scan);
    const uid = scan.user_id || scan.userId; // Try both casings just in case
    if (!uid) return acc;

    if (!acc[uid]) {
      acc[uid] = {
        userId: uid,
        name: scan.user_name || `ID: ${uid}`,
        count: 0,
        lastSeen: scan.scan_time,
        checkpoints: new Set()
      };
    }
    acc[uid].count++;
    acc[uid].checkpoints.add(scan.checkpoint_name);
    if (new Date(scan.scan_time) > new Date(acc[uid].lastSeen)) {
      acc[uid].lastSeen = scan.scan_time;
    }
    return acc;
  }, {});

  tbody.innerHTML = Object.values(summary).sort((a, b) => b.count - a.count).map(stats => `
    <tr>
      <td style="font-weight: 600;">${stats.name}</td>
      <td>
        <span class="badge badge-primary" 
              style="font-size: 1rem; padding: 0.5rem 1rem; cursor: pointer;"
              onclick="showScanTimelineModal(${stats.userId}, ${JSON.stringify(stats.name).replace(/"/g, '&quot;')})"
              title="Посмотреть маршрут">
          ${stats.count}
        </span>
      </td>
      <td>${formatDateTime(stats.lastSeen)}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">
        ${Array.from(stats.checkpoints).slice(0, 3).join(', ')}${stats.checkpoints.size > 3 ? '...' : ''}
      </td>
    </tr>
  `).join('');
}

let timelineMap = null;
let timelineLayers = [];

async function showScanTimelineModal(userId, userName) {
  const modal = document.getElementById('scanTimelineModal');
  document.getElementById('timelineModalTitle').textContent = `Маршрут: ${userName}`;
  modal.style.display = 'block';

  // Get date filters from the scans page if they exist
  const fromDate = document.getElementById('scanFilterFrom')?.value;
  const toDate = document.getElementById('scanFilterTo')?.value;

  let url = `/scans?user_id=${userId}`;
  if (fromDate) url += `&from_date=${fromDate}T00:00:00`;
  if (toDate) url += `&to_date=${toDate}T23:59:59`;

  try {
    const data = await apiRequest(url);
    const scans = data.scans.sort((a, b) => new Date(a.scan_time) - new Date(b.scan_time));

    renderTimeline(scans);

    setTimeout(() => {
      initTimelineMap(scans);
    }, 300);
  } catch (error) {
    console.error('Failed to load timeline:', error);
    showNotification('Ошибка загрузки маршрута', 'error');
  }
}

function renderTimeline(scans) {
  const container = document.getElementById('scanTimeline');
  if (scans.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted);">Нет данных для отображения</div>';
    return;
  }

  let html = '';
  scans.forEach((scan, index) => {
    // Add duration label if not the first item
    if (index > 0) {
      const prevTime = new Date(scans[index - 1].scan_time);
      const currTime = new Date(scan.scan_time);
      const diffMs = currTime - prevTime;
      const diffMin = Math.round(diffMs / 60000);

      html += `<div class="timeline-duration" title="Промежуток времени">${diffMin} мин</div>`;
    }

    html += `
      <div class="timeline-item">
        <div class="timeline-number">${index + 1}</div>
        <div class="timeline-checkpoint" title="${scan.checkpoint_name}">${scan.checkpoint_name}</div>
        <div class="timeline-dot"></div>
        <div class="timeline-time">${new Date(scan.scan_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function initTimelineMap(scans) {
  if (timelineMap) {
    timelineMap.remove();
    timelineMap = null;
  }

  timelineMap = L.map('timeline-map').setView([41.204358, 69.234420], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(timelineMap);

  // Fix grey tiles issue in modal
  setTimeout(() => {
    if (timelineMap) timelineMap.invalidateSize();
  }, 400);

  const points = [];
  const markers = [];

  scans.forEach((scan, index) => {
    if (scan.latitude && scan.longitude) {
      const latlng = [scan.latitude, scan.longitude];
      points.push(latlng);

      const markerIcon = L.divIcon({
        className: 'custom-route-marker',
        html: `
            <div style="position: relative;">
              <div style="font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">📍</div>
              <div class="route-number" style="position: absolute; top: -5px; right: -5px; background: white; border: 2px solid var(--primary); color: var(--primary); border-radius: 50%; width: 18px; height: 18px; font-weight: bold; font-size: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                ${index + 1}
              </div>
            </div>
          `,
        iconSize: [30, 30],
        iconAnchor: [15, 25]
      });

      const marker = L.marker(latlng, { icon: markerIcon }).addTo(timelineMap);

      marker.bindPopup(`
        <strong>#${index + 1} - ${scan.checkpoint_name}</strong><br>
        Время: ${new Date(scan.scan_time).toLocaleTimeString('ru-RU')}<br>
        Дистанция: ${Math.round(scan.distance_meters)}м
      `);

      markers.push(marker);
    }
  });

  if (points.length >= 2) {
    L.polyline(points, {
      color: 'var(--primary)',
      weight: 4,
      opacity: 0.7,
      dashArray: '10, 10',
      smoothFactor: 1
    }).addTo(timelineMap);
  }

  if (points.length > 0) {
    const group = new L.featureGroup(markers);
    timelineMap.fitBounds(group.getBounds().pad(0.1));
  }
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

async function exportScansSummaryReport() {
  try {
    showNotification('Подготовка отчёта...', 'info');

    const fromDateInput = document.getElementById('scanFilterFrom').value;
    const toDateInput = document.getElementById('scanFilterTo').value;

    // Если даты не выбраны, используем сегодня
    const today = new Date().toISOString().split('T')[0];
    const fromDate = fromDateInput || today;
    const toDate = toDateInput || today;

    // Загружаем сканирования за период
    let endpoint = `/scans?limit=10000&from_date=${fromDate}T00:00:00&to_date=${toDate}T23:59:59`;
    const scansData = await apiRequest(endpoint);
    const scans = scansData.scans;

    if (scans.length === 0) {
      showNotification('Нет данных за выбранный период', 'warning');
      return;
    }

    // Загружаем список всех сотрудников для ролей
    const empData = await apiRequest('/employees');
    const employees = empData.employees || [];
    const empMap = employees.reduce((acc, emp) => {
      acc[emp.id] = emp;
      return acc;
    }, {});

    // Группируем сканирования по пользователю
    const stats = scans.reduce((acc, scan) => {
      const uid = scan.user_id;
      if (!acc[uid]) {
        const emp = empMap[uid] || {};
        acc[uid] = {
          name: scan.user_name || emp.full_name || `ID: ${uid}`,
          role: emp.role ? getRoleLabel(emp.role) : '-',
          count: 0
        };
      }
      acc[uid].count++;
      return acc;
    }, {});

    // Заголовки: №, Дата начало, Дата окончания, ФИО, Должность, Отсканировано (суммарное кол-во)
    const headers = ['№', 'Дата начала', 'Дата окончания', 'ФИО', 'Должность', 'Отсканировано (суммарно)'];

    // Сортируем по количеству (по убыванию)
    const sortedStats = Object.values(stats).sort((a, b) => b.count - a.count);

    const displayFrom = formatDate(fromDate);
    const displayTo = formatDate(toDate);

    const rows = sortedStats.map((item, index) => ({
      '№': index + 1,
      'Дата начала': displayFrom,
      'Дата окончания': displayTo,
      'ФИО': item.name,
      'Должность': item.role,
      'Отсканировано (суммарно)': item.count
    }));

    // Создание книги Excel с помощью SheetJS
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Отчёт по считываниям');

    // Настройка ширины колонок
    worksheet['!cols'] = [
      { wch: 5 },  // №
      { wch: 15 }, // Дата начала
      { wch: 15 }, // Дата окончания
      { wch: 35 }, // ФИО
      { wch: 20 }, // Должность
      { wch: 25 }  // Отсканировано
    ];

    // Скачивание файла
    XLSX.writeFile(workbook, `report_summary_${fromDate}_to_${toDate}.xlsx`);

    showNotification('Отчёт сформирован и скачан (XLSX)', 'success');
  } catch (error) {
    console.error('Report failed:', error);
    showNotification('Ошибка формирования отчёта', 'error');
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
  if (!checkpoints || checkpoints.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);"><div style="font-size: 3rem; margin-bottom: 1rem;">📍</div><div>Нет контрольных точек</div></div>';
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

        const mContainer = document.getElementById('modal-map');
        if (!mContainer) return;

        // Используем Leaflet если доступен
        if (typeof L !== 'undefined') {
          const modalMap = L.map('modal-map').setView([initialLat, initialLng], 15);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
          }).addTo(modalMap);

          // Создаем кастомную иконку (синяя точка), которой не нужны картинки
          const blueDotIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="width: 20px; height: 20px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });

          // Create draggable marker
          const modalMarker = L.marker([initialLat, initialLng], {
            draggable: true,
            icon: blueDotIcon
          }).addTo(modalMap);

          modalMarker.bindPopup('Выбранная точка').openPopup();

          // Update inputs when marker is dragged
          modalMarker.on('dragend', () => {
            const { lat, lng } = modalMarker.getLatLng();
            document.getElementById('modal-lat').value = lat.toFixed(6);
            document.getElementById('modal-lng').value = lng.toFixed(6);
          });

          // Click on map to move marker
          modalMap.on('click', (e) => {
            const { lat, lng } = e.latlng;
            modalMarker.setLatLng([lat, lng]);
            document.getElementById('modal-lat').value = lat.toFixed(6);
            document.getElementById('modal-lng').value = lng.toFixed(6);
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
                modalMarker.setLatLng([lat, lng]);
                modalMap.setCenter([lat, lng]);
              }
            });
          });

        } else if (typeof ymaps !== 'undefined') {
          // Fallback на Yandex Maps
          ymaps.ready(() => {
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
        } else {
          mContainer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">Карта недоступна. Введите координаты вручную.</div>';
        }
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
    allEmployees = data.employees || [];
    applyEmployeeFilters(); // Сначала применяем текущие фильтры
  } catch (error) {
    console.error('Failed to load employees:', error);
    showNotification('Ошибка загрузки сотрудников', 'error');
  }
}

function applyEmployeeFilters() {
  const fId = document.getElementById('filter-emp-id')?.value.toLowerCase().trim() || '';
  const fName = document.getElementById('filter-emp-name')?.value.toLowerCase().trim() || '';
  const fPhone = document.getElementById('filter-emp-phone')?.value.toLowerCase().trim() || '';
  const fRole = document.getElementById('filter-emp-role')?.value || '';
  const fStatus = document.getElementById('filter-emp-status')?.value || '';

  const filtered = allEmployees.filter(emp => {
    const matchesId = emp.id.toString().includes(fId);
    const matchesName = emp.full_name.toLowerCase().includes(fName);
    const matchesPhone = (emp.phone || '').toString().includes(fPhone);
    const matchesRole = !fRole || emp.role === fRole;

    let matchesStatus = true;
    if (fStatus === 'active') matchesStatus = emp.is_active === true;
    if (fStatus === 'blocked') matchesStatus = emp.is_active === false;

    return matchesId && matchesName && matchesPhone && matchesRole && matchesStatus;
  });

  const totalFiltered = filtered.length;
  const start = (employeeCurrentPage - 1) * employeeItemsPerPage;
  const paginated = filtered.slice(start, start + employeeItemsPerPage);

  renderEmployeesTable(paginated);
  renderEmployeePagination(totalFiltered);
}

function renderEmployeesTable(employees) {
  const tbody = document.getElementById('employeesTableBody');

  if (employees.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">👥</div>
          <div>Нет сотрудников</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = employees.map(emp => {
    const isSelected = selectedEmployeeIds.includes(emp.id);
    const isAdmin = emp.role === 'admin';

    return `
      <tr>
        <td><input type="checkbox" class="emp-checkbox" value="${emp.id}" ${isSelected ? 'checked' : ''} onchange="toggleEmployeeSelection(${emp.id}, this.checked)"></td>
        <td>${emp.id}</td>
        <td>${emp.full_name}</td>
        <td>${emp.phone || '-'}</td>
        <td>
          <span class="badge ${emp.role === 'admin' ? 'badge-danger' : 'badge-success'}">
            ${getRoleLabel(emp.role)}
          </span>
        </td>
        <td>
          ${isAdmin ? `
            <span class="badge badge-success" title="Администратор всегда активен">АКТИВЕН</span>
          ` : `
            <label class="switch">
              <input type="checkbox" ${emp.is_active ? 'checked' : ''} onchange="toggleEmployeeStatus(${emp.id}, this.checked)">
              <span class="slider"></span>
            </label>
          `}
        </td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${formatDateTime(emp.created_at)}</td>
        <td>
          <button class="btn btn-secondary btn-icon" onclick="editEmployee(${emp.id})" title="Редактировать">✏️</button>
          ${emp.id !== currentUser.id ? `<button class="btn btn-danger btn-icon" onclick="deleteEmployee(${emp.id})" title="Удалить">🗑️</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  updateBulkActionsBar();
}

function renderEmployeePagination(totalItems) {
  const totalPages = Math.ceil(totalItems / employeeItemsPerPage);
  const container = document.getElementById('employeesPagination');

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <button class="pagination-btn" ${employeeCurrentPage === 1 ? 'disabled' : ''} onclick="changeEmployeePage(${employeeCurrentPage - 1})">← Назад</button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= employeeCurrentPage - 1 && i <= employeeCurrentPage + 1)) {
      html += `<button class="pagination-btn ${i === employeeCurrentPage ? 'active' : ''}" onclick="changeEmployeePage(${i})">${i}</button>`;
    } else if (i === employeeCurrentPage - 2 || i === employeeCurrentPage + 2) {
      html += `<span style="color: var(--text-muted)">...</span>`;
    }
  }

  html += `
    <button class="pagination-btn" ${employeeCurrentPage === totalPages ? 'disabled' : ''} onclick="changeEmployeePage(${employeeCurrentPage + 1})">Вперед →</button>
  `;

  container.innerHTML = html;
}

// Bulk QR Printing
async function showBulkQrModal() {
  const modal = document.getElementById('bulkQrModal');
  const tbody = document.getElementById('bulkQrTableBody');
  modal.style.display = 'block';
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">Загрузка...</td></tr>';

  try {
    const data = await apiRequest('/checkpoints');
    const checkpoints = data.checkpoints || [];

    if (checkpoints.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">Нет точек для печати</td></tr>';
      return;
    }

    tbody.innerHTML = checkpoints.map(cp => `
      <tr class="bulk-qr-row">
        <td><input type="checkbox" class="bulk-qr-checkbox" value="${cp.id}" checked onchange="updateBulkQrSelectedCount()"></td>
        <td>
          <div id="mini-map-${cp.id}" class="mini-map-container"></div>
        </td>
        <td><strong>${cp.name}</strong></td>
        <td><span class="badge ${cp.checkpoint_type === 'kpp' ? 'badge-info' : 'badge-success'}">${cp.checkpoint_type === 'kpp' ? 'КПП' : 'Патруль'}</span></td>
      </tr>
    `).join('');

    // Инициализируем мини-карты
    checkpoints.forEach(cp => {
      setTimeout(() => {
        const containerId = `mini-map-${cp.id}`;
        if (!document.getElementById(containerId)) return;

        const miniMap = L.map(containerId, {
          zoomControl: false,
          dragging: false,
          touchZoom: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          attributionControl: false
        }).setView([cp.latitude, cp.longitude], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);
        L.marker([cp.latitude, cp.longitude]).addTo(miniMap);
      }, 100);
    });

    updateBulkQrSelectedCount();
  } catch (error) {
    console.error(error);
    showNotification('Ошибка загрузки точек', 'error');
  }
}

function updateBulkQrSelectedCount() {
  const selected = document.querySelectorAll('.bulk-qr-checkbox:checked');
  document.getElementById('bulk-qr-selected-count').textContent = `Выбрано: ${selected.length}`;
}

function downloadSelectedQrs() {
  const selected = Array.from(document.querySelectorAll('.bulk-qr-checkbox:checked')).map(cb => cb.value);
  if (selected.length === 0) {
    showNotification('Выберите хотя бы одну точку', 'warning');
    return;
  }

  const token = localStorage.getItem('authToken');
  const ids = selected.join(',');
  window.open(`/print-bulk-qr.html?ids=${ids}&token=${token}`, '_blank');
}

function changeEmployeePage(page) {
  employeeCurrentPage = page;
  const fId = document.getElementById('filter-emp-id')?.value.toLowerCase().trim() || '';
  const fName = document.getElementById('filter-emp-name')?.value.toLowerCase().trim() || '';
  const fPhone = document.getElementById('filter-emp-phone')?.value.toLowerCase().trim() || '';
  const fRole = document.getElementById('filter-emp-role')?.value || '';
  const fStatus = document.getElementById('filter-emp-status')?.value || '';

  const filtered = allEmployees.filter(emp => {
    const matchesId = emp.id.toString().includes(fId);
    const matchesName = emp.full_name.toLowerCase().includes(fName);
    const matchesPhone = (emp.phone || '').toString().includes(fPhone);
    const matchesRole = !fRole || emp.role === fRole;

    let matchesStatus = true;
    if (fStatus === 'active') matchesStatus = emp.is_active === true;
    if (fStatus === 'blocked') matchesStatus = emp.is_active === false;

    return matchesId && matchesName && matchesPhone && matchesRole && matchesStatus;
  });

  const start = (employeeCurrentPage - 1) * employeeItemsPerPage;
  const paginated = filtered.slice(start, start + employeeItemsPerPage);

  renderEmployeesTable(paginated);
  renderEmployeePagination(filtered.length);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


function toggleEmployeeSelection(id, isSelected) {
  if (isSelected) {
    if (!selectedEmployeeIds.includes(id)) selectedEmployeeIds.push(id);
  } else {
    selectedEmployeeIds = selectedEmployeeIds.filter(empId => empId !== id);
  }
  updateBulkActionsBar();
}

function toggleAllEmployees(isSelected) {
  const checkboxes = document.querySelectorAll('.emp-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = isSelected;
    const id = parseInt(cb.value);
    if (isSelected) {
      if (!selectedEmployeeIds.includes(id)) selectedEmployeeIds.push(id);
    } else {
      selectedEmployeeIds = selectedEmployeeIds.filter(empId => empId !== id);
    }
  });
  updateBulkActionsBar();
}

function updateBulkActionsBar() {
  const bar = document.getElementById('bulk-actions-bar');
  const countSpan = document.getElementById('selected-count');
  const selectAllCb = document.getElementById('selectAllEmployees');

  if (selectedEmployeeIds.length > 0) {
    bar.style.display = 'flex';
    countSpan.textContent = `Выбрано: ${selectedEmployeeIds.length}`;
  } else {
    bar.style.display = 'none';
  }

  // Обновляем состояние "Выбрать все"
  const currentCheckboxes = document.querySelectorAll('.emp-checkbox');
  if (currentCheckboxes.length > 0) {
    const allChecked = Array.from(currentCheckboxes).every(cb => cb.checked);
    selectAllCb.checked = allChecked;
  } else {
    selectAllCb.checked = false;
  }
}

async function bulkDeactivateEmployees() {
  if (selectedEmployeeIds.length === 0) return;

  const count = selectedEmployeeIds.length;
  if (!confirm(`Вы уверены, что хотите деактивировать ${count} сотрудников?`)) return;

  try {
    showNotification(`Деактивация ${count} сотрудников...`, 'info');

    // Отфильтруем админов на всякий случай, если они попали в выборку (хотя мы скрыли им чекбоксы... а нет, не скрыли, но статус запретили менять)
    // Лучше просто отправить запросы. Сервер может защищать, но мы сделаем последовательно или через Promise.all
    // В текущем API нет bulk эндпоинта, поэтому делаем циклом.

    let successCount = 0;
    for (const id of selectedEmployeeIds) {
      // Пропускаем текущего пользователя и админов (дополнительная защита)
      const emp = allEmployees.find(e => e.id === id);
      if (emp && emp.role === 'admin') continue;

      try {
        await apiRequest(`/employees/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: false })
        });
        successCount++;
      } catch (e) {
        console.error(`Failed to deactivate ${id}`, e);
      }
    }

    showNotification(`Успешно деактивировано: ${successCount}`, 'success');
    selectedEmployeeIds = [];
    loadEmployees(); // Перезагружаем список
  } catch (error) {
    showNotification('Ошибка при массовой деактивации', 'error');
  }
}

async function toggleEmployeeStatus(id, isActive) {
  try {
    await apiRequest(`/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: isActive })
    });
    showNotification(isActive ? 'Сотрудник разблокирован' : 'Сотрудник заблокирован', 'success');
  } catch (error) {
    console.error('Failed to toggle employee status:', error);
    showNotification('Ошибка изменения статуса', 'error');
    loadEmployees(); // Reload to reset the toggle UI
  }
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

function setScanDatePreset(preset) {
  const fromInput = document.getElementById('scanFilterFrom');
  const toInput = document.getElementById('scanFilterTo');

  const today = new Date();
  let fromDate = new Date();
  let toDate = new Date();

  if (preset === 'today') {
    // Already set to today
  } else if (preset === 'yesterday') {
    fromDate.setDate(today.getDate() - 1);
    toDate.setDate(today.getDate() - 1);
  } else if (preset === 'beforeYesterday') {
    fromDate.setDate(today.getDate() - 2);
    toDate.setDate(today.getDate() - 2);
  }

  const offset = fromDate.getTimezoneOffset();
  fromDate = new Date(fromDate.getTime() - (offset * 60 * 1000));
  toDate = new Date(toDate.getTime() - (offset * 60 * 1000));

  fromInput.value = fromDate.toISOString().split('T')[0];
  toInput.value = toDate.toISOString().split('T')[0];

  loadScans();
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

// УПРАВЛЕНИЕ ТЕРРИТОРИЕЙ (Geofencing)

async function loadTerritory(shouldFitBounds = false) {
  try {
    // Prevent background update from overwriting unsaved changes in modal
    if (isTerritoryModalOpen) {
      console.log('⏳ Skipping territory background update while modal is open');
      return;
    }

    const data = await apiRequest('/gps/territory');
    console.log('📡 Territory loaded:', data.polygon?.length, 'points');
    territoryPolygon = data.polygon || [];
    renderTerritory();

    if (shouldFitBounds && territoryPolygon.length >= 3 && realtimeMap) {
      const bounds = L.latLngBounds(territoryPolygon);
      realtimeMap.fitBounds(bounds, { padding: [50, 50] });
    }
  } catch (error) {
    console.error('Ошибка загрузки территории:', error);
  }
}

function renderTerritory() {
  if (!realtimeMap) return;

  // Очищаем старый слой
  if (territoryLayer) {
    if (mapProvider === 'leaflet') {
      realtimeMap.removeLayer(territoryLayer);
    } else if (mapProvider === 'yandex') {
      realtimeMap.geoObjects.remove(territoryLayer);
    }
    territoryLayer = null;
  }

  if (!territoryPolygon || territoryPolygon.length < 3) {
    console.log('ℹ️ Territory polygon empty or invalid');
    return;
  }

  console.log('🎨 Rendering territory polygon on map');

  if (mapProvider === 'leaflet') {
    territoryLayer = L.polygon(territoryPolygon, {
      pane: 'territoryPane',
      color: '#ef4444',
      fillColor: '#ef4444',
      fillOpacity: 0.25,
      weight: 4,
      dashArray: '10, 10',
      interactive: false
    }).addTo(realtimeMap);
  } else if (mapProvider === 'yandex') {
    territoryLayer = new ymaps.Polygon([territoryPolygon], {}, {
      fillColor: '#ef444440',
      strokeColor: '#ef4444',
      strokeWidth: 4,
      strokeStyle: 'dash'
    });
    realtimeMap.geoObjects.add(territoryLayer);
  }
}

let territoryModalMap = null;
let territoryModalMarkers = [];
let territoryModalLayer = null;

async function showTerritoryModal() {
  const modal = document.getElementById('territoryModal');
  modal.style.display = 'block';
  isTerritoryModalOpen = true;

  setTimeout(async () => {
    if (!territoryModalMap) {
      territoryModalMap = L.map('territory-modal-map').setView([41.204358, 69.234420], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(territoryModalMap);

      territoryModalMap.on('click', (e) => {
        addTerritoryModalPoint(e.latlng.lat, e.latlng.lng);
      });
    } else {
      territoryModalMap.invalidateSize();
    }

    // Load current polygon
    try {
      const data = await apiRequest('/gps/territory');
      territoryPolygon = data.polygon || [];

      // Cleanup previous modal state
      territoryModalMarkers.forEach(m => m.remove());
      territoryModalMarkers = [];
      if (territoryModalLayer) territoryModalMap.removeLayer(territoryModalLayer);
      territoryModalLayer = null;

      // Render existing
      if (territoryPolygon.length > 0) {
        const points = [...territoryPolygon];
        territoryPolygon = []; // Will be reconstructed
        points.forEach(p => addTerritoryModalPoint(p[0], p[1]));

        // Zoom to polygon
        const bounds = L.latLngBounds(points);
        territoryModalMap.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch (err) {
      console.error(err);
    }
  }, 200);
}

function addTerritoryModalPoint(lat, lng) {
  const index = territoryPolygon.length;
  territoryPolygon.push([lat, lng]);

  const marker = L.circleMarker([lat, lng], {
    radius: 8,
    color: '#ffffff',
    weight: 2,
    fillColor: '#ef4444',
    fillOpacity: 1,
    interactive: true,
    draggable: true // Enable dragging for fine-tuning
  }).addTo(territoryModalMap);

  // Leaflet.circleMarker doesn't natively support dragging like L.marker, 
  // so we'll use L.marker if we want draggability easily, or implement it.
  // Using standard marker with custom icon for better UX.

  marker.remove(); // Remove circleMarker, use real marker

  const icon = L.divIcon({
    className: 'territory-drag-marker',
    html: `<div style="width: 12px; height: 12px; background: #ef4444; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });

  const dragMarker = L.marker([lat, lng], {
    icon: icon,
    draggable: true
  }).addTo(territoryModalMap);

  dragMarker.on('drag', (e) => {
    const newLatLng = e.target.getLatLng();
    // Update coordinates in the array
    const mIndex = territoryModalMarkers.indexOf(dragMarker);
    if (mIndex > -1) {
      territoryPolygon[mIndex] = [newLatLng.lat, newLatLng.lng];
      updateModalTerritoryVisual();
    }
  });

  dragMarker.on('contextmenu', (e) => {
    L.DomEvent.stopPropagation(e);
    const mIndex = territoryModalMarkers.indexOf(dragMarker);
    if (mIndex > -1) {
      removeTerritoryModalPoint(mIndex, dragMarker);
    }
  });

  territoryModalMarkers.push(dragMarker);
  updateModalTerritoryVisual();
}

function removeTerritoryModalPoint(index, marker) {
  if (index > -1) {
    territoryPolygon.splice(index, 1);
    marker.remove();
    territoryModalMarkers.splice(index, 1);
    updateModalTerritoryVisual();
  }
}

function updateModalTerritoryVisual() {
  if (territoryModalLayer) territoryModalMap.removeLayer(territoryModalLayer);

  if (territoryPolygon.length >= 3) {
    territoryModalLayer = L.polygon(territoryPolygon, {
      color: '#ef4444',
      weight: 3,
      fillOpacity: 0.3,
      dashArray: '5, 10'
    }).addTo(territoryModalMap);
  }
}

async function saveTerritory() {
  if (territoryPolygon.length > 0 && territoryPolygon.length < 3) {
    showNotification('Для зоны нужно минимум 3 точки', 'warning');
    return;
  }

  try {
    await apiRequest('/gps/territory', {
      method: 'POST',
      body: JSON.stringify({ polygon: territoryPolygon })
    });
    showNotification('Границы сохранены', 'success');
    document.getElementById('territoryModal').style.display = 'none';
    isTerritoryModalOpen = false;

    // Refresh main map
    renderTerritory();
  } catch (error) {
    showNotification('Ошибка сохранения', 'error');
  }
}

function toggleTerritoryEditMode() {
  // This is now handled by modal, but we can keep it as legacy or redirect
  showTerritoryModal();
}

async function deleteTerritory() {
  if (!confirm('Вы уверены, что хотите полностью удалить границы территории?')) return;

  try {
    await apiRequest('/gps/territory', {
      method: 'POST',
      body: JSON.stringify({ polygon: [] })
    });

    territoryPolygon = [];

    // Cleanup modal markers if any
    if (territoryModalMarkers) {
      territoryModalMarkers.forEach(m => m.remove());
      territoryModalMarkers = [];
    }
    if (territoryModalLayer && territoryModalMap) {
      territoryModalMap.removeLayer(territoryModalLayer);
      territoryModalLayer = null;
    }

    renderTerritory();
    showNotification('Территория удалена', 'success');
  } catch (error) {
    console.error('Ошибка удаления территории:', error);
    showNotification('Не удалось удалить территорию', 'error');
  }
}

// KPI Logic
function initializeKPIFilters() {
  const yearSelect = document.getElementById('kpi-filter-year');
  const monthSelect = document.getElementById('kpi-filter-month');

  if (!yearSelect) return;

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  // Populate years from 2024 to current
  for (let y = 2024; y <= currentYear; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }

  // Set current month
  monthSelect.value = currentMonth;
}

async function loadKPI() {
  const yearSelect = document.getElementById('kpi-filter-year');
  const monthSelect = document.getElementById('kpi-filter-month');

  if (!yearSelect || !monthSelect) return;

  const year = yearSelect.value;
  const month = parseInt(monthSelect.value);

  // Create date range for the selected month in local timezone
  const fromDate = new Date(year, month, 1);
  const toDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // Format dates for API (ISO strings)
  const fromStr = fromDate.toISOString();
  const toStr = toDate.toISOString();

  try {
    showNotification('Загрузка данных KPI...', 'info');

    // We fetch ALL scans for the month. 
    // Optimization note: This might need a specialized backend endpoint for scale.
    const scansData = await apiRequest(`/scans?from_date=${fromStr}&to_date=${toStr}&limit=5000`);

    // Group scans by user
    const stats = {};
    scansData.scans.forEach(scan => {
      if (!stats[scan.user_id]) {
        stats[scan.user_id] = {
          name: scan.user_name || `ID: ${scan.user_id}`,
          totalScans: 0,
          uniquePoints: new Set(),
          validScans: 0
        };
      }
      stats[scan.user_id].totalScans++;
      stats[scan.user_id].uniquePoints.add(scan.checkpoint_id);
      if (scan.is_valid) stats[scan.user_id].validScans++;
    });

    // Convert to array and sort by totalScans desc
    const leaderboard = Object.values(stats).sort((a, b) => b.totalScans - a.totalScans);

    renderKPI(leaderboard, fromDate, toDate);
  } catch (error) {
    console.error('Failed to load KPI:', error);
    showNotification('Ошибка загрузки данных KPI', 'error');
  }
}

function renderKPI(data, fromDate, toDate) {
  const tbody = document.getElementById('kpiTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 3rem; color: var(--text-muted);">Нет данных за этот период</td></tr>';
    return;
  }

  // Calculate days in the selected month up to today if current month
  const today = new Date();
  let endDate = toDate;
  if (toDate > today) endDate = today;

  const diffTime = Math.abs(endDate - fromDate);
  let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) diffDays = 1;

  data.forEach((item, index) => {
    const avgPerDay = (item.totalScans / diffDays).toFixed(1);
    const tr = document.createElement('tr');

    // Highlight top 3
    let placeClass = '';
    let placeEmoji = index + 1;
    if (index === 0) { placeClass = 'place-first'; placeEmoji = '🥇'; }
    else if (index === 1) { placeClass = 'place-second'; placeEmoji = '🥈'; }
    else if (index === 2) { placeClass = 'place-third'; placeEmoji = '🥉'; }

    tr.innerHTML = `
      <td style="text-align: center; font-weight: bold; font-size: 1.1rem;">${placeEmoji}</td>
      <td>
        <div style="font-weight: 600; color: var(--text-primary);">${item.name}</div>
      </td>
      <td style="text-align: center;">
        <span class="badge badge-success" style="padding: 0.5rem 1rem; font-size: 1rem; border-radius: 20px;">${item.totalScans}</span>
      </td>
      <td style="text-align: center;">
        <span class="badge badge-info" style="background: rgba(14, 165, 233, 0.1); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.2);">${item.uniquePoints.size}</span>
      </td>
      <td style="text-align: center; color: var(--text-muted); font-size: 0.9rem;">
        ~${avgPerDay} / день
      </td>
    `;
    tbody.appendChild(tr);
  });

  showNotification('KPI обновлен', 'success');
}
