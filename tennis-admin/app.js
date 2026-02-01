/**
 * TENNIS.SYS // Command Center
 * Futuristic Cyberpunk Dashboard
 */

// ==================== Configuration ====================
const CONFIG = {
    GITHUB_OWNER: 'xingjian-bai',
    GITHUB_REPO: 'xingjian-bai.github.io',
    STATUS_FILE: 'tennis-admin/status.json',
    CONTROL_FILE: 'tennis-admin/control.json',
    REFRESH_INTERVAL: 5 * 60 * 1000,
    USERS: {
        'xbai02b': { name: 'Xingjian Bai', short: 'XB', color: 'xbai', initial: 'X' },
        'yangb': { name: 'Yang Liu', short: 'YL', color: 'yang', initial: 'Y' },
        'zwang43b': { name: 'Zekai Wang', short: 'ZW', color: 'zekai', initial: 'Z' }
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
let terminalHistory = [];

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initNavigation();
    initClock();
    initTerminal();
    refreshData();
    startAutoRefresh();
});

// ==================== Particle Effects ====================
function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;

    const particleCount = 50;
    for (let i = 0; i < particleCount; i++) {
        createParticle(container, i);
    }
}

function createParticle(container, index) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDelay = `${(index / 50) * 15}s`;
    particle.style.opacity = Math.random() * 0.5 + 0.2;

    const colors = ['#00f0ff', '#ff00aa', '#00ff88'];
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.boxShadow = `0 0 6px ${particle.style.background}`;

    container.appendChild(particle);
}

// ==================== Clock ====================
function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const dateEl = document.getElementById('current-date');
    const timeEl = document.getElementById('current-time');

    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        }).toUpperCase();
    }
    if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }
}

// ==================== Navigation ====================
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            switchPage(page);
        });
    });
}

function switchPage(pageName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    // Update title
    const titleText = document.querySelector('.title-text');
    if (titleText) {
        titleText.textContent = pageName.toUpperCase();
    }

    // Special handling for terminal page
    if (pageName === 'terminal') {
        runSystemStatus();
    }
}

// ==================== Terminal ====================
function initTerminal() {
    const input = document.getElementById('terminal-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleTerminalInput(e);
            }
        });
    }
}

function handleTerminalInput(event) {
    if (event.key !== 'Enter') return;

    const input = document.getElementById('terminal-input');
    const command = input.value.trim();
    input.value = '';

    if (!command) return;

    terminalHistory.push(command);
    addTerminalLine(command, 'command');
    processCommand(command);
}

