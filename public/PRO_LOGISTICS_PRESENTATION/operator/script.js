/**
 * Operator Logic
 */

const state = {
    fleet: [
        { id: 1, type: 'Excavator', name: 'JCB 3CX', plate: 'A 123 AA 777', status: 'Free', ownership: 'own', priceCost: 3000, priceType: 'hour' },
        { id: 2, type: 'Crane', name: 'Ivanov 25t', plate: 'B 456 BB 777', status: 'Working', ownership: 'partner', partner: 'StroyMash LLC', priceCost: 2500, priceType: 'hour' },
        { id: 3, type: 'Excavator', name: 'CAT 320', plate: 'E 001 KX 777', status: 'Free', ownership: 'own', priceCost: 3500, priceType: 'hour' },
        { id: 4, type: 'Truck', name: 'KAMAZ', plate: 'K 111 MM 777', status: 'Free', ownership: 'own', priceCost: 8000, priceType: 'trip' }
    ],
    categories: [
        { id: 'Excavator', name: 'Экскаватор', icon: '🚜' },
        { id: 'Crane', name: 'Автокран', icon: '🏗️' },
        { id: 'Truck', name: 'Самосвал', icon: '🚛' }
    ],
    expandedGroups: { 'Excavator': true },
    currentTab: 'garage'
};

function init() {
    renderViews();

    document.getElementById('add-btn').addEventListener('click', () => {
        addMachine();
        // Hide form after add
        document.getElementById('add-form-container').classList.add('hidden');
    });
}

