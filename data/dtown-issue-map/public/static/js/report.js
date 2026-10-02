import { loadMapData, submitReport as saveReport } from './backend.js';
import { nearestActiveLocation } from './map-model.js';
import { escapeHtml, handleAction, requestDevicePosition, DETECTED_LOCATION_KEY } from './shared.js';

let locations = [];
let locationQuery = '';
let selectedLocationId = '';
let photoPreviewUrls = [];

function statusPill(status) {
  return `<span class="status-pill status-pill--${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function setMessage(message, kind = '') {
  const node = document.getElementById('report-message');
  node.textContent = message;
  node.className = `form-message${kind ? ` is-${kind}` : ''}`;
}

function showFieldError(message, target) {
  document.querySelectorAll('.field-error').forEach(node => node.remove());
  document.querySelectorAll('[aria-invalid="true"]').forEach(node => node.removeAttribute('aria-invalid'));
  setMessage(message, 'error');
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  const region = element?.closest('.form-section') || element;
  if (element && region) {
    element.setAttribute('aria-invalid', 'true');
    const inline = document.createElement('p');
    inline.className = 'form-message is-error field-error';
    inline.textContent = message;
    const label = element.closest('label:not(.checkbox-card)');
    (label || region).append(inline);
  }
  region?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => element?.focus({ preventScroll: true }), 250);
}

function getPhotoInput() {
  return document.getElementById('photo-input');
}

function formatFileSize(bytes) {
  const sizeInMb = bytes / (1024 * 1024);
  if (sizeInMb >= 1) {
    return `${Math.round(sizeInMb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function resetPhotoPreviewUrls() {
  photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  photoPreviewUrls = [];
}

function renderPhotoPreview() {
  const input = getPhotoInput();
  const summary = document.getElementById('photo-selection-summary');
  const grid = document.getElementById('photo-preview-grid');
  const files = Array.from(input.files || []);

  resetPhotoPreviewUrls();

  if (!files.length) {
    summary.textContent = 'No photos selected yet.';
    grid.hidden = true;
    grid.innerHTML = '';
    return;
  }

  summary.textContent = files.length === 1
    ? '1 photo selected.'
    : `${files.length} photos selected.`;
  if (files.length > 5) {
    setMessage('Choose up to 5 photos per report.', 'error');
  } else if (document.getElementById('report-message').classList.contains('is-error')) {
    setMessage('');
  }

  grid.hidden = false;
  grid.innerHTML = files.map((file) => {
    const objectUrl = URL.createObjectURL(file);
    photoPreviewUrls.push(objectUrl);
    return `
      <article class="photo-preview-card">
        <img src="${objectUrl}" alt="${escapeHtml(file.name)}">
        <div class="photo-preview-card__meta">
          <strong>${escapeHtml(file.name)}</strong>
          <span>${formatFileSize(file.size)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function openPhotoPicker(preferCamera) {
  const input = getPhotoInput();
  input.accept = 'image/*';
  input.multiple = true;
  if (preferCamera) {
    input.setAttribute('capture', 'environment');
  } else {
    input.removeAttribute('capture');
  }
  input.click();
}

function getFetchErrorMessage() {
  return 'Could not connect to the reporting service. Check your connection and try again.';
}

function renderIssueTypes(issueTypes) {
  const container = document.getElementById('issue-type-list');
  container.innerHTML = issueTypes.map((issueType) => `
    <label class="checkbox-card">
      <input type="checkbox" name="issue_types" value="${escapeHtml(issueType)}">
      <span>${escapeHtml(issueType)}</span>
    </label>
  `).join('');
}

function filteredLocations() {
  const query = locationQuery.trim().toLowerCase();
  if (!query) return locations;
  return locations.filter((location) => location.name.toLowerCase().includes(query));
}

function setSelectedLocation(id, { announce = false } = {}) {
  selectedLocationId = locations.some((location) => location.id === id) ? id : '';
  document.getElementById('location-id').value = selectedLocationId;
  renderLocationOptions();
  renderLocationSummary();
  if (announce && selectedLocationId) {
    const status = document.getElementById('location-detect-status');
    status.hidden = false;
    status.textContent = `Selected ${getSelectedLocation()?.name || 'location'}. You can search below to change it.`;
  }
}

function renderLocationOptions() {
  const container = document.getElementById('location-options');
  const items = filteredLocations();
  if (!locations.length) {
    container.innerHTML = '<p class="muted">No active locations are available right now.</p>';
    return;
  }
  if (!items.length) {
    container.innerHTML = '<p class="muted">No locations match your search.</p>';
    return;
  }
  container.innerHTML = items.map((location) => `
    <button type="button" class="picker-row" role="radio" aria-checked="${location.id === selectedLocationId}" data-location-id="${escapeHtml(location.id)}">
      <span>
        <strong>${escapeHtml(location.name)}</strong>
        <small>${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}</small>
      </span>
    </button>
  `).join('');
}

function getSelectedLocation() {
  return locations.find((location) => location.id === selectedLocationId) || null;
}

function renderLocationSummary() {
  const location = getSelectedLocation();
  document.getElementById('location-title').textContent = location ? location.name : 'Choose a location';
  document.getElementById('location-summary').textContent = location
    ? location.description || `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
    : 'Select a mapped location for your report.';

  const pills = document.getElementById('location-pills');
  pills.innerHTML = location
    ? `${location.report_count ? statusPill(location.status) : '<span class="pill">No reports</span>'}`
    : '';
}

function syncOtherIssue() {
  const selected = document.querySelector('input[name="issue_types"][value="Other"]')?.checked;
  const field = document.getElementById('other-issue-field');
  const input = document.getElementById('other-issue-input');
  field.hidden = !selected;
  input.required = Boolean(selected);
  if (!selected) input.value = '';
}

function rememberReport(token) {
  const reports = JSON.parse(localStorage.getItem('dkri_report_links') || '[]').filter(item => item.token !== token);
  reports.unshift({ token, saved_at: new Date().toISOString() });
  localStorage.setItem('dkri_report_links', JSON.stringify(reports.slice(0, 5)));
  sessionStorage.setItem('dkri_latest_report_token', token);
}

function syncContactField() {
  const method = document.getElementById('contact-method').value;
  const label = document.getElementById('contact-value-label');
  const input = document.getElementById('contact-value');

  if (method === 'none' || !method) {
    label.textContent = 'Contact Detail';
    input.type = 'text';
    input.value = '';
    input.required = false;
    input.disabled = true;
    input.placeholder = 'No contact details will be shared';
  } else if (method === 'email') {
    label.textContent = 'Email';
    input.type = 'email';
    input.required = true;
    input.disabled = false;
    input.placeholder = 'example@example.com';
  } else if (method === 'phone') {
    label.textContent = 'Phone Number';
    input.type = 'tel';
    input.required = true;
    input.disabled = false;
    input.placeholder = '(000) 000-0000';
  } else {
    label.textContent = 'Contact Detail';
    input.type = 'text';
    input.required = false;
    input.disabled = true;
    input.placeholder = 'Choose a contact method first';
  }
}

function applyLocationPrefill() {
  const prefillId = new URLSearchParams(window.location.search).get('location_id');
  if (!prefillId) return false;
  if (!locations.find((location) => location.id === prefillId)) return false;

  setSelectedLocation(prefillId);
  const prefill = document.getElementById('location-prefill');
  prefill.hidden = false;
  prefill.textContent = 'Location preselected from a map or QR-linked entry. You can still change it if needed.';
  return true;
}

async function applyNearestLocationFromDevice() {
  if (applyLocationPrefill()) return;
  const storedId = sessionStorage.getItem(DETECTED_LOCATION_KEY);
  if (storedId && locations.some((location) => location.id === storedId)) {
    setSelectedLocation(storedId, { announce: true });
    return;
  }
  try {
    const position = await requestDevicePosition();
    const match = nearestActiveLocation(locations, position.coords.latitude, position.coords.longitude);
    if (!match) return;
    sessionStorage.setItem(DETECTED_LOCATION_KEY, match.location.id);
    setSelectedLocation(match.location.id, { announce: true });
    const status = document.getElementById('location-detect-status');
    status.textContent = `Using your position: ${match.location.name} (about ${Math.round(match.distanceMeters)} m away).`;
  } catch {
    // Location permission denied or unavailable; manual selection still works.
  }
}

async function submitReport(event) {
  event.preventDefault();
  const form = document.getElementById('report-form');
  const formData = new FormData(form);
  const checkedIssueTypes = Array.from(document.querySelectorAll('input[name="issue_types"]:checked')).map((input) => input.value);
  const photoFiles = Array.from(getPhotoInput().files || []);

  if (!selectedLocationId) {
    showFieldError('Choose a location first.', 'location-search');
    return;
  }
  if (!checkedIssueTypes.length) {
    showFieldError('Choose at least one issue type.', document.querySelector('input[name="issue_types"]'));
    return;
  }
  const description = String(formData.get('description') || '').trim();
  if (!description && !photoFiles.length) {
    showFieldError('Add a short description or at least one photo.', 'description-input');
    return;
  }
  if (checkedIssueTypes.includes('Other') && !String(formData.get('issue_other') || '').trim()) {
    showFieldError('Briefly name the other issue.', 'other-issue-input');
    return;
  }
  if (photoFiles.length > 5) {
    showFieldError('Choose up to 5 photos per report.', 'photo-library-button');
    return;
  }
  if (photoFiles.some(file => file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) {
    showFieldError('Use JPG, PNG, WEBP or GIF photos, each 10 MB or smaller.', 'photo-library-button');
    return;
  }
  if (formData.get('contact_method') === 'email' && !document.getElementById('contact-value').validity.valid) {
    showFieldError('Enter a valid email address.', 'contact-value');
    return;
  }
  if (formData.get('contact_method') === 'phone' && String(formData.get('contact_value')).replace(/\D/g, '').length < 7) {
    showFieldError('Enter a phone number with at least 7 digits.', 'contact-value');
    return;
  }

  formData.set('location_id', selectedLocationId);
  formData.delete('issue_types');
  checkedIssueTypes.forEach((issueType) => formData.append('issue_types', issueType));

  try {
    const payload = await saveReport(formData);
    rememberReport(payload.access_token);
    window.location.assign('/map?submitted=1');
  } catch (error) {
    setMessage(
      error instanceof TypeError ? getFetchErrorMessage() : (error.message || 'Could not submit the report.'),
      'error',
    );
  }
}

function bindEvents() {
  document.getElementById('location-search').addEventListener('input', (event) => {
    locationQuery = event.target.value;
    renderLocationOptions();
  });
  document.getElementById('location-options').addEventListener('click', (event) => {
    const row = event.target.closest('[data-location-id]');
    if (!row) return;
    setSelectedLocation(row.dataset.locationId);
    document.getElementById('location-prefill').hidden = true;
    document.getElementById('location-detect-status').hidden = true;
  });
  document.getElementById('contact-method').addEventListener('change', syncContactField);
  document.getElementById('issue-type-list').addEventListener('change', syncOtherIssue);
  document.getElementById('photo-camera-button').addEventListener('click', () => openPhotoPicker(true));
  document.getElementById('photo-library-button').addEventListener('click', () => openPhotoPicker(false));
  getPhotoInput().addEventListener('change', renderPhotoPreview);
  document.getElementById('report-form').addEventListener('submit', event => handleAction(event, submitReport, 'report-message'));
}

async function boot() {
  bindEvents();
  syncContactField();
  try {
    const payload = await loadMapData();
    locations = payload.locations || [];
    renderIssueTypes(payload.issue_types || []);
    syncOtherIssue();
    renderLocationOptions();
    renderLocationSummary();
    await applyNearestLocationFromDevice();
  } catch (error) {
    setMessage(error.message || 'Could not load the report form.', 'error');
  }
}

boot();
