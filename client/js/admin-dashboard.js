const token = localStorage.getItem('token');
const userRole = localStorage.getItem('userRole');
const currentUserName = localStorage.getItem('userName') || 'Admin';
let editingEventId = null;
let currentEvents = [];
let userSearchTimer;
let currentUserId = '';

try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    currentUserId = JSON.parse(atob(encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, '='))).userId;
} catch {
    currentUserId = '';
}

if (!token || userRole !== 'admin') {
    alert('Access Denied. Administrator privileges required.');
    window.location.href = '/login.html';
}

document.getElementById('adminName').innerText = currentUserName;

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
    const headers = {
        ...options.headers,
        Authorization: 'Bearer ' + localStorage.getItem('token')
    };
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    if (response.status === 401 || response.status === 403) {
        alert(response.status === 403
            ? 'Access denied. Administrator privileges are required.'
            : 'Your admin session has expired. Please log in again.');
        localStorage.clear();
        window.location.href = '/login.html';
        throw new Error('Session expired or access denied');
    }
    return response;
}

async function responseData(response) {
    return response.json().catch(() => ({}));
}

async function loadAdminStats() {
    const response = await fetchWithAuth('/api/admin/stats');
    if (!response.ok) throw new Error('Failed to load dashboard statistics');
    const stats = await response.json();
    document.getElementById('totalUsers').textContent = stats.users;
    document.getElementById('totalEvents').textContent = stats.events;
    document.getElementById('totalRegistrations').textContent = stats.registrations;
    document.getElementById('activeAlumni').textContent = stats.activeAlumni;
}

function updateEventSelectors() {
    const selectors = [
        document.getElementById('reportEventSelect'),
        document.getElementById('emailEventSelect')
    ];
    selectors.forEach(select => {
        const selectedValue = select.value;
        select.innerHTML = currentEvents.length
            ? currentEvents.map(event => `<option value="${escapeHtml(event._id)}">${escapeHtml(event.title)}</option>`).join('')
            : '<option value="">No events available</option>';
        if (currentEvents.some(event => event._id === selectedValue)) {
            select.value = selectedValue;
        }
        select.disabled = currentEvents.length === 0;
    });
    document.getElementById('loadReportButton').disabled = currentEvents.length === 0;
    document.getElementById('exportReportButton').disabled = currentEvents.length === 0;
    if (!currentEvents.length) {
        document.getElementById('registrationReport').textContent = 'No events available.';
    }
}

async function loadAdminEvents() {
    try {
        const response = await fetchWithAuth('/api/events');
        if (!response.ok) throw new Error('Failed to load events');
        currentEvents = await response.json();

        const eventsList = document.getElementById('adminEventsList');
        eventsList.innerHTML = currentEvents.length
            ? currentEvents.map(event => `
                <article class="event-list-item">
                    <div class="event-list-details">
                        ${event.bannerImage ? `<img class="event-banner-thumb" src="${escapeHtml(event.bannerImage)}" alt="">` : ''}
                        <div>
                            <h4>${escapeHtml(event.title)}</h4>
                            <p>${escapeHtml(new Date(event.date).toLocaleString())} | Capacity: ${event.capacity}</p>
                        </div>
                    </div>
                    <div class="admin-actions">
                        <button class="small" data-action="edit" data-event-id="${escapeHtml(event._id)}">Edit</button>
                        <button class="small" data-action="report" data-event-id="${escapeHtml(event._id)}">Report</button>
                        <button class="danger small" data-action="delete" data-event-id="${escapeHtml(event._id)}">Delete</button>
                    </div>
                </article>
            `).join('')
            : '<p>No events found.</p>';
        updateEventSelectors();
        if (currentEvents.length) await loadRegistrationReport();
    } catch (error) {
        console.error('Error loading events', error);
    }
}

function resetEventForm() {
    editingEventId = null;
    document.getElementById('createEventForm').reset();
    document.getElementById('eventSubmitButton').textContent = 'Publish Event';
    document.getElementById('cancelEditButton').hidden = true;
    document.getElementById('currentBannerContainer').hidden = true;
    document.getElementById('currentBanner').removeAttribute('src');
}

