/**
 * Driver App Logic
 */
const state = {
    isOnline: false,
    earnings: 12500,
    activity: 95
};

const dom = {
    offlineScreen: document.getElementById('offline-screen'),
    onlineScreen: document.getElementById('online-screen')
};

let map = null;
let vehicleMarker = null;

function init() {
    render();
}

function toggleStatus() {
    state.isOnline = !state.isOnline;
    render();

    if (state.isOnline) {
        setTimeout(initMap, 100);
        // Simulate Incoming Order after 3 seconds
        simulateIncomingOrder();
    } else {
        // Reset if going offline
        stopSimulation();
    }
}
window.toggleStatus = toggleStatus;

let orderTimeout;
let audio = new Audio('https://zvukipro.com/uploads/files/2021-02/1612637257_iphone_notification.mp3'); // Notification sound placeholder

function simulateIncomingOrder() {
    orderTimeout = setTimeout(() => {
        document.getElementById('order-offer').classList.remove('hidden');
        // Play Sound
        try { audio.play().catch(e => console.log('Audio blocked', e)); } catch (e) { }
        // Vibrate
        if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
    }, 3000); // 3 seconds delay
}

function stopSimulation() {
    clearTimeout(orderTimeout);
    document.getElementById('order-offer').classList.add('hidden');
}

function acceptOrder() {
    document.getElementById('order-offer').classList.add('hidden');
    alert('Заказ принят! Прокладываем маршрут...');
    // Here we would switch to "On Order" mode (route display)
}
window.acceptOrder = acceptOrder;

function skipOrder() {
    document.getElementById('order-offer').classList.add('hidden');
    // Maybe schedule another one?
    setTimeout(simulateIncomingOrder, 5000);
}
window.skipOrder = skipOrder;

function render() {
    if (state.isOnline) {
        dom.offlineScreen.classList.add('hidden');
        dom.onlineScreen.classList.remove('hidden');
    } else {
        dom.offlineScreen.classList.remove('hidden');
        dom.onlineScreen.classList.add('hidden');
    }
}

function initMap() {
    if (map) {
        map.invalidateSize(); // Fix gray tiles issue
        return;
    }

    // Default to Tashkent Center
    const defaultLat = 41.2995;
    const defaultLng = 69.2401;

    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([defaultLat, defaultLng], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);

    // Add vehicle marker
    const vehicleIcon = L.divIcon({
        className: 'vehicle-marker-icon',
        html: '<div style="font-size:30px; line-height:30px;">🚜</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    vehicleMarker = L.marker([defaultLat, defaultLng], { icon: vehicleIcon }).addTo(map);

    // Try to get real location
    locateUser();
}

let clientMarker = null;
let routeLayer = null;

function acceptOrder() {
    stopSimulation(); // Stop sound/vibrate
    document.getElementById('order-offer').classList.add('hidden');
    document.getElementById('active-order-panel').classList.remove('hidden');

    // Simulate Client Location (relative to Map center or Driver)
    const center = map.getCenter();
    const clientLat = center.lat + 0.01; // Slightly North
    const clientLng = center.lng + 0.01; // Slightly East

    // Add Client Marker
    const clientIcon = L.divIcon({
        html: '<div style="font-size:30px;">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });

    if (clientMarker) map.removeLayer(clientMarker);
    clientMarker = L.marker([clientLat, clientLng], { icon: clientIcon }).addTo(map);

    // Draw Route
    drawRoute([center.lat, center.lng], [clientLat, clientLng]);
}
window.acceptOrder = acceptOrder;

function skipOrder() {
    document.getElementById('order-offer').classList.add('hidden');
    // Maybe schedule another one?
    setTimeout(simulateIncomingOrder, 5000);
}
window.skipOrder = skipOrder;

function completeOrder() {
    if (!confirm('Завершить заказ?')) return;

    alert('Заказ выполнен! +3000 ₽');

    // Reset UI
    document.getElementById('active-order-panel').classList.add('hidden');
    if (clientMarker) map.removeLayer(clientMarker);
    if (routeLayer) map.removeLayer(routeLayer);

    // Update Balance (Simulated)
    state.earnings += 3000;
    document.getElementById('earnings-val').innerText = state.earnings + ' ₽';

    // Ready for next
    map.setZoom(15);
    simulateIncomingOrder(); // Loop
}
window.completeOrder = completeOrder;

async function drawRoute(start, end) {
    try {
        const query = `${start[1]},${start[0]};${end[1]},${end[0]}`;
        const url = `https://router.project-osrm.org/route/v1/driving/${query}?overview=full&geometries=geojson`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]); // Swap to LatLng

            if (routeLayer) map.removeLayer(routeLayer);

            routeLayer = L.polyline(coordinates, {
                color: '#2196F3', // Blue route
                weight: 5,
                opacity: 0.8,
                lineJoin: 'round'
            }).addTo(map);

            // Zoom to fit route
            const bounds = L.latLngBounds(coordinates);
            map.fitBounds(bounds, { padding: [50, 50] });

            // Update distance info if needed
            const distKm = (route.distance / 1000).toFixed(1);
            const durMin = Math.round(route.duration / 60);
            document.getElementById('nav-dist').innerText = `${distKm} км • ${durMin} мин`;
        }
    } catch (e) {
        console.error("Routing error:", e);
    }
}

function locateUser() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (!map || !vehicleMarker) return;
                const { latitude, longitude } = position.coords;
                const userLatLng = [latitude, longitude];

                map.setView(userLatLng, 16);
                vehicleMarker.setLatLng(userLatLng);
            },
            (error) => {
                console.warn("Geolocation error:", error);
                // Keep default Tashkent location
            },
            { enableHighAccuracy: true }
        );
    }
}

// Start
init();
