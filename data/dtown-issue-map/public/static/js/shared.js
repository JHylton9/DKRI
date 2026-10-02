export const DETECTED_LOCATION_KEY = 'dkri_detected_location_id';

export function requestDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not available'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000,
    });
  });
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function handleAction(event, action, messageId) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button?.disabled) return;
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = button.dataset.busy || 'Saving…'; }
  try { await action(event); }
  catch (error) {
    const message = document.getElementById(messageId);
    message.textContent = error.message || 'Could not complete this action. Please try again.';
    message.className = 'form-message is-error';
  } finally { if (button) { button.disabled = false; button.textContent = label; } }
}

export function formatDate(value) {
  if (!value) return 'No reports';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-JM', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Jamaica' }).format(date);
}
