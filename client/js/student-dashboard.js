const token = localStorage.getItem('token');
const userName = localStorage.getItem('userName');

if (!token) {
    window.location.href = '/login.html';
}

document.getElementById('userNameDisplay').innerText = userName || 'Student';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

async function fetchWithAuth(url, options = {}) {
    const currentToken = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + currentToken,
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers, credentials: 'include' });

    if (response.status === 401 || response.status === 403) {
        alert('Your session has expired. Please log in again.');
        localStorage.clear();
        window.location.href = '/login.html';
        throw new Error('Session expired');
    }
    return response;
}

async function loadEvents() {
    try {
        const res = await fetchWithAuth('/api/events');
        const events = await res.json();

        const container = document.getElementById('eventsList');
        if (events.length === 0) {
            container.innerHTML = '<p>No events available at the moment.</p>';
            return;
        }

        container.innerHTML = events.map(event => `
            <div class="event-card">
                <div>
                    ${event.bannerImage ? `<img class="event-banner" src="${escapeHtml(event.bannerImage)}" alt="${escapeHtml(event.title)} banner">` : ''}
                    <h4>${escapeHtml(event.title)}</h4>
                    <p><strong>Category:</strong> ${escapeHtml(event.category)}</p>
                    <p><strong>Date:</strong> ${new Date(event.date).toLocaleString()}</p>
                    <p><strong>Location:</strong> ${escapeHtml(event.location)}</p>
                    <p><strong>Capacity:</strong> ${event.capacity}</p>
                    <p><strong>Available spots:</strong> ${event.availableSpots}</p>
                    ${event.waitlistCount ? `<p><strong>Waitlisted:</strong> ${event.waitlistCount}</p>` : ''}
                    <p style="margin-top: 10px; font-size: 0.9rem;">${escapeHtml(event.description)}</p>
                </div>
                <button class="small" data-action="register" data-event-id="${event._id}">
                    ${event.availableSpots > 0 ? 'Register for Event' : 'Join Waitlist'}
                </button>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load events', err);
    }
}

async function loadMyRegistrations() {
    try {
        const res = await fetchWithAuth('/api/events/my-registrations');
        const regs = await res.json();

        const container = document.getElementById('myRegistrations');
        if (regs.length === 0) {
            container.innerHTML = '<p>You have not registered for any events yet.</p>';
            return;
        }

        container.innerHTML = regs.map(reg => `
            <div class="event-card">
                <div>
                    <h4>${escapeHtml(reg.event.title)}</h4>
                    <p><strong>Date:</strong> ${new Date(reg.event.date).toLocaleDateString()}</p>
                    <p><strong>Location:</strong> ${escapeHtml(reg.event.location)}</p>
                    <div style="margin-top: 10px;">
                        Status: <span class="status-badge ${reg.status}">${reg.status}</span>
                    </div>
                </div>
                ${reg.status === 'cancelled' ? '' : `<button class="danger small" style="margin-top: 15px;" data-action="cancel" data-event-id="${reg.event._id}">Cancel Registration</button>`}
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load registrations', err);
    }
}

async function registerEvent(eventId) {
    try {
        const res = await fetchWithAuth('/api/events/' + eventId + '/register', { method: 'POST' });
        const data = await res.json();
        alert(data.message || data.msg || 'Action completed');
        loadMyRegistrations();
        loadEvents();
    } catch (err) {
        console.error('Registration failed', err);
    }
}

async function cancelRegistration(eventId) {
    if (!confirm('Are you sure you want to cancel your registration?')) return;

    try {
        const res = await fetchWithAuth('/api/events/' + eventId + '/cancel', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Registration cancelled.');
        loadMyRegistrations();
        loadEvents();
    } catch (err) {
        console.error('Cancellation failed', err);
    }
}

document.getElementById('eventsList').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="register"]');
    if (button) registerEvent(button.dataset.eventId);
});

document.getElementById('myRegistrations').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="cancel"]');
    if (button) cancelRegistration(button.dataset.eventId);
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (e) {
        console.error('Logout error');
    }
    localStorage.clear();
    window.location.href = '/login.html';
});

loadEvents();
loadMyRegistrations();
