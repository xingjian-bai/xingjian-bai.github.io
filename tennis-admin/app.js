/**
 * Tennis Court Booking Admin Dashboard
 * Modern UI with Calendar, History, and Stats
 */

// ==================== Configuration ====================
const CONFIG = {
    GITHUB_OWNER: 'xingjian-bai',
    GITHUB_REPO: 'xingjian-bai.github.io',
    STATUS_FILE: 'tennis-admin/status.json',
    CONTROL_FILE: 'tennis-admin/control.json',
    REFRESH_INTERVAL: 5 * 60 * 1000,
    USERS: {
        'xbai02b': { name: 'Xingjian Bai', short: 'Xingjian', color: 'xbai' },
        'yangb': { name: 'Yang Liu', short: 'Yang', color: 'yang' },
        'zwang43b': { name: 'Zekai Wang', short: 'Zekai', color: 'zekai' }
    }
};

// ==================== State ====================
let state = {
    status: null,
    control: null,
    statusSha: null,
    controlSha: null,
    currentWeekOffset: 0
};

let pendingAction = null;
let refreshTimer = null;

// ==================== Utility Functions ====================
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function getWeekDates(offset = 0) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek + (offset * 7));

    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        dates.push(date);
    }
    return dates;
}

function isToday(date) {
    const today = new Date();
    return date.toDateString() === today.toDateString();
}

function getUserClass(userId) {
    return CONFIG.USERS[userId]?.color || 'xbai';
}

function getUserName(userId) {
    return CONFIG.USERS[userId]?.name || userId;
}

function getUserShortName(userId) {
    return CONFIG.USERS[userId]?.short || userId;
}

// ==================== GitHub API ====================
function getGitHubToken() {
    return localStorage.getItem('github_token');
}

function setGitHubToken(token) {
    localStorage.setItem('github_token', token);
}

async function fetchGitHubFile(path) {
    const url = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${path}`;
    const token = getGitHubToken();

    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const data = await response.json();
        return {
            content: JSON.parse(atob(data.content)),
            sha: data.sha
        };
    } catch (error) {
        console.error(`Error fetching ${path}:`, error);
        return null;
    }
}

async function updateGitHubFile(path, content, sha, message) {
    const token = getGitHubToken();
    if (!token) {
        showTokenModal();
        return false;
    }

    const url = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${path}`;

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                content: btoa(JSON.stringify(content, null, 2)),
                sha: sha
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update file');
        }
        return true;
    } catch (error) {
        console.error(`Error updating ${path}:`, error);
        alert(`Error: ${error.message}`);
        return false;
    }
}

// ==================== Data Loading ====================
async function loadData() {
    const [statusResult, controlResult] = await Promise.all([
        fetchGitHubFile(CONFIG.STATUS_FILE),
        fetchGitHubFile(CONFIG.CONTROL_FILE)
    ]);

    if (statusResult) {
        state.status = statusResult.content;
        state.statusSha = statusResult.sha;
    }

    if (controlResult) {
        state.control = controlResult.content;
        state.controlSha = controlResult.sha;
    } else {
        state.control = { users: {}, cancellations: {} };
        Object.keys(CONFIG.USERS).forEach(id => {
            state.control.users[id] = { paused: false };
        });
    }
}

async function refreshData() {
    const refreshBtn = document.querySelector('.fa-sync-alt');
    if (refreshBtn) refreshBtn.classList.add('fa-spin');

    await loadData();
    renderAll();

    if (refreshBtn) refreshBtn.classList.remove('fa-spin');
    document.getElementById('last-sync').textContent = `Last: ${formatTime(new Date())}`;
}

// ==================== Rendering ====================
function renderAll() {
    renderStats();
    renderUserCards();
    renderUpcomingReservations();
    renderMiniCalendar();
    renderRecentActivity();
    renderFullCalendar();
    renderHistory();
    updateCurrentDate();
}

function updateCurrentDate() {
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }
}

