document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('token', data.accessToken);
            localStorage.setItem('userRole', data.role);
            localStorage.setItem('userName', data.name);

            if (data.role === 'student' || data.role === 'alumni') {
                window.location.href = '/student-dashboard.html';
            } else if (data.role === 'admin') {
                window.location.href = '/admin-dashboard.html';
            }
        } else {
            const serverMessage = document.getElementById('serverMessage');
            serverMessage.style.color = 'red';
            serverMessage.innerText = data.message || 'Login failed.';
        }
    } catch (error) {
        console.error('Login error:', error);
        const serverMessage = document.getElementById('serverMessage');
        serverMessage.style.color = 'red';
        serverMessage.innerText = 'Server unavailable. Please try again.';
    }
});

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('verified') === 'true') {
    const serverMessage = document.getElementById('serverMessage');
    serverMessage.style.color = 'green';
    serverMessage.innerText = 'Email successfully verified! You can now log in.';
}