function addTerminalLine(text, type = 'output') {
    const terminal = document.getElementById('terminal-output');
    if (!terminal) return;

    const line = document.createElement('div');
    line.className = 'terminal-line';

    if (type === 'command') {
        line.innerHTML = `<span class="prompt">root@tennis.sys:~$</span> <span class="command">${escapeHtml(text)}</span>`;
    } else {
        line.innerHTML = `<span class="${type}">${text}</span>`;
    }

    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

function processCommand(cmd) {
    const parts = cmd.toLowerCase().split(' ');
    const command = parts[0];

    switch (command) {
        case 'help':
            addTerminalLine('Available commands:', 'info');
            addTerminalLine('  status          - Show system status', 'output');
            addTerminalLine('  reservations    - List all reservations', 'output');
            addTerminalLine('  users           - Show user status', 'output');
            addTerminalLine('  sync            - Force data sync', 'output');
            addTerminalLine('  clear           - Clear terminal', 'output');
            addTerminalLine('  about           - System information', 'output');
            break;

        case 'status':
        case 'system_status':
            runSystemStatus();
            break;

        case 'reservations':
        case 'ls':
            listReservations();
            break;

        case 'users':
            showUserStatus();
            break;

        case 'sync':
        case 'refresh':
            addTerminalLine('Initiating data sync...', 'info');
            refreshData().then(() => {
                addTerminalLine('Sync complete.', 'success');
            });
            break;

        case 'clear':
            const terminal = document.getElementById('terminal-output');
            if (terminal) terminal.innerHTML = '';
            break;

        case 'about':
            addTerminalLine('TENNIS.SYS v2.0.0-CYBER', 'info');
            addTerminalLine('MIT Recreation Court Booking System', 'output');
            addTerminalLine('Booking windows: 00:00 / 06:00 EST', 'output');
            addTerminalLine('Parallel threads: 3', 'output');
            break;

        case 'matrix':
            addTerminalLine('Wake up, Neo...', 'success');
            break;

        default:
            addTerminalLine(`Command not found: ${command}`, 'error');
            addTerminalLine('Type "help" for available commands', 'output');
    }
}

function runSystemStatus() {
    if (!state.status) {
        addTerminalLine('No data loaded. Running sync...', 'info');
        return;
    }

    const lastSync = state.status.last_sync ? new Date(state.status.last_sync).toLocaleString() : 'Unknown';
    const reservations = state.status.reservations || [];
    const scriptStatus = state.status.script_status || {};

    addTerminalLine('=== SYSTEM STATUS ===', 'info');
    addTerminalLine(`Last sync: ${lastSync}`, 'output');
    addTerminalLine(`Active reservations: ${reservations.length}`, 'output');

    let running = 0;
    Object.entries(scriptStatus).forEach(([user, status]) => {
        if (status.running) running++;
    });
    addTerminalLine(`Active bots: ${running}/3`, running === 3 ? 'success' : 'output');
    addTerminalLine('===================', 'info');
}

function listReservations() {
    if (!state.status || !state.status.reservations) {
        addTerminalLine('No reservations data available', 'error');
        return;
    }

    const reservations = state.status.reservations;
    addTerminalLine(`Found ${reservations.length} reservation(s):`, 'info');

    reservations.forEach((res, i) => {
        const user = CONFIG.USERS[res.user]?.short || res.user;
        addTerminalLine(`  [${i + 1}] ${res.date} ${res.time} - ${res.court} (${user})`, 'output');
    });
}

function showUserStatus() {
    if (!state.status || !state.status.script_status) {
        addTerminalLine('No user data available', 'error');
        return;
    }

    addTerminalLine('=== AGENT STATUS ===', 'info');
    Object.entries(state.status.script_status).forEach(([userId, status]) => {
        const user = CONFIG.USERS[userId];
        if (!user) return;

        const statusText = status.paused ? 'PAUSED' : (status.running ? 'RUNNING' : 'STOPPED');
        const statusClass = status.paused ? 'output' : (status.running ? 'success' : 'error');
        addTerminalLine(`  ${user.name}: ${statusText}`, statusClass);
    });
    addTerminalLine('====================', 'info');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

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
        console.error('Error fetching GitHub file:', error);
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
                message,
                content: btoa(JSON.stringify(content, null, 2)),
                sha
            })
        });

        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        return true;
    } catch (error) {
        console.error('Error updating GitHub file:', error);
        return false;
    }
}

// ==================== Data Loading ====================
async function refreshData() {
    updateSyncStatus('syncing');

    try {
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
        }

        renderDashboard();
        updateSyncStatus('synced');
        updateLastSync();

    } catch (error) {
        console.error('Error refreshing data:', error);
        updateSyncStatus('error');
    }
}

function updateSyncStatus(status) {
    const syncText = document.getElementById('sync-text');
    if (syncText) {
        const texts = { syncing: 'SYNCING...', synced: 'SYNCED', error: 'ERROR' };
        syncText.textContent = texts[status] || 'SYNCED';
    }
}

