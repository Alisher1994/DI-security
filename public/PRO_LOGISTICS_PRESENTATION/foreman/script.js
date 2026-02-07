/**
 * Foreman App Logic (Прораб)
 */

let map = null;
let userStaticMarker = null;
let driverMarker = null;
let routeLayer = null;

// Helper to get coordinates under the fixed marker (roughly 30% from top)
function getMarkerLatLng() {
    if (!map) return null;
    const mapHeight = map.getSize().y;
    // Marker visual position is top: 30%
    const targetPoint = L.point(map.getSize().x / 2, mapHeight * 0.3);
    return map.containerPointToLatLng(targetPoint);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEquipmentSelector();
});

function initMap() {
    // Default: Tashkent Center
    const defaultLat = 41.2995;
    const defaultLng = 69.2401;

    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([defaultLat, defaultLng], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    // Marker is now HTML overlay, not Leaflet layer
    const markerEl = document.getElementById('fixed-marker');

    // Add animation events
    map.on('movestart', () => {
        if (markerEl) markerEl.classList.add('hopping');
        document.getElementById('address-to').innerText = "Определяем адрес...";
        const addrVal = document.querySelector('.address-value');
        if (addrVal) addrVal.innerText = "Определяем адрес...";
    });

    map.on('moveend', () => {
        if (markerEl) markerEl.classList.remove('hopping');
        const target = getMarkerLatLng();
        if (target) fetchAddress(target.lat, target.lng);
    });

    // Try to get real location (Commented out to prevent auto-request violation)
    // locateUser(); 

    // Initial fetch for default
    const target = getMarkerLatLng();
    if (target) fetchAddress(target.lat, target.lng);
}

function locateUser() {
    if (navigator.geolocation) {
        // Show loading state potentially
        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (!map) return;
                const { latitude, longitude } = position.coords;
                const userLatLng = [latitude, longitude];

                // Set view and shift center for overlay
                map.setView(userLatLng, 16);

                setTimeout(() => {
                    if (!map) return;
                    const mapHeight = map.getSize().y;
                    const offset = mapHeight * 0.2; // 20% of height
                    map.panBy([0, -offset], { animate: false });

                    // Force update address after shift
                    const target = getMarkerLatLng();
                    if (target) fetchAddress(target.lat, target.lng);
                }, 100);
            },
            (error) => {
                console.warn("Geolocation error:", error);
                alert("Не удалось определить местоположение. Проверьте настройки GPS.");
            }
        );
    } else {
        alert("Ваш браузер не поддерживает геолокацию");
    }
}

async function fetchAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
            headers: { 'Accept-Language': 'ru' } // Request Russian language
        });
        const data = await response.json();

        let address = "Адрес не найден";
        if (data && data.address) {
            // Construct simple address: Street + House number or Name
            const road = data.address.road || data.address.pedestrian || data.address.suburb || "";
            const house = data.address.house_number || "";
            const city = data.address.city || data.address.town || data.address.village || "";

            if (road) {
                address = `${road}${house ? ', ' + house : ''}`;
            } else if (city) {
                address = city;
            } else {
                address = data.display_name.split(',')[0];
            }
        }

        document.getElementById('address-to').innerText = address;
        if (document.querySelector('.address-value')) {
            document.querySelector('.address-value').innerText = address;
        }

    } catch (e) {
        console.error("Geocoding error:", e);
        document.getElementById('address-to').innerText = "Ошибка определения адреса";
    }
}