function editEvent(eventId) {
    const event = currentEvents.find(item => item._id === eventId);
    if (!event) {
        alert('Event details could not be found. Refresh the event list and try again.');
        return;
    }

    editingEventId = eventId;
    document.getElementById('title').value = event.title;
    document.getElementById('description').value = event.description;
    const eventDate = new Date(event.date);
    eventDate.setMinutes(eventDate.getMinutes() - eventDate.getTimezoneOffset());
    document.getElementById('date').value = eventDate.toISOString().slice(0, 16);
    document.getElementById('location').value = event.location;
    document.getElementById('category').value = event.category;
    document.getElementById('capacity').value = event.capacity;
    document.getElementById('removeBanner').checked = false;
    const bannerContainer = document.getElementById('currentBannerContainer');
    bannerContainer.hidden = !event.bannerImage;
    if (event.bannerImage) document.getElementById('currentBanner').src = event.bannerImage;
    document.getElementById('eventSubmitButton').textContent = 'Save Changes';
    document.getElementById('cancelEditButton').hidden = false;
    document.getElementById('createEventForm').scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('createEventForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData();
    for (const field of ['title', 'description', 'date', 'location', 'category', 'capacity']) {
        formData.append(field, document.getElementById(field).value);
    }
    const banner = document.getElementById('banner').files[0];
    if (banner) formData.append('banner', banner);
    formData.append('removeBanner', String(document.getElementById('removeBanner').checked));

    const isEditing = Boolean(editingEventId);
    try {
        const response = await fetchWithAuth(
            isEditing ? '/api/admin/events/' + editingEventId : '/api/admin/events',
            {
                method: isEditing ? 'PUT' : 'POST',
                body: formData
            }
        );
        const data = await responseData(response);
        if (!response.ok) {
            alert(data.message || 'Could not save event.');
            return;
        }
        alert(data.message || (isEditing ? 'Event updated successfully.' : 'Event created successfully.'));
        resetEventForm();
        await Promise.all([loadAdminEvents(), loadAdminStats()]);
    } catch (error) {
        console.error('Event save error', error);
        alert('Could not save event. Check the server connection and try again.');
    }
});

document.getElementById('cancelEditButton').addEventListener('click', resetEventForm);

async function deleteEvent(eventId) {
    if (!confirm('Deleting this event will also permanently delete its registrations. Continue?')) return;
    try {
        const response = await fetchWithAuth('/api/admin/events/' + eventId, { method: 'DELETE' });
        const data = await responseData(response);
        if (!response.ok) {
            alert(data.message || 'Could not delete event.');
            return;
        }
        alert(data.message || 'Event deleted.');
        await Promise.all([loadAdminEvents(), loadAdminStats()]);
    } catch (error) {
        console.error('Delete error', error);
    }
}

async function loadUsers() {
    const search = document.getElementById('userSearch').value.trim();
    try {
        const response = await fetchWithAuth('/api/admin/users?search=' + encodeURIComponent(search));
        if (!response.ok) throw new Error('Failed to load users');
        const users = await response.json();
        const usersList = document.getElementById('adminUsersList');
        usersList.innerHTML = users.length
            ? users.map(user => {
                const isCurrentUser = user._id === currentUserId;
                return `
                    <article class="admin-user-row" data-user-id="${escapeHtml(user._id)}">
                        <div>
                            <strong>${escapeHtml(user.name)}</strong>
                            <span>${escapeHtml(user.email)} | ${escapeHtml(user.collegeId)}</span>
                            <small>${user.is_verified ? 'Email verified' : 'Email not verified'}${isCurrentUser ? ' | Current account' : ''}</small>
                        </div>
                        <div class="admin-actions">
                            <label>Role
                                <select data-user-role ${isCurrentUser ? 'disabled' : ''}>
                                    ${['student', 'alumni', 'admin'].map(role => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                                </select>
                            </label>
                            <label>Status
                                <select data-user-active ${isCurrentUser ? 'disabled' : ''}>
                                    <option value="true" ${user.is_active !== false ? 'selected' : ''}>Active</option>
                                    <option value="false" ${user.is_active === false ? 'selected' : ''}>Suspended</option>
                                </select>
                            </label>
                            <button class="small" data-action="save-user" ${isCurrentUser ? 'disabled' : ''}>Save</button>
                        </div>
                    </article>`;
            }).join('')
            : '<p>No matching users.</p>';
    } catch (error) {
        console.error('Error loading users', error);
    }
}

