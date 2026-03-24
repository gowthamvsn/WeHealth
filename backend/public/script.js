const API_BASE = 'http://localhost:3000';

// Check if user is logged in on page load
window.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('token');
  if (token) {
    showLoggedIn();
  }
});

function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName).classList.add('active');
  event.target.classList.add('active');
}

function showMessage(elementId, message, isSuccess = true) {
  const messageEl = document.getElementById(elementId);
  messageEl.className = `message ${isSuccess ? 'success' : 'error'}`;
  messageEl.textContent = message;
}

async function handleLogin(event) {
  event.preventDefault();
  const identifier = document.getElementById('loginIdentifier').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      showMessage('loginMessage', 'Login successful!', true);
      setTimeout(showLoggedIn, 500);
    } else {
      showMessage('loginMessage', data.error || 'Login failed', false);
    }
  } catch (error) {
    showMessage('loginMessage', 'Login failed', false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const email = document.getElementById('regEmail').value;
  const username = document.getElementById('regUsername').value;
  const password = document.getElementById('regPassword').value;

  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('registerMessage', 'Registration successful! Please login.', true);
      document.getElementById('regEmail').value = '';
      document.getElementById('regUsername').value = '';
      document.getElementById('regPassword').value = '';
      setTimeout(() => {
        document.querySelectorAll('.tab-btn')[0].click();
      }, 1500);
    } else {
      showMessage('registerMessage', data.error || 'Registration failed', false);
    }
  } catch (error) {
    showMessage('registerMessage', 'Registration failed', false);
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById('forgotEmail').value;

  try {
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('forgotMessage', 'OTP sent to your email!', true);
      document.getElementById('forgotStep1').style.display = 'none';
      document.getElementById('forgotStep2').style.display = 'block';
      // Store email for step 2
      document.getElementById('forgotEmail').value = email;
    } else {
      showMessage('forgotMessage', data.error || 'Failed to send OTP', false);
    }
  } catch (error) {
    showMessage('forgotMessage', 'Failed to send OTP', false);
  }
}

async function handleResetPassword(event) {
  event.preventDefault();
  const email = document.getElementById('forgotEmail').value;
  const otp = document.getElementById('resetOtp').value;
  const newPassword = document.getElementById('resetNewPassword').value;

  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('forgotMessage', 'Password reset successful! Please login.', true);
      setTimeout(() => {
        // Reset form
        document.getElementById('forgotStep1').style.display = 'block';
        document.getElementById('forgotStep2').style.display = 'none';
        document.getElementById('forgotEmail').value = '';
        document.getElementById('resetOtp').value = '';
        document.getElementById('resetNewPassword').value = '';
        document.querySelectorAll('.tab-btn')[0].click();
      }, 1500);
    } else {
      showMessage('forgotMessage', data.error || 'Password reset failed', false);
    }
  } catch (error) {
    showMessage('forgotMessage', 'Password reset failed', false);
  }
}

function showLoggedIn() {
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('loggedInSection').style.display = 'block';

  const user = JSON.parse(localStorage.getItem('user'));
  const token = localStorage.getItem('token');

  document.getElementById('userId').textContent = user.user_id;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('userUsername').textContent = user.username;
  document.getElementById('userToken').textContent = token;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  document.getElementById('authSection').style.display = 'block';
  document.getElementById('loggedInSection').style.display = 'none';
  // Clear forms
  document.getElementById('loginIdentifier').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('regEmail').value = '';
  document.getElementById('regUsername').value = '';
  document.getElementById('regPassword').value = '';
}
