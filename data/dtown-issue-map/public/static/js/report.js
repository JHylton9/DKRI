import { loadMapData, submitReport as saveReport } from './backend.js';
import { escapeHtml, handleAction } from './shared.js';


let locations = [];

let selectedLocationId = "";
let photoPreviewUrls = [];





function statusPill(status) {
  return `<span class="status-pill status-pill--${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function setMessage(message, kind = "") {
  const node = document.getElementById("report-message");
  node.textContent = message;
  node.className = `form-message${kind ? ` is-${kind}` : ""}`;
}

function getPhotoInput() {
  return document.getElementById("photo-input");
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
  const summary = document.getElementById("photo-selection-summary");
  const grid = document.getElementById("photo-preview-grid");
  const files = Array.from(input.files || []);

  resetPhotoPreviewUrls();

  if (!files.length) {
    summary.textContent = "No photos selected yet.";
    grid.hidden = true;
    grid.innerHTML = "";
    return;
  }

  summary.textContent = files.length === 1
    ? "1 photo selected."
    : `${files.length} photos selected.`;
  if (files.length > 5) {
    setMessage("Choose up to 5 photos per report.", "error");
  } else if (document.getElementById("report-message").classList.contains("is-error")) {
    setMessage("");
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
  }).join("");
}

function openPhotoPicker(preferCamera) {
  const input = getPhotoInput();
  input.accept = "image/*";
  input.multiple = true;
  if (preferCamera) {
    input.setAttribute("capture", "environment");
  } else {
    input.removeAttribute("capture");
  }
  input.click();
}

function getFetchErrorMessage(subject) {
  return `Could not connect to the reporting service. Check your connection and try again.`;
}

function renderIssueTypes(issueTypes) {
  const container = document.getElementById("issue-type-list");
  container.innerHTML = issueTypes.map((issueType) => `
    <label class="checkbox-card">
      <input type="checkbox" name="issue_types" value="${escapeHtml(issueType)}">
      <span>${escapeHtml(issueType)}</span>
    </label>
  `).join("");
}

function renderLocationOptions(locationItems) {
  const select = document.getElementById("location-select");
  select.innerHTML = `
    <option value="">Choose a location</option>
    ${locationItems.map((location) => `
      <option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>
    `).join("")}
  `;
}

function getSelectedLocation() {
  return locations.find((location) => location.id === selectedLocationId) || null;
}

function renderLocationSummary() {
  const location = getSelectedLocation();
  document.getElementById("location-title").textContent = location ? location.name : "Choose a location";
  document.getElementById("location-summary").textContent = location
    ? location.description || location.latitude.toFixed(6) + ', ' + location.longitude.toFixed(6)
    : "Select a mapped location for your report.";

  const pills = document.getElementById("location-pills");
  pills.innerHTML = location
    ? `
      ${location.report_count ? statusPill(location.status) : '<span class="pill">No reports</span>'}
      <span class="pill">Code ${escapeHtml(location.code_label || location.id)}</span>
    `
    : "";
}

function syncContactField() {
  const method = document.getElementById("contact-method").value;
  const label = document.getElementById("contact-value-label");
  const input = document.getElementById("contact-value");

  if (method === "none" || !method) {
    label.textContent = "Contact Detail";
    input.type = "text";
    input.value = "";
    input.required = false;
    input.disabled = true;
    input.placeholder = "No contact details will be shared";
  } else if (method === "email") {
    label.textContent = "Email";
    input.type = "email";
    input.required = true;
    input.disabled = false;
    input.placeholder = "example@example.com";
  } else if (method === "phone") {
    label.textContent = "Phone Number";
    input.type = "tel";
    input.required = true;
    input.disabled = false;
    input.placeholder = "(000) 000-0000";
  } else {
    label.textContent = "Contact Detail";
    input.type = "text";
    input.required = false;
    input.disabled = true;
    input.placeholder = "Choose a contact method first";
  }
}

function applyLocationPrefill() {
  const prefillId = new URLSearchParams(window.location.search).get("location_id");
  if (!prefillId) return;
  if (!locations.find((location) => location.id === prefillId)) return;

  selectedLocationId = prefillId;
  document.getElementById("location-select").value = prefillId;
  renderLocationSummary();

  const prefill = document.getElementById("location-prefill");
  prefill.hidden = false;
  prefill.textContent = "Location preselected from a map or QR-linked entry. You can still change it if needed.";
}

async function fetchFormData() { return loadMapData(); }

async function submitReport(event) {
  event.preventDefault();
  const form = document.getElementById("report-form");
  const formData = new FormData(form);
  const checkedIssueTypes = Array.from(document.querySelectorAll('input[name="issue_types"]:checked')).map((input) => input.value);
  const photoFiles = Array.from(getPhotoInput().files || []);

  if (!checkedIssueTypes.length) {
    setMessage("Choose at least one issue type.", "error");
    return;
  }
  if (!formData.get("location_id")) {
    setMessage("Choose a location first.", "error");
    return;
  }
  if (photoFiles.length > 5) {
    setMessage("Choose up to 5 photos per report.", "error");
    return;
  }
  if (photoFiles.some(file => file.size > 10 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))) {
    setMessage('Use JPG, PNG, WEBP or GIF photos, each 10 MB or smaller.', 'error');
    return;
  }
  if (formData.get('contact_method') === 'phone' && String(formData.get('contact_value')).replace(/\D/g, '').length < 7) {
    setMessage('Enter a phone number with at least 7 digits.', 'error');
    return;
  }

  formData.delete("issue_types");
  checkedIssueTypes.forEach((issueType) => formData.append("issue_types", issueType));

  try {
    const payload = await saveReport(formData);
    const reportedLocation = getSelectedLocation();
    if (reportedLocation) {
      reportedLocation.report_count++;
      if (reportedLocation.status !== 'down') reportedLocation.status = 'pending';
    }

    const keepLocationId = document.getElementById("location-select").value;
    form.reset();
    document.getElementById("location-select").value = keepLocationId;
    document.getElementById("contact-method").value = "none";
    selectedLocationId = keepLocationId;
    renderLocationSummary();
    syncContactField();
    renderPhotoPreview();
    setMessage(`Report submitted for ${payload.location_name}.`, "success");
  } catch (error) {
    setMessage(
      error instanceof TypeError ? getFetchErrorMessage("report submissions") : (error.message || "Could not submit the report."),
      "error",
    );
  }
}

function bindEvents() {
  document.getElementById("location-select").addEventListener("change", (event) => {
    selectedLocationId = event.target.value;
    renderLocationSummary();
  });
  document.getElementById("location-change-button").addEventListener("click", () => {
    document.getElementById("location-select").focus();
  });
  document.getElementById("contact-method").addEventListener("change", syncContactField);
  document.getElementById("photo-camera-button").addEventListener("click", () => openPhotoPicker(true));
  document.getElementById("photo-library-button").addEventListener("click", () => openPhotoPicker(false));
  getPhotoInput().addEventListener("change", renderPhotoPreview);
  document.getElementById("report-form").addEventListener("submit", event => handleAction(event, submitReport, "report-message"));
}

async function boot() {
  bindEvents();
  syncContactField();
  try {
    const payload = await fetchFormData();
    locations = payload.locations || [];
    renderIssueTypes(payload.issue_types || []);
    renderLocationOptions(locations);
    applyLocationPrefill();
    renderLocationSummary();
  } catch (error) {
    setMessage(error.message || "Could not load the report form.", "error");
  }
}

boot();
