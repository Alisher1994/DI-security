// API Configuration
const API_BASE = window.location.origin + '/api';
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let currentShift = null;
let patrolSession = null;
let map = null;
let userMarker = null;
let checkpointMarkers = [];
let gpsWatchId = null;
let sessionInterval = null;
let scanCount = 0;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        loadUserData();
    } else {
        showScreen('login-screen');
    }

    setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('start-patrol-btn').addEventListener('click', startPatrolSession);
    document.getElementById('stop-patrol-btn').addEventListener('click', stopPatrolSession);
    document.getElementById('scan-qr-btn').addEventListener('click', openQRScanner);
    document.getElementById('close-scanner').addEventListener('click', closeQRScanner);
    document.getElementById('manual-qr-submit').addEventListener('click', submitManualQR);
}

// Screen Management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

function showError(elementId, message) {
    const errorEl = document.getElementById(elementId);
    errorEl.textContent = message;
    errorEl.classList.add('active');
    setTimeout(() => errorEl.classList.remove('active'), 5000);
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

// Authentication
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        authToken = data.token;
        localStorage.setItem('authToken', authToken);
        currentUser = data.user;

        showScreen('main-screen');
        initializeMainScreen();
    } catch (error) {
        showError('login-error', error.message);
    }
}

function handleLogout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        if (gpsWatchId) {
            navigator.geolocation.clearWatch(gpsWatchId);
        }
        if (sessionInterval) {
            clearInterval(sessionInterval);
        }

        localStorage.removeItem('authToken');
        authToken = null;
        currentUser = null;

        showScreen('login-screen');
        document.getElementById('login-form').reset();
    }
}

// Load User Data
async function loadUserData() {
    try {
        const data = await apiRequest('/auth/me');
        currentUser = data.user;
        showScreen('main-screen');
        initializeMainScreen();
    } catch (error) {
        console.error('Failed to load user data:', error);
        localStorage.removeItem('authToken');
        authToken = null;
        showScreen('login-screen');
    }
}

// Initialize Main Screen
async function initializeMainScreen() {
    // Update user info
    const initials = currentUser.full_name.split(' ').map(n => n[0]).join('');
    document.getElementById('user-initials').textContent = initials;
    document.getElementById('user-name').textContent = currentUser.full_name;
    document.getElementById('user-role').textContent = getRoleLabel(currentUser.role);

    // Show patrol controls if user is patrol
    if (currentUser.role === 'patrol') {
        document.getElementById('patrol-controls').style.display = 'block';
        document.getElementById('map-section').style.display = 'block';
        initializeMap();
    }

    // Load current shift
    await loadCurrentShift();

    // Load checkpoints
    await loadCheckpoints();

    // Load scan history
    await loadScanHistory();

    // Start realtime updates
    startRealtimeUpdates();
}

function getRoleLabel(role) {
    const labels = {
        'admin': 'Администратор',
        'kpp': 'КПП',
        'patrol': 'Патруль'
    };
    return labels[role] || role;
}

// Shift Management
async function loadCurrentShift() {
    try {
        const data = await apiRequest('/shifts/current');

        if (data.has_active_shift) {
            currentShift = data.shift;
            showActiveShift(currentShift);
            document.getElementById('scan-qr-btn').disabled = false;
        } else {
            showNoShift();
            document.getElementById('scan-qr-btn').disabled = true;
        }
    } catch (error) {
        console.error('Failed to load shift:', error);
        showNoShift();
    }
}

function showActiveShift(shift) {
    document.getElementById('no-shift').style.display = 'none';
    document.getElementById('active-shift').style.display = 'block';
    document.getElementById('shift-start').textContent = shift.shift_start.slice(0, 5);
    document.getElementById('shift-end').textContent = shift.shift_end.slice(0, 5);

    updateShiftTimeRemaining(shift);
}

function showNoShift() {
    document.getElementById('no-shift').style.display = 'block';
    document.getElementById('active-shift').style.display = 'none';
}

function updateShiftTimeRemaining(shift) {
    const now = new Date();
    const shiftEnd = new Date();
    const [hours, minutes] = shift.shift_end.split(':');
    shiftEnd.setHours(parseInt(hours), parseInt(minutes), 0);

    const diff = shiftEnd - now;
    if (diff > 0) {
        const hoursLeft = Math.floor(diff / (1000 * 60 * 60));
        const minutesLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        document.getElementById('shift-time-remaining').textContent =
            `Осталось: ${hoursLeft}ч ${minutesLeft}м`;
    } else {
        document.getElementById('shift-time-remaining').textContent = 'Смена завершена';
    }
}