document.getElementById('userSearch').addEventListener('input', () => {
    clearTimeout(userSearchTimer);
    userSearchTimer = setTimeout(loadUsers, 250);
});

document.getElementById('adminUsersList').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action="save-user"]');
    if (!button) return;
    const row = button.closest('[data-user-id]');
    const body = {
        role: row.querySelector('[data-user-role]').value,
        is_active: row.querySelector('[data-user-active]').value === 'true'
    };
    try {
        const response = await fetchWithAuth('/api/admin/users/' + row.dataset.userId, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
        const data = await responseData(response);
        alert(data.message || 'Could not update user.');
        if (response.ok) await Promise.all([loadUsers(), loadAdminStats()]);
    } catch (error) {
        console.error('User update error', error);
    }
});

async function loadRegistrationReport() {
    const eventId = document.getElementById('reportEventSelect').value;
    if (!eventId) return;
    try {
        const response = await fetchWithAuth('/api/admin/events/' + eventId + '/registrations');
        const data = await responseData(response);
        if (!response.ok) throw new Error(data.message || 'Could not load registration report');
        const registrations = data.registrations || [];
        document.getElementById('registrationReport').innerHTML = `
            <h4>${escapeHtml(data.event)} — ${registrations.length} registration(s)</h4>
            <div class="report-table-wrap">
                <table>
                    <thead><tr><th>Name</th><th>Email</th><th>College ID</th><th>Status</th><th>Registered</th></tr></thead>
                    <tbody>${registrations.length ? registrations.map(registration => `
                        <tr>
                            <td>${escapeHtml(registration.user?.name || 'Deleted user')}</td>
                            <td>${escapeHtml(registration.user?.email || '')}</td>
                            <td>${escapeHtml(registration.user?.collegeId || '')}</td>
                            <td>${escapeHtml(registration.status)}</td>
                            <td>${escapeHtml(registration.registeredAt ? new Date(registration.registeredAt).toLocaleString() : '')}</td>
                        </tr>`).join('') : '<tr><td colspan="5">No registrations for this event.</td></tr>'}</tbody>
                </table>
            </div>`;
    } catch (error) {
        console.error('Registration report error', error);
        document.getElementById('registrationReport').textContent = 'Could not load registrations. Please try again.';
    }
}

document.getElementById('loadReportButton').addEventListener('click', loadRegistrationReport);
document.getElementById('reportEventSelect').addEventListener('change', loadRegistrationReport);

document.getElementById('exportReportButton').addEventListener('click', async () => {
    const eventId = document.getElementById('reportEventSelect').value;
    if (!eventId) return;
    try {
        const response = await fetchWithAuth('/api/admin/events/' + eventId + '/export');
        if (!response.ok) {
            const data = await responseData(response);
            alert(data.message || 'Could not export registrations.');
            return;
        }
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `registrations-${eventId}.csv`;
        link.click();
        URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        console.error('CSV export error', error);
    }
});

document.getElementById('adminEventsList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'edit') editEvent(button.dataset.eventId);
    if (button.dataset.action === 'delete') deleteEvent(button.dataset.eventId);
    if (button.dataset.action === 'report') {
        document.getElementById('reportEventSelect').value = button.dataset.eventId;
        document.getElementById('registrationReport').scrollIntoView({ behavior: 'smooth' });
        loadRegistrationReport();
    }
});

document.getElementById('bulkEmailForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const eventId = document.getElementById('emailEventSelect').value;
    const result = document.getElementById('bulkEmailResult');
    result.textContent = 'Sending notifications…';
    try {
        const response = await fetchWithAuth('/api/admin/events/' + eventId + '/notify', {
            method: 'POST',
            body: JSON.stringify({
                subject: document.getElementById('bulkEmailSubject').value,
                message: document.getElementById('bulkEmailMessage').value
            })
        });
        const data = await responseData(response);
        result.textContent = data.message || 'Could not send notifications.';
        if (response.ok) form.reset();
    } catch (error) {
        console.error('Bulk email error', error);
        result.textContent = 'Could not send notifications. Check the server logs and email configuration.';
    }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
        console.error('Logout error', error);
    }
    localStorage.clear();
    window.location.href = '/login.html';
});

Promise.all([loadAdminEvents(), loadAdminStats(), loadUsers()]).catch(error => {
    console.error('Admin dashboard initialization error', error);
});