function renderStats() {
    if (!state.status) return;

    const bookings = state.status.bookings || [];
    const reservations = state.status.reservations || [];

    // Upcoming count
    document.getElementById('stat-upcoming').textContent = reservations.length;

    // This week's successful bookings
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisWeekSuccess = bookings.filter(b => {
        const bookingTime = new Date(b.timestamp);
        return b.success && bookingTime >= weekAgo;
    }).length;
    document.getElementById('stat-success').textContent = thisWeekSuccess;

    // Success rate
    const recentBookings = bookings.slice(0, 50);
    const successCount = recentBookings.filter(b => b.success).length;
    const rate = recentBookings.length > 0 ? Math.round((successCount / recentBookings.length) * 100) : 0;
    document.getElementById('stat-rate').textContent = `${rate}%`;

    // Active bots
    const scriptStatus = state.status.script_status || {};
    const activeCount = Object.values(scriptStatus).filter(s => s.running && !s.paused).length;
    const totalCount = Object.keys(CONFIG.USERS).length;
    document.getElementById('stat-active').textContent = `${activeCount}/${totalCount}`;
}

function renderUserCards() {
    const container = document.getElementById('user-cards');
    if (!container) return;

    const scriptStatus = state.status?.script_status || {};
    const controlUsers = state.control?.users || {};

    let html = '';
    Object.entries(CONFIG.USERS).forEach(([userId, userInfo]) => {
        const status = scriptStatus[userId] || {};
        const control = controlUsers[userId] || {};
        const isPaused = control.paused || false;
        const isRunning = status.running && !isPaused;

        html += `
            <div class="user-card ${userInfo.color} ${isPaused ? 'paused' : ''}">
                <div class="user-card-info">
                    <span class="user-card-name">${userInfo.name}</span>
                    <span class="user-card-status">
                        <span class="dot ${isRunning ? 'running' : 'paused'}"></span>
                        ${isPaused ? 'Paused' : (status.running ? 'Running' : 'Stopped')}
                    </span>
                </div>
                <button class="btn btn-sm ${isPaused ? 'btn-primary' : 'btn-secondary'}"
                        onclick="togglePause('${userId}', ${!isPaused})">
                    <i class="fas fa-${isPaused ? 'play' : 'pause'}"></i>
                    ${isPaused ? 'Resume' : 'Pause'}
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderUpcomingReservations() {
    const container = document.getElementById('upcoming-reservations');
    if (!container) return;

    const reservations = state.status?.reservations || [];

    if (reservations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar-times"></i>
                <p>No upcoming reservations</p>
            </div>
        `;
        return;
    }

    let html = '';
    reservations.slice(0, 5).forEach(res => {
        const userClass = getUserClass(res.user);
        html += `
            <div class="reservation-item">
                <div class="reservation-main">
                    <span class="reservation-date">${res.weekday || ''} ${res.date} at ${res.time}</span>
                    <div class="reservation-details">
                        <span>${res.court || 'Court TBD'}</span>
                        <span class="reservation-user">
                            <span class="user-dot ${userClass}"></span>
                            ${getUserShortName(res.user)}
                        </span>
                    </div>
                </div>
                <button class="btn btn-sm btn-danger" onclick="requestCancel('${res.user}', '${res.reservation_id}', '${res.date} ${res.time}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderMiniCalendar() {
    const container = document.getElementById('mini-calendar');
    if (!container) return;

    const weekDates = getWeekDates(0);
    const bookings = state.status?.bookings || [];
    const reservations = state.status?.reservations || [];

    // Group bookings by date
    const bookingsByDate = {};
    [...bookings.filter(b => b.success), ...reservations].forEach(b => {
        const date = b.booking_date || b.date;
        if (!bookingsByDate[date]) bookingsByDate[date] = [];
        bookingsByDate[date].push(b);
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let html = '';
    weekDates.forEach(date => {
        const dateStr = date.toISOString().split('T')[0];
        const dayBookings = bookingsByDate[dateStr] || [];
        const todayClass = isToday(date) ? 'today' : '';

        html += `
            <div class="mini-cal-day ${todayClass}">
                <div class="day-name">${dayNames[date.getDay()]}</div>
                <div class="day-num">${date.getDate()}</div>
                <div class="day-bookings">
                    ${dayBookings.slice(0, 3).map(b => {
                        const userClass = getUserClass(b.user);
                        return `<span class="booking-dot" style="background: var(--user-${userClass})"></span>`;
                    }).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderRecentActivity() {
    const container = document.getElementById('recent-activity');
    if (!container) return;

    const bookings = state.status?.bookings || [];

    if (bookings.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No recent activity</p></div>';
        return;
    }

    let html = '';
    bookings.slice(0, 10).forEach(b => {
        const iconClass = b.success ? 'success' : 'failed';
        const icon = b.success ? 'check' : 'times';
        const userName = getUserShortName(b.user);
        const action = b.success ? 'Booked' : 'Failed to book';

        html += `
            <div class="activity-item">
                <div class="activity-icon ${iconClass}">
                    <i class="fas fa-${icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-text">
                        <strong>${userName}</strong> ${action} ${b.booking_date} ${b.booking_hour}:00
                    </div>
                    <div class="activity-time">${formatTime(b.timestamp)}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderFullCalendar() {
    const container = document.getElementById('full-calendar');
    if (!container) return;

    const weekDates = getWeekDates(state.currentWeekOffset);
    const bookings = state.status?.bookings || [];
    const reservations = state.status?.reservations || [];

    // Update week title
    const weekTitle = document.getElementById('calendar-week-title');
    if (weekTitle) {
        const startDate = weekDates[0];
        const endDate = weekDates[6];
        weekTitle.textContent = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    // Group bookings by date and hour
    const bookingMap = {};
    [...bookings.filter(b => b.success), ...reservations].forEach(b => {
        const date = b.booking_date || b.date;
        const hour = b.booking_hour || parseInt(b.time);
        const key = `${date}-${hour}`;
        if (!bookingMap[key]) bookingMap[key] = [];
        bookingMap[key].push(b);
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

    // Header row
    let html = '<div class="cal-header"></div>';
    weekDates.forEach(date => {
        const todayClass = isToday(date) ? 'today' : '';
        html += `<div class="cal-header ${todayClass}">${dayNames[date.getDay()]}<br>${date.getDate()}</div>`;
    });

    // Time rows
    hours.forEach(hour => {
        html += `<div class="cal-time">${hour}:00</div>`;

        weekDates.forEach(date => {
            const dateStr = date.toISOString().split('T')[0];
            const key = `${dateStr}-${hour}`;
            const cellBookings = bookingMap[key] || [];

            html += `<div class="cal-cell">`;
            cellBookings.forEach(b => {
                const userClass = getUserClass(b.user);
                html += `<div class="cal-booking ${userClass}">${getUserShortName(b.user)}</div>`;
            });
            html += `</div>`;
        });
    });

    container.innerHTML = html;
}

function changeWeek(offset) {
    state.currentWeekOffset += offset;
    renderFullCalendar();
}

function renderHistory() {
    const bookings = state.status?.bookings || [];

    // Stats
    const total = bookings.length;
    const success = bookings.filter(b => b.success).length;
    const failed = total - success;

    document.getElementById('history-total').textContent = total;
    document.getElementById('history-success').textContent = success;
    document.getElementById('history-failed').textContent = failed;

    // Heatmap
    renderHeatmap(bookings);

    // Table
    renderHistoryTable(bookings);
}

function renderHeatmap(bookings) {
    const container = document.getElementById('booking-heatmap');
    if (!container) return;

    const hourCounts = {};
    for (let h = 13; h <= 22; h++) hourCounts[h] = 0;

    bookings.filter(b => b.success).forEach(b => {
        const hour = b.booking_hour;
        if (hourCounts[hour] !== undefined) hourCounts[hour]++;
    });

    const maxCount = Math.max(...Object.values(hourCounts), 1);

    let html = '';
    for (let h = 13; h <= 22; h++) {
        const count = hourCounts[h];
        const level = count === 0 ? 0 : Math.ceil((count / maxCount) * 5);
        html += `<div class="heatmap-cell level-${level}" title="${h}:00 - ${count} bookings">${h}:00</div>`;
    }

    container.innerHTML = html;
}

function renderHistoryTable(bookings) {
    const container = document.getElementById('history-table-body');
    if (!container) return;

    const userFilter = document.getElementById('history-user-filter')?.value || 'all';
    const statusFilter = document.getElementById('history-status-filter')?.value || 'all';

    let filtered = bookings;
    if (userFilter !== 'all') {
        filtered = filtered.filter(b => b.user === userFilter);
    }
    if (statusFilter === 'success') {
        filtered = filtered.filter(b => b.success);
    } else if (statusFilter === 'failed') {
        filtered = filtered.filter(b => !b.success);
    }

    let html = '';
    filtered.slice(0, 50).forEach(b => {
        const statusClass = b.success ? 'success' : 'failed';
        const statusText = b.success ? 'Success' : 'Failed';
        const courtNum = b.court_id ? `Court ${{'45':1,'46':2,'47':3,'48':4}[b.court_id] || b.court_id}` : '-';

        html += `
            <tr>
                <td>${formatTime(b.timestamp)}</td>
                <td>${getUserShortName(b.user)}</td>
                <td>${b.booking_date}</td>
                <td>${b.booking_hour}:00</td>
                <td>${courtNum}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    });

    container.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;">No matching records</td></tr>';
}

function filterHistory() {
    const bookings = state.status?.bookings || [];
    renderHistoryTable(bookings);
}

// ==================== Actions ====================
async function togglePause(userId, pause) {
    const action = pause ? 'pause' : 'resume';
    const userName = getUserName(userId);

    showConfirmModal(
        `${pause ? 'Pause' : 'Resume'} ${userName}?`,
        `Are you sure you want to ${action} automatic booking for ${userName}?`,
        async () => {
            if (!state.control.users[userId]) {
                state.control.users[userId] = {};
            }
            state.control.users[userId].paused = pause;
            state.control.last_updated = new Date().toISOString();

            const success = await updateGitHubFile(
                CONFIG.CONTROL_FILE,
                state.control,
                state.controlSha,
                `${action} booking for ${userId}`
            );

            if (success) {
                await refreshData();
            }
        }
    );
}

async function requestCancel(userId, reservationId, description) {
    showConfirmModal(
        'Cancel Reservation?',
        `Are you sure you want to cancel: ${description}?`,
        async () => {
            if (!state.control.cancellations[userId]) {
                state.control.cancellations[userId] = [];
            }
            state.control.cancellations[userId].push({
                reservation_id: reservationId,
                description: description,
                requested_at: new Date().toISOString()
            });
            state.control.last_updated = new Date().toISOString();

            const success = await updateGitHubFile(
                CONFIG.CONTROL_FILE,
                state.control,
                state.controlSha,
                `Request cancel: ${description}`
            );

            if (success) {
                alert('Cancellation request submitted.');
                await refreshData();
            }
        }
    );
}

// ==================== Navigation ====================
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;

            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`page-${page}`).classList.add('active');

            document.getElementById('page-title').textContent =
                page.charAt(0).toUpperCase() + page.slice(1);
        });
    });
}

