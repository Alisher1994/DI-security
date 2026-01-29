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

// Глобальная переменная для разблокировки звука
let audioUnlocked = false;

function unlockAudio() {
    if (audioUnlocked) return;

    // Создаем короткий "пустой" звук для разблокировки
    const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
    silentAudio.play().then(() => {
        audioUnlocked = true;
        console.log('🔊 Звук разблокирован браузером');
        // Убираем слушатели
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    }).catch(e => console.warn('Не удалось разблокировать звук:', e));
}

// Добавляем слушатели на первое взаимодействие
document.addEventListener('click', unlockAudio);
document.addEventListener('touchstart', unlockAudio);

// Radio (Walkie-Talkie) State
let socket = null;
let mediaRecorder = null;
let audioChunks = [];
let audioQueue = [];
let isPlaying = false;
let currentChannel = 'general';

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

    // Radio events
    const pttButton = document.getElementById('ptt-button');
    if (pttButton) {
        pttButton.addEventListener('mousedown', startTransmission);
        pttButton.addEventListener('mouseup', stopTransmission);
        pttButton.addEventListener('mouseleave', stopTransmission); // Если мышка ушла с кнопки

        pttButton.addEventListener('touchstart', (e) => { e.preventDefault(); startTransmission(); });
        pttButton.addEventListener('touchend', (e) => { e.preventDefault(); stopTransmission(); });
        pttButton.addEventListener('touchcancel', (e) => { e.preventDefault(); stopTransmission(); }); // Если палец ушел
    }

    const channelSelect = document.getElementById('radio-channel');
    if (channelSelect) {
        channelSelect.addEventListener('change', (e) => {
            switchChannel(e.target.value);
        });
    }
}

// ... existing code ...
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

        if (socket) {
            socket.disconnect();
            socket = null;
        }

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

    // ПРОВЕРКА АКТИВНОЙ СЕССИИ (Восстановление состояния)
    await checkActiveSession();

    // Start realtime updates
    startRealtimeUpdates();

    // Init Radio
    initRadio();
}

async function checkActiveSession() {
    try {
        const data = await apiRequest('/gps/sessions?active_only=true');
        const activeSessions = data.sessions.filter(s => s.is_active);

        if (activeSessions.length > 0) {
            patrolSession = activeSessions[0];
            // Восстанавливаем счетчик сканов этой сессии
            scanCount = parseInt(patrolSession.scan_count) || 0;

            document.getElementById('session-scans').textContent = scanCount;
            document.getElementById('session-inactive').style.display = 'none';
            document.getElementById('session-active').style.display = 'block';

            // Запускаем GPS и Таймер (с учетом времени начала сессии)
            startGPSTracking();
            startSessionTimer(new Date(patrolSession.session_start));

            console.log('🔄 Сессия патрулирования восстановлена');
        }
    } catch (error) {
        console.error('Ошибка при проверке активной сессии:', error);
    }
}

// Radio Functionality
function initRadio() {
    if (typeof io === 'undefined') {
        console.log('Socket.io library not loaded yet...');
        return;
    }

    socket = io();

    socket.on('connect', () => {
        document.getElementById('radio-online-status').classList.add('online');
        document.getElementById('radio-status-text').textContent = 'Онлайн';
        document.getElementById('ptt-button').disabled = false;

        // Join initial channel
        switchChannel(currentChannel);
    });

    socket.on('disconnect', () => {
        document.getElementById('radio-online-status').classList.remove('online');
        document.getElementById('radio-status-text').textContent = 'Оффлайн';
        document.getElementById('ptt-button').disabled = true;
    });

    socket.on('ptt-active', (data) => {
        const incomingEl = document.getElementById('radio-incoming');
        const idleEl = document.getElementById('radio-idle');
        const senderNameEl = document.getElementById('radio-sender-name');

        if (data.active) {
            incomingEl.style.display = 'flex';
            idleEl.style.display = 'none';
            senderNameEl.textContent = data.senderName;
        } else {
            incomingEl.style.display = 'none';
            idleEl.style.display = 'block';
        }
    });

    socket.on('audio-broadcast', (data) => {
        // Play incoming audio chunk
        playAudioBuffer(data.chunk);
    });

    // Request Mic access early
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            console.log('🎤 Микрофон доступен');
        })
        .catch(err => {
            console.error('Mic access denied:', err);
            showNotification('Доступ к микрофону запрещен. Рация не будет работать.', 'error');
        });
}

function switchChannel(channelId) {
    currentChannel = channelId;
    if (socket) {
        socket.emit('join-channel', channelId);
    }
}

async function startTransmission() {
    if (!socket || !socket.connected) {
        showNotification('Нет соединения с сервером рации', 'error');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Для iPhone/Safari и Android используем более универсальные форматы
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/mp4';

        const startRecording = () => {
            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                mediaRecorder = new MediaRecorder(stream, { mimeType });

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            socket.emit('audio-chunk', {
                                channelId: currentChannel,
                                chunk: reader.result,
                                senderName: currentUser.full_name
                            });
                        };
                        reader.readAsDataURL(event.data);
                    }
                };

                mediaRecorder.start();
            }
        };

        document.getElementById('ptt-button').classList.add('recording');
        socket.emit('ptt-start', { channelId: currentChannel, senderName: currentUser.full_name });

        // Запускаем цикл записи коротких самостоятельных файлов
        startRecording();
        window.pttInterval = setInterval(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                // Начинаем заново после остановки
                setTimeout(startRecording, 10);
            }
        }, 1500);

    } catch (err) {
        console.error('Failed to start recording:', err);
        showNotification('Ошибка микрофона: ' + err.message, 'error');
    }
}