function updateLastSync() {
    const lastSync = document.getElementById('last-sync');
    if (lastSync) {
        lastSync.textContent = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    const interval = parseInt(localStorage.getItem('refresh_interval')) || CONFIG.REFRESH_INTERVAL;
    if (interval > 0) {
        refreshTimer = setInterval(refreshData, interval);
    }
}

function updateRefreshInterval() {
    const select = document.getElementById('refresh-interval');
    if (select) {
        localStorage.setItem('refresh_interval', select.value);
        startAutoRefresh();
    }
}

// ==================== Rendering ====================
function renderDashboard() {
    if (!state.status) return;

    renderStats();
    renderUpcomingReservations();
    renderUserCards();
    renderMiniCalendar();
    renderRecentActivity();
    renderFullCalendar();
    renderHistory();
}

function renderStats() {
    if (!state.status) return;

    const bookings = state.status.bookings || [];
    const reservations = state.status.reservations || [];
    const scriptStatus = state.status.script_status || {};

    // Upcoming count
    const upcomingEl = document.getElementById('stat-upcoming');
    if (upcomingEl) {
        upcomingEl.innerHTML = `<span class="value-num">${reservations.length}</span>`;
    }

    // This week's successful bookings
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisWeekSuccess = bookings.filter(b => {
        const bookingTime = new Date(b.timestamp);
        return b.success && bookingTime >= weekAgo;
    }).length;

    const successEl = document.getElementById('stat-success');
    if (successEl) {
        successEl.innerHTML = `<span class="value-num">${thisWeekSuccess}</span>`;
    }

    // Success rate
    const recentBookings = bookings.slice(0, 50);
    const successCount = recentBookings.filter(b => b.success).length;
    const rate = recentBookings.length > 0 ? Math.round((successCount / recentBookings.length) * 100) : 0;

    const rateEl = document.getElementById('stat-rate');
    if (rateEl) {
        rateEl.innerHTML = `<span class="value-num">${rate}</span><span class="value-unit">%</span>`;
    }

    // Active bots
    let activeCount = 0;
    Object.values(scriptStatus).forEach(status => {
        if (status.running && !status.paused) activeCount++;
    });

    const activeEl = document.getElementById('stat-active');
    if (activeEl) {
        activeEl.innerHTML = `<span class="value-num">${activeCount}</span><span class="value-unit">/3</span>`;
    }
}

function renderUpcomingReservations() {
    const container = document.getElementById('upcoming-reservations');
    if (!container) return;

    const reservations = state.status?.reservations || [];

    if (reservations.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-satellite"></i>
                <p>NO ACTIVE RESERVATIONS</p>
            </div>
        `;
        return;
    }

    let html = '';
    reservations.forEach(res => {
        const userClass = getUserClass(res.user);
        const userColor = userClass === 'xbai' ? '#00f0ff' : (userClass === 'yang' ? '#ff00aa' : '#00ff88');

        html += `
            <div class="reservation-item" style="--user-color: ${userColor}">
                <div class="reservation-main">
                    <span class="reservation-date">${res.weekday || ''} ${res.date} @ ${res.time}</span>
                    <div class="reservation-details">
                        <span>${res.court || 'Court TBD'}</span>
                        <span class="reservation-user">
                            <span class="user-dot ${userClass}"></span>
                            ${getUserShortName(res.user)}
                        </span>
                    </div>
                </div>
                <button class="btn-cyber btn-sm danger" onclick="requestCancel('${res.user}', '${res.reservation_id}', '${res.date} ${res.time}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderUserCards() {
    const container = document.getElementById('user-cards');
    if (!container) return;

    const scriptStatus = state.status?.script_status || {};

    let html = '';
    Object.entries(CONFIG.USERS).forEach(([userId, user]) => {
        const status = scriptStatus[userId] || {};
        const isRunning = status.running && !status.paused;
        const isPaused = status.paused;

        const statusClass = isPaused ? 'paused' : (isRunning ? 'running' : 'stopped');
        const statusText = isPaused ? 'PAUSED' : (isRunning ? 'RUNNING' : 'STOPPED');

        html += `
            <div class="user-card ${user.color}">
                <div class="user-info">
                    <div class="user-avatar">${user.initial}</div>
                    <div class="user-details">
                        <span class="user-name">${user.name}</span>
                        <span class="user-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                <div class="user-controls">
                    <button class="btn-icon ${isRunning ? 'active' : ''}" onclick="togglePause('${userId}')" title="${isPaused ? 'Resume' : 'Pause'}">
                        <i class="fas fa-${isPaused ? 'play' : 'pause'}"></i>
                    </button>
                </div>
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

    const bookingsByDate = {};
    [...bookings.filter(b => b.success), ...reservations].forEach(b => {
        const date = b.booking_date || b.date;
        if (!bookingsByDate[date]) bookingsByDate[date] = [];
        bookingsByDate[date].push(b);
    });

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    let html = '';
    weekDates.forEach(date => {
        const dateStr = date.toISOString().split('T')[0];
        const dayBookings = bookingsByDate[dateStr] || [];
        const todayClass = isToday(date) ? 'today' : '';

        html += `
            <div class="mini-cal-day ${todayClass}">
                <span class="day-name">${dayNames[date.getDay()]}</span>
                <span class="day-num">${date.getDate()}</span>
                <div class="day-dots">
                    ${dayBookings.slice(0, 3).map(b => {
                        const userClass = getUserClass(b.user);
                        return `<span class="day-dot user-dot ${userClass}"></span>`;
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
        container.innerHTML = '<div class="empty-state"><p>NO ACTIVITY DATA</p></div>';
        return;
    }

    let html = '';
    bookings.slice(0, 8).forEach(booking => {
        const time = new Date(booking.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        const statusClass = booking.success ? 'success' : 'failed';
        const statusIcon = booking.success ? 'check' : 'times';

        html += `
            <div class="activity-item">
                <span class="activity-time">${time}</span>
                <span class="activity-content">
                    <span class="activity-user">${getUserShortName(booking.user)}</span>
                    <span class="activity-action">attempted ${booking.booking_date} ${booking.booking_hour}:00</span>
                    <span class="activity-status ${statusClass}">
                        <i class="fas fa-${statusIcon}"></i>
                    </span>
                </span>
            </div>
        `;
    });

    container.innerHTML = html;
}

function changeWeek(delta) {
    state.currentWeekOffset += delta;
    renderFullCalendar();
}

function renderFullCalendar() {
    const container = document.getElementById('full-calendar');
    if (!container) return;

    const weekDates = getWeekDates(state.currentWeekOffset);
    const bookings = state.status?.bookings || [];
    const reservations = state.status?.reservations || [];

    const weekTitle = document.getElementById('calendar-week-title');
    if (weekTitle) {
        const startDate = weekDates[0];
        const endDate = weekDates[6];
        weekTitle.textContent = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    const bookingMap = {};
    [...bookings.filter(b => b.success), ...reservations].forEach(b => {
        const date = b.booking_date || b.date;
        const hour = b.booking_hour || parseInt(b.time);
        const key = `${date}-${hour}`;
        if (!bookingMap[key]) bookingMap[key] = [];
        bookingMap[key].push(b);
    });

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const hours = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

    let html = '<div class="cal-header"></div>';
    weekDates.forEach(date => {
        const todayClass = isToday(date) ? 'today' : '';
        html += `<div class="cal-header ${todayClass}">${dayNames[date.getDay()]}<br>${date.getDate()}</div>`;
    });

    hours.forEach(hour => {
        html += `<div class="cal-hour">${hour}:00</div>`;
        weekDates.forEach(date => {
            const dateStr = date.toISOString().split('T')[0];
            const key = `${dateStr}-${hour}`;
            const cellBookings = bookingMap[key] || [];
            const todayClass = isToday(date) ? 'today' : '';

            html += `<div class="cal-cell ${todayClass}">`;
            cellBookings.forEach(b => {
                const userClass = getUserClass(b.user);
                html += `<div class="cal-booking ${userClass}">${getUserShortName(b.user)}</div>`;
            });
            html += '</div>';
        });
    });

    container.innerHTML = html;
}

function filterHistory() {
    renderHistory();
}

function renderHistory() {
    const bookings = state.status?.bookings || [];
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

    const successCount = filtered.filter(b => b.success).length;
    const failedCount = filtered.filter(b => !b.success).length;

    document.getElementById('history-total').textContent = filtered.length;
    document.getElementById('history-success').textContent = successCount;
    document.getElementById('history-failed').textContent = failedCount;

    renderHeatmap(filtered);
    renderHistoryTable(filtered);
}

function renderHeatmap(bookings) {
    const container = document.getElementById('booking-heatmap');
    if (!container) return;

    const dayNames = ['', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const hours = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

    const heatData = {};
    bookings.filter(b => b.success).forEach(b => {
        const date = new Date(b.booking_date || b.timestamp);
        const day = date.getDay();
        const hour = b.booking_hour;
        const key = `${day}-${hour}`;
        heatData[key] = (heatData[key] || 0) + 1;
    });

    let html = '<div class="heatmap-label"></div>';
    for (let d = 0; d <= 6; d++) {
        html += `<div class="heatmap-label">${dayNames[d + 1]}</div>`;
    }

    hours.forEach(hour => {
        html += `<div class="heatmap-label">${hour}:00</div>`;
        for (let d = 0; d <= 6; d++) {
            const key = `${d}-${hour}`;
            const count = heatData[key] || 0;
            const level = count === 0 ? '' : (count <= 2 ? 'level-1' : (count <= 4 ? 'level-2' : (count <= 6 ? 'level-3' : 'level-4')));
            html += `<div class="heatmap-cell ${level}" title="${count} bookings">${count || ''}</div>`;
        }
    });

    container.innerHTML = html;
}

function renderHistoryTable(bookings) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    let html = '';
    bookings.slice(0, 50).forEach(b => {
        const time = new Date(b.timestamp).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const statusClass = b.success ? 'success' : 'failed';
        const statusText = b.success ? 'SUCCESS' : 'FAILED';

        html += `
            <tr>
                <td>${time}</td>
                <td>${getUserShortName(b.user)}</td>
                <td>${b.booking_date}</td>
                <td>${b.booking_hour}:00</td>
                <td>${b.court_id || '-'}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center">No data</td></tr>';
}

// ==================== Actions ====================
async function togglePause(userId) {
    if (!state.control || !state.controlSha) {
        showTokenModal();
        return;
    }

    const currentPaused = state.control.users?.[userId]?.paused || false;
    const newPaused = !currentPaused;

    state.control.users = state.control.users || {};
    state.control.users[userId] = state.control.users[userId] || {};
    state.control.users[userId].paused = newPaused;
    state.control.last_updated = new Date().toISOString();

    const success = await updateGitHubFile(
        CONFIG.CONTROL_FILE,
        state.control,
        state.controlSha,
        `${newPaused ? 'Pause' : 'Resume'} ${userId}`
    );

    if (success) {
        await refreshData();
    }
}

function requestCancel(user, reservationId, description) {
    pendingAction = { type: 'cancel', user, reservationId };
    document.getElementById('confirm-title').innerHTML = '<i class="fas fa-exclamation-triangle"></i> CANCEL RESERVATION';
    document.getElementById('confirm-message').textContent = `Cancel ${description} for ${getUserName(user)}?`;
    document.getElementById('confirm-modal').classList.add('active');
}

async function confirmAction() {
    if (!pendingAction) return;

    if (pendingAction.type === 'cancel') {
        // Add to cancellation queue
        state.control.cancellations = state.control.cancellations || {};
        state.control.cancellations[pendingAction.user] = state.control.cancellations[pendingAction.user] || [];
        state.control.cancellations[pendingAction.user].push(pendingAction.reservationId);
        state.control.last_updated = new Date().toISOString();

        await updateGitHubFile(
            CONFIG.CONTROL_FILE,
            state.control,
            state.controlSha,
            `Request cancel: ${pendingAction.reservationId}`
        );

        await refreshData();
    }

    closeConfirmModal();
    pendingAction = null;
}

// ==================== Modals ====================
function showTokenModal() {
    document.getElementById('token-modal').classList.add('active');
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
        refreshData();
    }
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
}

// Close modals on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
        e.target.closest('.modal').classList.remove('active');
    }
});
