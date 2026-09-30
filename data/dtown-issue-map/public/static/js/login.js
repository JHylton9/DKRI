import { adminSession, signIn } from './backend.js';
import { handleAction } from './shared.js';
import './analytics.js';

document.getElementById('login-form').addEventListener('submit', event => handleAction(event, async () => {
  await signIn(document.getElementById('username').value.trim(), document.getElementById('password').value);
  window.location.href = '/portal/dashboard';
}, 'login-message'));
adminSession().then(user => { if (user) window.location.href = '/portal/dashboard'; }).catch(() => {
  document.getElementById('login-message').textContent = 'Could not check your session. Please sign in.';
});