function stopTransmission() {
    if (window.pttInterval) {
        clearInterval(window.pttInterval);
        window.pttInterval = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    document.getElementById('ptt-button').classList.remove('recording');
    if (socket) {
        socket.emit('ptt-stop', { channelId: currentChannel });
    }
}

function playAudioBuffer(base64Data) {
    if (!audioUnlocked) {
        // Если звук еще не разблокирован, просто пишем в консоль один раз
        if (!window.audioWarned) {
            console.warn('Playback blocked: Waiting for user interaction');
            window.audioWarned = true;
        }
        return;
    }

    try {
        const audio = new Audio(base64Data);
        audio.play().catch(e => {
            // Игнорируем ошибки автоплея, если они все еще есть
        });
    } catch (e) {
        console.error('Audio play error:', e);
    }
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
    // Приводим время окончания к формату текущей даты для расчета разницы
    const [hours, minutes] = shift.shift_end.split(':');
    const shiftEnd = new Date();
    shiftEnd.setHours(parseInt(hours), parseInt(minutes), 0);

    const diff = shiftEnd - now;
    const timeRemainingEl = document.getElementById('shift-time-remaining');

    if (diff > 0) {
        const hoursLeft = Math.floor(diff / (1000 * 60 * 60));
        const minutesLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        timeRemainingEl.textContent = `До конца смены: ${hoursLeft}ч ${minutesLeft}м`;
    } else {
        timeRemainingEl.textContent = 'Смена завершена';
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

function startSessionTimer(startTime = new Date()) {
    // Очищаем старый интервал если есть
    if (sessionInterval) clearInterval(sessionInterval);

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
        // Яндекс.Карты используют [Широта, Долгота]
        userMarker.geometry.setCoordinates([latitude, longitude]);
        map.setCenter([latitude, longitude]);
    }

    // Update UI
    document.getElementById('gps-accuracy').textContent = `${Math.round(accuracy)} м`;
    document.getElementById('last-update').textContent = new Date().toLocaleTimeString('ru-RU');

    // КРИТИЧНО: Не отправляем на сервер, если нет активной сессии патруля
    if (!patrolSession) return;

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
                const coords = [position.coords.latitude, position.coords.longitude];
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
    console.log('🔍 Начинаю обработку QR:', qrCode);
    if (!navigator.geolocation) {
        showNotification('GPS не поддерживается', 'error');
        return;
    }

    // Показываем индикатор загрузки
    const resultEl = document.getElementById('scan-result');
    resultEl.innerHTML = '<div style="text-align: center;">⌛ Обработка...</div>';
    resultEl.className = 'scan-result';

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        console.log(`📍 Мои координаты: ${latitude}, ${longitude} (Точность: ${accuracy}м)`);

        try {
            const data = await apiRequest('/scans/scan', {
                method: 'POST',
                body: JSON.stringify({
                    qr_code_data: qrCode,
                    latitude,
                    longitude
                })
            });

            console.log('✅ Ответ сервера:', data);

            // Обновляем счетчик если идет патруль
            if (patrolSession) {
                scanCount++;
                document.getElementById('session-scans').textContent = scanCount;
            }

            // Показываем успех
            resultEl.innerHTML = `
                <div style="text-align: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">✅</div>
                    <div style="font-weight: 700; color: var(--success-color); margin-bottom: 0.25rem;">ОТМЕТКА ПРИНЯТА</div>
                    <div style="font-size: 1rem; font-weight: 600;">${data.checkpoint.name}</div>
                    <div style="font-size: 0.75rem; margin-top: 0.5rem; color: var(--text-muted);">
                        Расстояние: ${Math.round(data.distance_meters)} м
                    </div>
                </div>
            `;
            resultEl.className = 'scan-result success';

            showNotification('Отметка успешно сохранена', 'success');

            // Перезагружаем историю через 3 секунды и очищаем результат
            setTimeout(() => {
                loadScanHistory();
                resultEl.innerHTML = '';
                resultEl.className = 'scan-result';
            }, 5000);

        } catch (error) {
            console.error('❌ Ошибка сканирования:', error);

            resultEl.innerHTML = `
                <div style="text-align: center;">
                    <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">❌</div>
                    <div style="font-weight: 700; color: var(--danger-color); margin-bottom: 0.25rem;">НЕ СОХРАНЕНО</div>
                    <div style="font-size: 0.875rem;">${error.message}</div>
                </div>
            `;
            resultEl.className = 'scan-result error';

            showNotification(error.message, 'error');
        }
    }, (error) => {
        console.error('❌ Ошибка GPS:', error);
        showNotification('Не удалось получить GPS: ' + error.message, 'error');
        resultEl.innerHTML = '<div style="text-align: center;">❌ Ошибка GPS</div>';
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
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