// ==================== Modals ====================
function showTokenModal() {
    document.getElementById('token-modal').classList.add('active');
    document.getElementById('github-token-input').value = getGitHubToken() || '';
}

function closeTokenModal() {
    document.getElementById('token-modal').classList.remove('active');
}

function saveToken() {
    const token = document.getElementById('github-token-input').value.trim();
    if (token) {
        setGitHubToken(token);
        closeTokenModal();
        refreshData();
    }
}

function saveTokenFromSettings() {
    const token = document.getElementById('settings-token').value.trim();
    if (token) {
        setGitHubToken(token);
        alert('Token saved!');
    }
}

function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    pendingAction = onConfirm;
    document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
    pendingAction = null;
}

function confirmAction() {
    if (pendingAction) pendingAction();
    closeConfirmModal();
}

// ==================== Settings ====================
function updateRefreshInterval() {
    const interval = parseInt(document.getElementById('refresh-interval').value);

    if (refreshTimer) clearInterval(refreshTimer);

    if (interval > 0) {
        refreshTimer = setInterval(refreshData, interval);
    }
}

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    refreshData();

    // Start auto-refresh
    refreshTimer = setInterval(refreshData, CONFIG.REFRESH_INTERVAL);

    // Load saved token to settings
    const savedToken = getGitHubToken();
    if (savedToken) {
        document.getElementById('settings-token').value = savedToken;
    }
});