function switchTab(tab) {
    state.currentTab = tab;

    // Hide all views
    document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${tab}`).classList.remove('hidden');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    // Find the clicked one based on onclick (simple lookup via text or index, but let's re-render nav or just toggle classes)

    // Re-rendering views if needed
    if (tab === 'garage') renderGarage();
    if (tab === 'subcontractor') renderSubcontractors();
    if (tab === 'categories') renderCategories();

    // Update active class on nav items manually or by re-querying
    const navs = document.querySelectorAll('.nav-item');
    if (tab === 'garage') navs[0].classList.add('active');
    if (tab === 'subcontractor') navs[1].classList.add('active');
    if (tab === 'categories') navs[2].classList.add('active');
    if (tab === 'profile') navs[3].classList.add('active');

    // Refresh icons
    if (window.lucide) lucide.createIcons();
}
window.switchTab = switchTab;

function renderViews() {
    renderGarage();
    renderSubcontractors();
    renderCategories();     // New
    updateTypeSelect();     // Ensure dropdown is up to date
    if (window.lucide) lucide.createIcons();
}

// --- Garage View (Own) ---
function renderGarage() {
    const list = document.getElementById('garage-list');
    const ownFleet = state.fleet.filter(m => m.ownership === 'own');

    // Reuse renderGroupedList logic
    list.innerHTML = renderGroupedList(ownFleet, 'garage');
}

// --- Subcontractor View (Partner -> Type -> List) ---
function renderSubcontractors() {
    const list = document.getElementById('subcontractor-list');
    const partnerFleet = state.fleet.filter(m => m.ownership === 'partner');

    // Group by Partner
    const byPartner = partnerFleet.reduce((acc, m) => {
        const p = m.partner || 'Unknown';
        if (!acc[p]) acc[p] = [];
        acc[p].push(m);
        return acc;
    }, {});

    let html = '';

    if (Object.keys(byPartner).length === 0) {
        html = '<div style="text-align:center; padding:20px; color:#777;">Нет субподрядчиков</div>';
    } else {
        for (const [partner, machines] of Object.entries(byPartner)) {
            html += `
                <div class="partner-card">
                    <div class="partner-header">
                        ${partner}
                        <span style="font-size:12px; font-weight:normal; color:#777;">${machines.length} ед.</span>
                    </div>
                    <div class="partner-content">
                        ${renderGroupedList(machines, `sub_${partner.replace(/\s/g, '')}`)}
                    </div>
                </div>
            `;
        }
    }

    list.innerHTML = html;
}

// --- Categories View ---
function renderCategories() {
    const list = document.getElementById('categories-list');
    if (!list) return;

    let html = '';
    state.categories.forEach(cat => {
        html += `
            <div class="fleet-item" style="justify-content: space-between;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="font-size:24px;">${cat.icon || '📦'}</div>
                    <div style="font-weight:600;">${cat.name}</div>
                </div>
                <button onclick="removeCategory('${cat.id}')" style="color:red; border:none; background:none; font-size:18px;">&times;</button>
            </div>
        `;
    });
    list.innerHTML = html;
}

// --- Custom Dropdown Logic ---
let selectedEmoji = '🚜';

function toggleEmojiDropdown() {
    const options = document.getElementById('emoji-options');
    if (options) options.classList.toggle('hidden');
}
window.toggleEmojiDropdown = toggleEmojiDropdown;

function selectEmoji(emoji) {
    selectedEmoji = emoji;
    const trigger = document.getElementById('emoji-trigger');
    if (trigger) trigger.textContent = emoji;

    // Close dropdown
    document.getElementById('emoji-options').classList.add('hidden');
}
window.selectEmoji = selectEmoji;

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('emoji-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        document.getElementById('emoji-options').classList.add('hidden');
    }
});

function addCategory() {
    const name = document.getElementById('new-cat-name').value;
    const icon = selectedEmoji; // Use variable from custom dropdown

    if (!name) return alert('Введите название');

    const id = name;
    state.categories.push({ id, name, icon });

    renderViews();
    document.getElementById('new-cat-name').value = '';

    // Reset defaults
    selectEmoji('🚜');
}
window.addCategory = addCategory;

function removeCategory(id) {
    if (!confirm('Удалить категорию?')) return;
    state.categories = state.categories.filter(c => c.id !== id);
    renderViews();
}
window.removeCategory = removeCategory;

function updateTypeSelect() {
    const select = document.getElementById('new-machine-type');
    if (!select) return;
    const currentVal = select.value;

    let html = '';
    state.categories.forEach(cat => {
        html += `<option value="${cat.id}">${cat.name}</option>`;
    });
    select.innerHTML = html;

    if (currentVal) select.value = currentVal; // Try to preserve selection
}

// Helper: Renders filtering list by Type (Accordion style)
function renderGroupedList(fleet, contextPrefix) {
    const groups = fleet.reduce((acc, m) => {
        if (!acc[m.type]) acc[m.type] = [];
        acc[m.type].push(m);
        return acc;
    }, {});

    let html = '';

    for (const [type, machines] of Object.entries(groups)) {
        const groupId = `${contextPrefix}_${type}`;
        // Default to expanded if not set, or check state
        const isExpanded = state.expandedGroups[groupId] !== false; // Default true
        const arrow = isExpanded ? '▼' : '▶';

        html += `
            <div class="sub-group">
                <div class="sub-group-header" onclick="toggleGroup('${groupId}')">
                    <span>${translateType(type)}</span>
                    <span style="font-size:12px; color:#555;">${machines.length}</span>
                    <span style="margin-left:auto; color:#999;">${arrow}</span>
                </div>
                ${isExpanded ? `
                <div class="group-items">
                    ${machines.map(renderMachineItem).join('')}
                </div>
                ` : ''}
            </div>
        `;
    }
    return html;
}

function toggleGroup(groupId) {
    if (state.expandedGroups[groupId] === false) {
        state.expandedGroups[groupId] = true;
    } else {
        state.expandedGroups[groupId] = false;
    }
    renderViews();
}
window.toggleGroup = toggleGroup;

function openAddForm(mode) {
    const container = document.getElementById('add-form-container');
    const backdrop = document.getElementById('modal-backdrop');

    // Show Modal
    container.classList.add('active');
    if (backdrop) backdrop.classList.add('active');

    // Explicitly show/hide ownership toggle based on mode
    const ownershipGroup = document.querySelector('.ownership-toggle').closest('.form-group');

    if (mode === 'garage') {
        // Set to Own
        document.querySelector('input[name="ownership"][value="own"]').checked = true;
        togglePartnerField();
        // Hide ownership toggle to simplify
        if (ownershipGroup) ownershipGroup.classList.add('hidden');
    } else if (mode === 'subcontractor') {
        // Set to Partner
        document.querySelector('input[name="ownership"][value="partner"]').checked = true;
        togglePartnerField();
        if (ownershipGroup) ownershipGroup.classList.add('hidden');
    } else {
        // Default / Safe mode
        if (ownershipGroup) ownershipGroup.classList.remove('hidden');
    }
}
window.openAddForm = openAddForm;

function closeAddForm() {
    const container = document.getElementById('add-form-container');
    const backdrop = document.getElementById('modal-backdrop');

    container.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');

    // Restore toggle visibility
    const ownershipGroup = document.querySelector('.ownership-toggle').closest('.form-group');
    if (ownershipGroup) ownershipGroup.classList.remove('hidden');
}
window.closeAddForm = closeAddForm;

function togglePartnerField() {
    const isPartner = document.querySelector('input[name="ownership"][value="partner"]').checked;
    const field = document.getElementById('partner-field-group');
    field.style.display = isPartner ? 'block' : 'none';
}
window.togglePartnerField = togglePartnerField;

function getIcon(typeId) {
    const cat = state.categories.find(c => c.id === typeId);
    return cat ? cat.icon : '❓';
}

function translateStatus(status) {
    return status === 'Free' ? 'Свободен' : 'В работе';
}

function translateType(typeId) {
    const cat = state.categories.find(c => c.id === typeId);
    return cat ? cat.name : typeId;
}

function toggleDeliveryField() {
    const isDelivery = document.getElementById('delivery-check').checked;
    const field = document.getElementById('delivery-field-group');

    if (isDelivery) {
        field.classList.remove('hidden');
    } else {
        field.classList.add('hidden');
    }
}
window.toggleDeliveryField = toggleDeliveryField;

function updatePricingFields() {
    const type = document.getElementById('pricing-type').value;
    const hourGroup = document.getElementById('price-hour-group');
    const tripGroup = document.getElementById('price-trip-group');

    if (type === 'hour') {
        hourGroup.classList.remove('hidden');
        tripGroup.classList.add('hidden');
    } else if (type === 'trip') {
        hourGroup.classList.add('hidden');
        tripGroup.classList.remove('hidden');
    } else {
        // both
        hourGroup.classList.remove('hidden');
        tripGroup.classList.remove('hidden');
    }
}
window.updatePricingFields = updatePricingFields;

function renderMachineItem(machine) {
    let pricingHtml = '';
    if (machine.priceType === 'hour') {
        pricingHtml = `<b>${machine.priceHour || machine.priceCost} сум</b> / час (мин. ${machine.minHours || 1} ч)`;
    } else if (machine.priceType === 'trip') {
        pricingHtml = `<b>${machine.priceTrip || machine.priceCost} сум</b> / рейс`;
    } else if (machine.priceType === 'both') {
        pricingHtml = `<b>${machine.priceHour} сум</b>/час | <b>${machine.priceTrip} сум</b>/рейс`;
    }

    return `
        <div class="fleet-item">
            <div class="fleet-icon">${getIcon(machine.type)}</div>
            <div class="fleet-info">
                <div class="fleet-name">
                    ${machine.name} 
                </div>
                <div class="fleet-plate">${machine.plate}</div>
                <div style="font-size:12px; color:#333; margin-top:2px;">
                    ${pricingHtml}
                    ${machine.delivery ? ` (+доставка ${machine.delivery.cost} сум)` : ''}
                </div>
            </div>
            <div class="fleet-status ${machine.status.toLowerCase()}">
                ${translateStatus(machine.status)}
            </div>
        </div>
    `;
}

function addMachine() {
    const type = document.getElementById('new-machine-type').value;
    const name = document.getElementById('new-machine-name').value;
    const plate = document.getElementById('new-machine-plate').value;

    const ownership = document.querySelector('input[name="ownership"]:checked').value;
    const partner = document.getElementById('partner-name').value;

    // Pricing Fields - Updated
    const priceType = document.getElementById('pricing-type').value;
    const priceHour = document.getElementById('price-hour').value;
    const priceTrip = document.getElementById('price-trip').value;
    const minHours = document.getElementById('min-hours').value;

    const hasDelivery = document.getElementById('delivery-check').checked;
    const deliveryCost = document.getElementById('delivery-cost').value;

    // Validation for min hours
    if ((priceType === 'hour' || priceType === 'both') && parseFloat(minHours) < 1) {
        alert('Минимальное время заказа должно быть не менее 1 маш/сач');
        return;
    }

    if (name && plate) {
        if (ownership === 'partner' && !partner) {
            alert('Укажите название партнера');
            return;
        }

        state.fleet.push({
            id: Date.now(),
            type, name, plate,
            status: 'Free',
            ownership,
            partner: ownership === 'partner' ? partner : null,
            priceType,
            priceHour: (priceType === 'hour' || priceType === 'both') ? priceHour : null,
            priceTrip: (priceType === 'trip' || priceType === 'both') ? priceTrip : null,
            minHours: (priceType === 'hour' || priceType === 'both') ? minHours : null,
            delivery: hasDelivery ? { cost: deliveryCost } : null
        });

        renderViews();

        // Clear inputs
        document.getElementById('new-machine-name').value = '';
        document.getElementById('new-machine-plate').value = '';
        document.getElementById('price-hour').value = '';
        document.getElementById('price-trip').value = '';
        document.getElementById('min-hours').value = '3';

        if (ownership === 'partner') document.getElementById('partner-name').value = '';

        closeAddForm();

    } else {
        alert('Заполните все данные');
    }
}

init();
togglePartnerField(); // Init state
toggleDeliveryField(); // Init state
