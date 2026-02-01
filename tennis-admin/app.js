/**
 * Tennis Court Booking Admin Dashboard
 *
 * This dashboard connects to GitHub to read status and write control commands.
 */

// Configuration
const CONFIG = {
    GITHUB_OWNER: 'xingjian-bai',
    GITHUB_REPO: 'xingjian-bai.github.io',
    STATUS_FILE: 'tennis-admin/status.json',
    CONTROL_FILE: 'tennis-admin/control.json',
    REFRESH_INTERVAL: 5 * 60 * 1000,  // 5 minutes
    USERS: ['xbai02b', 'yangb', 'zwang43b', 'ShivamDuggal4b'],
    USER_DISPLAY_NAMES: {
        'xbai02b': 'Xingjian Bai',
        'yangb': 'Yang Liu',
        'zwang43b': 'Zekai Wang',
        'ShivamDuggal4b': 'Shivam Duggal'
    }
};

// State
let currentData = {
    status: null,
    control: null
};
let pendingAction = null;
let refreshTimer = null;

// ===================== GitHub API Functions =====================

function getGitHubToken() {
    return localStorage.getItem('github_token');
}

function setGitHubToken(token) {
    localStorage.setItem('github_token', token);
}

async function fetchGitHubFile(path) {
    const url = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${path}`;
    const token = getGitHubToken();

    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const data = await response.json();
        const content = atob(data.content);
        return {
            content: JSON.parse(content),
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
        const body = {
            message: message,
            content: btoa(JSON.stringify(content, null, 2)),
            sha: sha
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
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

// ===================== Data Loading =====================

async function loadStatus() {
    const result = await fetchGitHubFile(CONFIG.STATUS_FILE);
    if (result) {
        currentData.status = result.content;
        currentData.statusSha = result.sha;
    }
    return result !== null;
}

async function loadControl() {
    const result = await fetchGitHubFile(CONFIG.CONTROL_FILE);
    if (result) {
        currentData.control = result.content;
        currentData.controlSha = result.sha;
    } else {
        // Initialize default control if not exists
        currentData.control = {
            users: {},
            cancellations: {},
            last_updated: null
        };
        CONFIG.USERS.forEach(user => {
            currentData.control.users[user] = { paused: false };
        });
    }
    return true;
}

async function refreshData() {
    document.getElementById('refresh-btn').textContent = 'Refreshing...';

    await Promise.all([loadStatus(), loadControl()]);

    renderUserStatus();
    renderReservations();
    renderBookingHistory();
    renderPendingActions();

    document.getElementById('last-updated').textContent =
        `Last updated: ${new Date().toLocaleTimeString()}`;
    document.getElementById('refresh-btn').textContent = 'Refresh Now';
}

// ===================== Rendering Functions =====================

function renderUserStatus() {
    const container = document.getElementById('user-status');

    if (!currentData.control) {
        container.innerHTML = '<div class="loading">No data available</div>';
        return;
    }

    let html = '';
    CONFIG.USERS.forEach(userId => {
        const userControl = currentData.control.users?.[userId] || { paused: false };
        const isPaused = userControl.paused;
        const displayName = CONFIG.USER_DISPLAY_NAMES[userId] || userId;

        // Get last booking from status
        let lastBooking = 'No recent bookings';
        if (currentData.status?.bookings) {
            const userBookings = currentData.status.bookings.filter(b => b.user === userId && b.success);
            if (userBookings.length > 0) {
                const latest = userBookings[0];
                lastBooking = `Last: ${latest.booking_date} ${latest.booking_hour}:00`;
            }
        }

        html += `
            <div class="user-card ${isPaused ? 'paused' : ''}">
                <div class="user-card-header">
                    <span class="user-name">${displayName}</span>
                    <span class="user-status ${isPaused ? 'paused' : 'running'}">
                        ${isPaused ? 'Paused' : 'Running'}
                    </span>
                </div>
                <div class="user-email">${userId}</div>
                <div class="user-email">${lastBooking}</div>
                <div class="user-actions">
                    ${isPaused
                        ? `<button class="btn btn-resume" onclick="togglePause('${userId}', false)">Resume</button>`
                        : `<button class="btn btn-pause" onclick="togglePause('${userId}', true)">Pause</button>`
                    }
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderReservations() {
    const container = document.getElementById('reservations');

    if (!currentData.status?.reservations || currentData.status.reservations.length === 0) {
        container.innerHTML = '<p class="empty-state">No current reservations</p>';
        return;
    }

    let html = '';
    currentData.status.reservations.forEach((res, index) => {
        html += `
            <div class="reservation-item">
                <div class="reservation-info">
                    <span class="date">${res.date}</span>
                    <span class="time">${res.time}</span>
                    <span class="court">${res.court}</span>
                    <span class="user">${CONFIG.USER_DISPLAY_NAMES[res.user] || res.user}</span>
                </div>
                <button class="btn btn-danger" onclick="requestCancel('${res.user}', '${res.reservation_id}', '${res.date} ${res.time}')">
                    Cancel
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderBookingHistory() {
    const container = document.getElementById('booking-history');

    if (!currentData.status?.bookings || currentData.status.bookings.length === 0) {
        container.innerHTML = '<p class="empty-state">No booking history</p>';
        return;
    }

    let html = '';
    // Show last 20 bookings
    const recentBookings = currentData.status.bookings.slice(0, 20);

    recentBookings.forEach(booking => {
        const statusClass = booking.success ? 'success' : 'failed';
        const displayName = CONFIG.USER_DISPLAY_NAMES[booking.user] || booking.user;

        html += `
            <div class="history-item ${statusClass}">
                <div>
                    <strong>${booking.booking_date}</strong> ${booking.booking_hour}:00
                    - ${displayName}
                    ${booking.court_id ? ` (Court ${booking.court_id})` : ''}
                </div>
                <span class="history-status ${statusClass}">
                    ${booking.success ? 'Success' : 'Failed'}
                </span>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderPendingActions() {
    const container = document.getElementById('pending-actions');

    if (!currentData.control?.cancellations) {
        container.innerHTML = '<p class="empty-state">No pending actions</p>';
        return;
    }

    let hasPending = false;
    let html = '';

    Object.entries(currentData.control.cancellations).forEach(([user, cancellations]) => {
        if (cancellations && cancellations.length > 0) {
            hasPending = true;
            cancellations.forEach(cancel => {
                html += `
                    <div class="history-item">
                        <div>
                            <strong>Cancel Request:</strong> ${cancel.description || cancel.reservation_id}
                            - ${CONFIG.USER_DISPLAY_NAMES[user] || user}
                        </div>
                        <span class="history-status" style="background: #fefcbf; color: #744210;">Pending</span>
                    </div>
                `;
            });
        }
    });

    container.innerHTML = hasPending ? html : '<p class="empty-state">No pending actions</p>';
}

// ===================== Action Functions =====================

async function togglePause(userId, pause) {
    const action = pause ? 'pause' : 'resume';
    showConfirmModal(
        `${pause ? 'Pause' : 'Resume'} ${CONFIG.USER_DISPLAY_NAMES[userId]}?`,
        `Are you sure you want to ${action} automatic booking for ${CONFIG.USER_DISPLAY_NAMES[userId]}?`,
        async () => {
            // Update control data
            if (!currentData.control.users[userId]) {
                currentData.control.users[userId] = {};
            }
            currentData.control.users[userId].paused = pause;
            currentData.control.last_updated = new Date().toISOString();

            // Save to GitHub
            const success = await updateGitHubFile(
                CONFIG.CONTROL_FILE,
                currentData.control,
                currentData.controlSha,
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
        `Are you sure you want to cancel the reservation for ${description}?`,
        async () => {
            // Add cancellation request
            if (!currentData.control.cancellations[userId]) {
                currentData.control.cancellations[userId] = [];
            }
            currentData.control.cancellations[userId].push({
                reservation_id: reservationId,
                description: description,
                requested_at: new Date().toISOString()
            });
            currentData.control.last_updated = new Date().toISOString();

            // Save to GitHub
            const success = await updateGitHubFile(
                CONFIG.CONTROL_FILE,
                currentData.control,
                currentData.controlSha,
                `Request cancel reservation for ${userId}: ${description}`
            );

            if (success) {
                alert('Cancellation request submitted. It will be processed soon.');
                await refreshData();
            }
        }
    );
}

// ===================== Modal Functions =====================

function showTokenModal() {
    document.getElementById('token-modal').style.display = 'flex';
    document.getElementById('github-token-input').value = getGitHubToken() || '';
}

function closeTokenModal() {
    document.getElementById('token-modal').style.display = 'none';
}

function saveToken() {
    const token = document.getElementById('github-token-input').value.trim();
    if (token) {
        setGitHubToken(token);
        closeTokenModal();
        refreshData();
    }
}

function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    pendingAction = onConfirm;
    document.getElementById('confirm-modal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    pendingAction = null;
}

function confirmAction() {
    if (pendingAction) {
        pendingAction();
    }
    closeConfirmModal();
}

// ===================== Initialization =====================

function startAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    refreshTimer = setInterval(refreshData, CONFIG.REFRESH_INTERVAL);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    refreshData();
    startAutoRefresh();
});
