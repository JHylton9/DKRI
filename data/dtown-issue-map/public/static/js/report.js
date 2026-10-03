import L from 'leaflet';
import { loadMapData, submitReport as saveReport } from './backend.js';
import { nearestActiveLocation } from './map-model.js';
import { escapeHtml, handleAction, requestDevicePosition, DETECTED_LOCATION_KEY } from './shared.js';

let locations = [];
let selectedLocationId = '';
let photoPreviewUrls = [];
let reportMap = null;
let reportMarker = null;
let lastDistanceMeters = null;

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

function getSelectedLocation() {
  return locations.find((location) => location.id === selectedLocationId) || null;
}

function updateSubmitState() {
  document.getElementById('submit-report-button').disabled = !selectedLocationId;
}

function ensureReportMap(location) {
  const point = [location.latitude, location.longitude];
  if (!reportMap) {
    reportMap = L.map('report-location-map', { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false }).setView(point, 18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(reportMap);
    reportMarker = L.circleMarker(point, {
      radius: 10,
      color: 'oklch(25% 0.012 260)',
      weight: 2,
      fillColor: 'oklch(47% 0.16 25)',
      fillOpacity: 0.9,
    }).addTo(reportMap);
    requestAnimationFrame(() => reportMap.invalidateSize({ pan: false }));
    return;
  }
  reportMarker.setLatLng(point);
  reportMap.setView(point, 18, { animate: false });
  requestAnimationFrame(() => reportMap.invalidateSize({ pan: false }));
}

function setSelectedLocation(id, { distanceMeters = null, source = 'detected' } = {}) {
  selectedLocationId = locations.some((location) => location.id === id) ? id : '';
  lastDistanceMeters = distanceMeters;
  document.getElementById('location-id').value = selectedLocationId;
  document.getElementById('location-error').hidden = true;
  updateSubmitState();

  const location = getSelectedLocation();
  const panel = document.getElementById('location-panel');
  const status = document.getElementById('location-detect-status');

  if (!location) {
    panel.hidden = true;
    status.textContent = 'Could not match a mapped location yet.';
    return;
  }

  panel.hidden = false;
  document.getElementById('location-title').textContent = location.name;
  document.getElementById('location-summary').textContent = location.description
    || 'Your report will be linked to this mapped point.';
  document.getElementById('location-pills').innerHTML = location.report_count
    ? statusPill(location.status)
    : '<span class="pill">No reports yet</span>';

  if (source === 'map-link') {
    status.textContent = 'Location set from the public map or a QR link.';
  } else if (distanceMeters != null) {
    status.textContent = `Nearest mapped location, about ${Math.round(distanceMeters)} m from you.`;
  } else {
    status.textContent = 'Using the nearest mapped location from your last position check.';
  }

  ensureReportMap(location);
}

function setLocationFailure(message) {
  selectedLocationId = '';
  document.getElementById('location-id').value = '';
  document.getElementById('location-panel').hidden = true;
  document.getElementById('location-detect-status').textContent = message;
  const error = document.getElementById('location-error');
  error.hidden = false;
  error.innerHTML = `${escapeHtml(message)} <a href="/map">Open the map</a> if you need to check nearby points.`;
  updateSubmitState();
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
  sessionStorage.setItem(DETECTED_LOCATION_KEY, prefillId);
  setSelectedLocation(prefillId, { source: 'map-link' });
  return true;
}

async function resolveLocationFromDevice({ forceFresh = false } = {}) {
  document.getElementById('location-detect-status').textContent = 'Finding the nearest mapped location…';
  document.getElementById('location-error').hidden = true;

  if (!forceFresh && applyLocationPrefill()) return;

  if (!forceFresh) {
    const storedId = sessionStorage.getItem(DETECTED_LOCATION_KEY);
    if (storedId && locations.some((location) => location.id === storedId)) {
      setSelectedLocation(storedId);
      return;
    }
  } else {
    sessionStorage.removeItem(DETECTED_LOCATION_KEY);
  }

  try {
    const position = await requestDevicePosition();
    const match = nearestActiveLocation(locations, position.coords.latitude, position.coords.longitude);
    if (!match) {
      setLocationFailure('No mapped location is close enough. Move nearer to a downtown reporting point, then refresh.');
      return;
    }
    sessionStorage.setItem(DETECTED_LOCATION_KEY, match.location.id);
    setSelectedLocation(match.location.id, { distanceMeters: match.distanceMeters });
  } catch {
    setLocationFailure('Location access is needed to match the nearest reporting point. Allow location in your browser, then refresh.');
  }
}

async function submitReport(event) {
  event.preventDefault();
  const form = document.getElementById('report-form');
  const formData = new FormData(form);
  const checkedIssueTypes = Array.from(document.querySelectorAll('input[name="issue_types"]:checked')).map((input) => input.value);
  const photoFiles = Array.from(getPhotoInput().files || []);

  if (!selectedLocationId) {
    showFieldError('Wait for your mapped location, or refresh your position.', 'refresh-location-button');
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
  document.getElementById('refresh-location-button').addEventListener('click', () => {
    resolveLocationFromDevice({ forceFresh: true });
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
  updateSubmitState();
  try {
    const payload = await loadMapData();
    locations = payload.locations || [];
    renderIssueTypes(payload.issue_types || []);
    syncOtherIssue();
    await resolveLocationFromDevice();
  } catch (error) {
    setMessage(error.message || 'Could not load the report form.', 'error');
  }
}

boot();
