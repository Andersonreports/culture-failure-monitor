const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const submitBtn = document.getElementById('loginSubmit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;

  const role = document.getElementById('loginRole').value;
  const password = document.getElementById('loginPassword').value;
  if (!role) {
    errorBox.textContent = 'Please select your role.';
    errorBox.hidden = false;
    return;
  }

  const original = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    window.location.href = '/';
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});

fetch('/api/auth/session')
  .then((r) => r.json())
  .then((data) => {
    if (data.role) window.location.href = '/';
  })
  .catch(() => {});
