document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous errors
    document.querySelectorAll('.error').forEach(el => el.style.display = 'none');

    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const role = document.getElementById('role').value;
    const collegeId = document.getElementById('collegeId').value;

    let isValid = true;

    // Email Regex Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        document.getElementById('emailError').style.display = 'block';
        isValid = false;
    }

    // Password must have 8 characters, an uppercase letter, and a number.
    const passRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passRegex.test(password)) {
        document.getElementById('passwordError').style.display = 'block';
        isValid = false;
    }

    // Password Match
    if (password !== confirmPassword) {
        document.getElementById('matchError').style.display = 'block';
        isValid = false;
    }

    if (!isValid) return;

    // API Call
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, role, collegeId })
        });

        const data = await response.json().catch(() => ({}));
        const serverMessage = document.getElementById('serverMessage');
        
        if (response.ok) {
            serverMessage.style.color = 'green';
            serverMessage.innerText = data.msg || 'Registration successful. Check the server terminal for the verification email preview link.';
            document.getElementById('registerForm').reset();
        } else {
            serverMessage.style.color = 'red';
            serverMessage.innerText = data.msg || data.message || data.errors?.map(error => error.msg).join(', ') || 'Registration failed. Please check your details and try again.';
        }
    } catch (error) {
        console.error('Error:', error);
        const serverMessage = document.getElementById('serverMessage');
        serverMessage.style.color = 'red';
        serverMessage.innerText = 'Could not connect to the server. Open the site through http://localhost:5000 and try again.';
    }
});