// Универсальная система карт для admin-app.js
// Поддерживает: Leaflet (OpenStreetMap), Yandex Maps, Google Maps

// Функция инициализации карты с автоматическим выбором провайдера
function initializeRealtimeMap() {
    // Проверяем доступность Leaflet (OpenStreetMap - бесплатно)
    if (typeof L !== 'undefined') {
        mapProvider = 'leaflet';
        console.log('🗺️ Используется OpenStreetMap (Leaflet)');

        // Создаем карту Leaflet
        realtimeMap = L.map('realtime-map').setView([41.204358, 69.234420], 14);

        // Добавляем тайлы OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(realtimeMap);

        // Правый клик для добавления точки
        realtimeMap.on('contextmenu', (e) => {
            const { lat, lng } = e.latlng;
            showContextMenu(e.originalEvent.pageX, e.originalEvent.pageY, lat, lng);
        });

        // Клик по карте для добавления точки
        realtimeMap.on('click', (e) => {
            const { lat, lng } = e.latlng;
            showCheckpointModal({ latitude: lat.toFixed(6), longitude: lng.toFixed(6), is_new_from_map: true });
        });

    } else if (typeof ymaps !== 'undefined') {
        // Fallback на Yandex Maps
        mapProvider = 'yandex';
        console.log('🗺️ Используется Yandex Maps');

        ymaps.ready(() => {
            realtimeMap = new ymaps.Map('realtime-map', {
                center: [41.204358, 69.234420],
                zoom: 14,
                controls: ['zoomControl', 'fullscreenControl', 'typeSelector']
            });

            // Правый клик для добавления точки
            realtimeMap.events.add('contextmenu', (e) => {
                const coords = e.get('coords');
                showContextMenu(e.get('domEvent').get('pageX'), e.get('domEvent').get('pageY'), coords[0], coords[1]);
                e.preventDefault();
            });

            // Клик по карте для добавления точки
            realtimeMap.events.add('click', (e) => {
                const coords = e.get('coords');
                showCheckpointModal({ latitude: coords[0].toFixed(6), longitude: coords[1].toFixed(6), is_new_from_map: true });
            });
        });
    } else {
        console.error('❌ Ни один провайдер карт не доступен');
        showNotification('Карты недоступны. Проверьте подключение к интернету.', 'error');
    }
}

// Универсальная функция для показа контекстного меню
function showContextMenu(pageX, pageY, lat, lng) {
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
    menu.style.left = pageX + 'px';
    menu.style.top = pageY + 'px';

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
}

// Универсальная функция рендеринга карты
function renderRealtimeMap(checkpoints, patrols) {
    if (!realtimeMap) return;

    if (mapProvider === 'leaflet') {
        renderLeafletMap(checkpoints, patrols);
    } else if (mapProvider === 'yandex') {
        renderYandexMap(checkpoints, patrols);
    }
}

// Рендеринг для Leaflet (OpenStreetMap)
function renderLeafletMap(checkpoints, patrols) {
    // Очищаем старые маркеры
    mapMarkers.forEach(marker => marker.remove());
    mapMarkers = [];

    // Добавляем контрольные точки
    checkpoints.forEach(cp => {
        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="width: 14px; height: 14px; background: ${cp.checkpoint_type === 'kpp' ? '#ef4444' : '#10b981'}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 0 2px ${cp.checkpoint_type === 'kpp' ? '#ef444440' : '#10b98140'};"></div>
          <div style="margin-top: 4px; background: rgba(255,255,255,0.95); color: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; border: 1px solid #cbd5e1; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            ${cp.name}
          </div>
        </div>
      `,
            iconSize: [40, 60],
            iconAnchor: [20, 30]
        });

        const marker = L.marker([cp.latitude, cp.longitude], { icon }).addTo(realtimeMap);

        marker.bindPopup(`
      <div style="min-width: 200px; padding: 5px; color: #1e293b;">
        <strong style="font-size: 1.1rem; display: block; margin-bottom: 5px;">${cp.name}</strong>
        <div style="margin-bottom: 10px; color: #64748b; font-size: 0.85rem;">
          ${cp.checkpoint_type === 'kpp' ? '🔴 КПП' : '🟢 Патруль'}<br>
          ${cp.description || ''}
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
    patrols.forEach(patrol => {
        if (patrol.latitude && patrol.longitude) {
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `
          <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">👮</div>
            <div style="background: rgba(15, 23, 42, 0.95); color: white; padding: 4px 10px; border-radius: 8px; font-size: 10px; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; box-shadow: 0 4px 15px rgba(0,0,0,0.5); text-align: center; min-width: 100px;">
              <div style="font-weight: 800; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.2); margin-bottom: 4px; padding-bottom: 2px;">${patrol.full_name}</div>
              <div style="opacity: 0.9; font-weight: 600; color: #10b981; font-size: 9px;">● Онлайн</div>
              <div style="opacity: 0.7; font-size: 9px; margin-top: 2px;">Обновлено: ${new Date(patrol.recorded_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
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
}

// Рендеринг для Yandex Maps (существующий код)
function renderYandexMap(checkpoints, patrols) {
    realtimeMap.geoObjects.removeAll();

    // Add checkpoints
    checkpoints.forEach(cp => {
        const marker = new ymaps.Placemark([cp.latitude, cp.longitude], {
            iconCaption: cp.name,
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
                iconLayout: 'default#imageWithContent',
                iconImageHref: '',
                iconImageSize: [52, 52],
                iconImageOffset: [-26, -45],
                iconContentLayout: ymaps.templateLayoutFactory.createClass(
                    `<div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">👮</div>
            <div style="background: rgba(15, 23, 42, 0.95); color: white; padding: 4px 10px; border-radius: 8px; font-size: 10px; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; box-shadow: 0 4px 15px rgba(0,0,0,0.5); text-align: center; min-width: 100px;">
                <div style="font-weight: 800; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.2); margin-bottom: 4px; padding-bottom: 2px;">${patrol.full_name}</div>
                <div style="opacity: 0.9; font-weight: 600; color: #10b981; font-size: 9px;">● Онлайн</div>
                <div style="opacity: 0.7; font-size: 9px; margin-top: 2px;">Обновлено: ${new Date(patrol.recorded_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
           </div>`
                )
            });

            realtimeMap.geoObjects.add(marker);
        }
    });
}