// Patrol Session Management
async function startPatrolSession() {
    try {
        const data = await apiRequest('/gps/session/start', {
            method: 'POST'
        });

        patrolSession = data.session;
        scanCount = 0;

        document.getElementById('session-inactive').style.display = 'none';
        document.getElementById('session-active').style.display = 'block';

        // Start GPS tracking
        startGPSTracking();

        // Start session timer
        startSessionTimer();

        showNotification('Патрулирование начато', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

async function stopPatrolSession() {
    if (!confirm('Завершить патрулирование?')) {
        return;
    }

    try {
        await apiRequest('/gps/session/end', {
            method: 'POST'
        });

        patrolSession = null;

        document.getElementById('session-inactive').style.display = 'block';
        document.getElementById('session-active').style.display = 'none';

        // Stop GPS tracking
        if (gpsWatchId) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }

        // Stop session timer
        if (sessionInterval) {
            clearInterval(sessionInterval);
            sessionInterval = null;
        }

        showNotification('Патрулирование завершено', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

function startSessionTimer() {
    const startTime = new Date();

    sessionInterval = setInterval(() => {
        const now = new Date();
        const diff = now - startTime;

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('session-duration').textContent =
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

// GPS Tracking
function startGPSTracking() {
    if (!navigator.geolocation) {
        showNotification('GPS не поддерживается вашим устройством', 'error');
        return;
    }

    gpsWatchId = navigator.geolocation.watchPosition(
        sendGPSUpdate,
        (error) => {
            console.error('GPS error:', error);
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
}

async function sendGPSUpdate(position) {
    const { latitude, longitude, accuracy, speed } = position.coords;

    // Update map
    if (map && userMarker) {
        userMarker.geometry.setCoordinates([longitude, latitude]);
        map.setCenter([longitude, latitude]);
    }

    // Update UI
    document.getElementById('gps-accuracy').textContent = `${Math.round(accuracy)} м`;
    document.getElementById('last-update').textContent = new Date().toLocaleTimeString('ru-RU');

    try {
        await apiRequest('/gps/track', {
            method: 'POST',
            body: JSON.stringify({
                latitude,
                longitude,
                accuracy,
                speed
            })
        });
    } catch (error) {
        console.error('Failed to send GPS update:', error);
    }
}

// Map Initialization
function initializeMap() {
    ymaps.ready(() => {
        map = new ymaps.Map('map', {
            center: [55.751244, 37.618423],
            zoom: 15,
            controls: ['zoomControl']
        });

        // Add user marker
        userMarker = new ymaps.Placemark([55.751244, 37.618423], {
            iconCaption: 'Вы здесь'
        }, {
            preset: 'islands#blueCircleDotIcon'
        });

        map.geoObjects.add(userMarker);

        // Try to get user's current location
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition((position) => {
                const coords = [position.coords.longitude, position.coords.latitude];
                userMarker.geometry.setCoordinates(coords);
                map.setCenter(coords);
            });
        }
    });
}

async function loadCheckpoints() {
    try {
        const data = await apiRequest('/checkpoints');

        if (map) {
            // Clear existing markers
            checkpointMarkers.forEach(marker => map.geoObjects.remove(marker));
            checkpointMarkers = [];

            // Add checkpoint markers
            data.checkpoints.forEach(cp => {
                const marker = new ymaps.Placemark([cp.latitude, cp.longitude], {
                    balloonContent: `
            <strong>${cp.name}</strong><br>
            <small>${cp.description || ''}</small><br>
            <small>Тип: ${cp.checkpoint_type === 'kpp' ? 'КПП' : 'Патруль'}</small>
          `
                }, {
                    preset: cp.checkpoint_type === 'kpp' ? 'islands#redDotIcon' : 'islands#greenDotIcon'
                });

                map.geoObjects.add(marker);
                checkpointMarkers.push(marker);

                // Add radius circle
                const circle = new ymaps.Circle([[cp.latitude, cp.longitude], cp.radius_meters], {}, {
                    fillColor: cp.checkpoint_type === 'kpp' ? '#ff000020' : '#00ff0020',
                    strokeColor: cp.checkpoint_type === 'kpp' ? '#ff0000' : '#00ff00',
                    strokeOpacity: 0.5,
                    strokeWidth: 2
                });

                map.geoObjects.add(circle);
                checkpointMarkers.push(circle);
            });
        }
    } catch (error) {
        console.error('Failed to load checkpoints:', error);
    }
}

// QR Scanner
let html5QrCode = null;

async function openQRScanner() {
    document.getElementById('qr-scanner-modal').classList.add('active');

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    try {
        await html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
                // Success
                html5QrCode.stop();
                document.getElementById('qr-scanner-modal').classList.remove('active');
                processQRScan(decodedText);
            },
            (errorMessage) => {
                // scan error, ignore
            }
        );
    } catch (err) {
        console.error("Unable to start scanning", err);
        showNotification("Не удалось запустить камеру", "error");
    }
}

async function closeQRScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop();
    }
    document.getElementById('qr-scanner-modal').classList.remove('active');
    document.getElementById('manual-qr-input').value = '';
    document.getElementById('scan-result').innerHTML = '';
    document.getElementById('scan-result').className = 'scan-result';
}

async function submitManualQR() {
    const qrCode = document.getElementById('manual-qr-input').value.trim();

    if (!qrCode) {
        showNotification('Введите QR-код', 'error');
        return;
    }

    await processQRScan(qrCode);
}

async function processQRScan(qrCode) {
    if (!navigator.geolocation) {
        showNotification('GPS не поддерживается', 'error');
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;

        try {
            const data = await apiRequest('/scans/scan', {
                method: 'POST',
                body: JSON.stringify({
                    qr_code_data: qrCode,
                    latitude,
                    longitude
                })
            });

            // Update scan count if in session
            if (patrolSession) {
                scanCount++;
                document.getElementById('session-scans').textContent = scanCount;
            }

            // Show success
            const resultEl = document.getElementById('scan-result');
            resultEl.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">✅</div>
          <div style="font-weight: 600; margin-bottom: 0.5rem;">Успешно!</div>
          <div>${data.checkpoint.name}</div>
          <div style="font-size: 0.875rem; margin-top: 0.5rem; opacity: 0.7;">
            Расстояние: ${Math.round(data.distance_meters)} м
          </div>
        </div>
      `;
            resultEl.className = 'scan-result success';

            // Reload scan history
            setTimeout(() => {
                loadScanHistory();
                document.getElementById('manual-qr-input').value = '';
            }, 2000);

            showNotification('QR-код успешно отсканирован', 'success');
        } catch (error) {
            const resultEl = document.getElementById('scan-result');
            resultEl.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">❌</div>
          <div style="font-weight: 600; margin-bottom: 0.5rem;">Ошибка</div>
          <div>${error.message}</div>
        </div>
      `;
            resultEl.className = 'scan-result error';

            showNotification(error.message, 'error');
        }
    }, (error) => {
        showNotification('Не удалось получить GPS координаты', 'error');
    });
}

// Scan History
async function loadScanHistory() {
    try {
        const data = await apiRequest('/scans?limit=10');

        const historyEl = document.getElementById('scan-history');

        if (data.scans.length === 0) {
            historyEl.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📋</div>
          <div>Нет сканирований</div>
        </div>
      `;
            return;
        }

        historyEl.innerHTML = data.scans.map(scan => `
      <div class="scan-item">
        <div class="scan-icon ${scan.is_valid ? 'success' : 'error'}">
          ${scan.is_valid ? '✅' : '❌'}
        </div>
        <div class="scan-details">
          <div class="scan-checkpoint">${scan.checkpoint_name}</div>
          <div class="scan-time">${formatDateTime(scan.scan_time)}</div>
          ${scan.distance_meters ? `<div class="scan-distance">Расстояние: ${Math.round(scan.distance_meters)} м</div>` : ''}
        </div>
      </div>
    `).join('');
    } catch (error) {
        console.error('Failed to load scan history:', error);
    }
}

// Realtime Updates
function startRealtimeUpdates() {
    // Reload shift status every minute
    setInterval(loadCurrentShift, 60000);

    // Reload scan history every 30 seconds
    setInterval(loadScanHistory, 30000);
}

// Notifications
function showNotification(message, type = 'info') {
    // Simple notification using a temporary div
    const notification = document.createElement('div');
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'success' ? 'var(--success-color)' : 'var(--danger-color)'};
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
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Add animations to CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(400px);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