// Data
const data = {
    special: {
        categories: [
            { id: 'excavator', name: 'Экскаваторы', icon: '🚜' },
            { id: 'crane', name: 'Автокраны', icon: '🏗️' },
            { id: 'aerial', name: 'Автовышки', icon: '🪜' }
        ],
        machines: {
            'excavator': [{ name: 'JCB 3CX', price: '3000 ₽/ч', icon: '🚜' }, { name: 'Гусеничный', price: '3500 ₽/ч', icon: '🚜' }],
            'crane': [{ name: 'Ивановец 25т', price: '2500 ₽/ч', icon: '🏗️' }, { name: 'Liebherr 50т', price: '5000 ₽/ч', icon: '🏗️' }],
            'aerial': [{ name: 'Вышка 18м', price: '1800 ₽/ч', icon: '🪜' }, { name: 'Вышка 28м', price: '2800 ₽/ч', icon: '🪜' }]
        }
    },
    cargo: {
        categories: [
            { id: 'shalanda', name: 'Шаланда', icon: '🥓' },
            { id: 'dump', name: 'Самосвал', icon: '🚛' },
            { id: 'flatbed', name: 'Бортовой', icon: '🚚' }
        ],
        machines: {
            'shalanda': [{ name: 'Шаланда 13м', price: '10000 ₽', icon: '🥓', dims: '13.6x2.45' }, { name: 'Шаланда Откр.', price: '11000 ₽', icon: '🥓', dims: '13.6x2.45' }],
            'dump': [{ name: 'Камаз 20т', price: '8000 ₽', icon: '🚛' }, { name: 'Howo 30т', price: '9000 ₽', icon: '🚛' }],
            'flatbed': [{ name: 'Борт 6м', price: '5000 ₽', icon: '🚚' }, { name: 'Борт 12м', price: '7000 ₽', icon: '🚚' }]
        }
    }
};

let currentMode = null;
let currentCategory = null;
let selectedPayment = 'cash';

function initEquipmentSelector() {
    document.getElementById('btn-next').addEventListener('click', () => {
        showMachines(currentCategory);
    });

    document.getElementById('btn-to-form').addEventListener('click', () => {
        showStep('form');
        // Set default date/time today if empty
        if (!document.getElementById('order-date').value) {
            document.getElementById('order-date').valueAsDate = new Date();
        }
    });

    document.getElementById('btn-order').addEventListener('click', () => {
        // Collect data (for console/backend)
        const date = document.getElementById('order-date').value;
        const time = document.getElementById('order-time').value;
        const comment = document.getElementById('order-comment').value;
        const address = document.getElementById('address-to').innerText;
        console.log("Order Data:", { mode: currentMode, category: currentCategory, date, time, comment, address, payment: selectedPayment });

        // Start Search UI
        showStep('search');

        // Enable radar on map marker
        const marker = document.getElementById('fixed-marker');
        if (marker) marker.classList.add('searching');

        // Simulate Found after 3 seconds
        setTimeout(() => {
            if (!document.getElementById('step-search').classList.contains('hidden')) {
                showStep('found');
                if (marker) marker.classList.remove('searching');

                // Get User Location (Center/Marker)
                const userLoc = getMarkerLatLng();

                // 1. "Pin" the location (Replace floating marker with static map marker)
                document.getElementById('fixed-marker').classList.add('hidden');

                const userPinIcon = L.divIcon({
                    className: 'user-static-pin',
                    html: `
                        <div style="display:flex; flex-direction:column; align-items:center; transform:translateY(-100%);">
                            <div class="marker-sign">Вы здесь</div>
                            <div class="marker-stick"></div>
                        </div>
                    `,
                    iconSize: [100, 60], // container size
                    iconAnchor: [50, 60] // Tip at coordinates
                });

                userStaticMarker = L.marker([userLoc.lat, userLoc.lng], { icon: userPinIcon }).addTo(map);

                // Simulator Driver Location (simulated nearby, e.g. +0.005 lat, +0.005 lng)
                // Randomize slightly for "realism"
                const driverLat = userLoc.lat + 0.003 + (Math.random() * 0.002);
                const driverLng = userLoc.lng + 0.003 + (Math.random() * 0.002);

                // Add Driver Marker
                const driverIcon = L.divIcon({
                    className: 'driver-marker',
                    html: '<div style="font-size:30px;">🚜</div>',
                    iconSize: [40, 40],
                    iconAnchor: [20, 20]
                });

                driverMarker = L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(map);

                // Build Route
                drawRoute([driverLat, driverLng], [userLoc.lat, userLoc.lng]);
            }
        }, 3000);
    });
}

