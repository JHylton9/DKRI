
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
  if (button) button.disabled = true;
  try { await action(event); }
  catch (error) {
    const message = document.getElementById(messageId);
    message.textContent = error.message || 'Could not complete this action. Please try again.';
    message.className = 'form-message is-error';
  } finally { if (button) button.disabled = false; }
}