// OSRM Routing
async function drawRoute(start, end) {
    try {
        const query = `${start[1]},${start[0]};${end[1]},${end[0]}`;
        const url = `https://router.project-osrm.org/route/v1/driving/${query}?overview=full&geometries=geojson`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]); // Swap to LatLng

            // Draw Polyline
            if (routeLayer) map.removeLayer(routeLayer); // Clear old

            routeLayer = L.polyline(coordinates, {
                color: '#2196F3', // Blue route
                weight: 5,
                opacity: 0.8,
                lineJoin: 'round'
            }).addTo(map);

            // Zoom to fit route
            const bounds = L.latLngBounds(coordinates);
            map.fitBounds(bounds, { padding: [80, 80] });
        }
    } catch (e) {
        console.error("Routing error:", e);
    }
}

function cancelSearch() {
    // Return to form
    showStep('form');

    // Stop radar
    const marker = document.getElementById('fixed-marker');
    if (marker) {
        marker.classList.remove('searching');
        marker.classList.remove('hidden'); // Show floating marker again
    }

    // Clean up map objects
    if (userStaticMarker) { map.removeLayer(userStaticMarker); userStaticMarker = null; }
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
}

function selectPayment(type, el) {
    selectedPayment = type;
    document.querySelectorAll('.payment-option').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
}

function selectMode(mode) {
    currentMode = mode;

    // UI Updates
    document.getElementById('step-mode').classList.add('hidden');
    document.getElementById('step-category').classList.remove('hidden');
    document.getElementById('address-to').innerText = mode === 'cargo' ? 'Куда везти?' : 'Куда подать технику?';

    if (mode === 'cargo') {
        document.getElementById('search-bar-from').classList.remove('hidden');
        renderCategories(data.cargo.categories);
    } else {
        document.getElementById('search-bar-from').classList.add('hidden');
        renderCategories(data.special.categories);
    }

    // Reset selection and button
    currentCategory = null;
    document.getElementById('btn-next').disabled = true;
}

function showStep(stepId) {
    ['step-mode', 'step-category', 'step-machine', 'step-form', 'step-search', 'step-found'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(`step-${stepId}`).classList.remove('hidden');

    // Reset specific UI elements if going back to start
    if (stepId === 'mode') {
        document.getElementById('search-bar-from').classList.add('hidden');
        document.getElementById('address-to').innerText = 'Куда подать технику?';
    }
}

function renderCategories(list) {
    const container = document.getElementById('category-slider');
    container.innerHTML = list.map((cat, index) => `
        <div class="equipment-item" onclick="selectCategory('${cat.id}', this)">
            <div style="font-size:32px;">${cat.icon}</div> 
            <div class="equipment-name">${cat.name}</div>
        </div>
    `).join('');
}

function selectCategory(id, el) {
    currentCategory = id;
    document.querySelectorAll('#category-slider .equipment-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    // Enable Next button
    document.getElementById('btn-next').disabled = false;
}

function showMachines(catId) {
    document.getElementById('step-category').classList.add('hidden');
    document.getElementById('step-machine').classList.remove('hidden');

    // Reset machine button
    document.getElementById('btn-to-form').disabled = true;

    const list = data[currentMode].machines[catId] || [];
    const container = document.getElementById('machine-slider');

    container.innerHTML = list.map((m, index) => `
        <div class="equipment-item" onclick="selectMachine(this)">
            <div style="font-size:32px;">${m.icon}</div> 
            <div class="equipment-name">${m.name}</div>
            <div class="equipment-price">${m.price}</div>
            ${m.dims ? `<div style="font-size:10px; color:#666">${m.dims}</div>` : ''}
        </div>
    `).join('');
}

function selectMachine(el) {
    document.querySelectorAll('#machine-slider .equipment-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    // Enable Form button
    document.getElementById('btn-to-form').disabled = false;
}

// Global exports
window.selectMode = selectMode;
window.showStep = showStep;
window.selectCategory = selectCategory;
window.selectMachine = selectMachine;
window.selectPayment = selectPayment;
window.cancelSearch = cancelSearch;
window.locateUser = locateUser;
