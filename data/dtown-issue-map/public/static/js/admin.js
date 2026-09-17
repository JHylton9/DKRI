import { loadData, reviewReport, importKml, signOut, changePassword } from './backend.js';
import { escapeHtml, handleAction } from './shared.js';
const STATUS_LABELS = {
  all: "Locations",
  pending: "Pending",
  down: "Down",
  fixed: "Fixed",
  reports: "Reports",
  open_reports: "Open Reports",
};



let allLocations = [];
let allReports = [];
let selectedReportId = "";





function statusBadge(status) {
  return `<span class="status-badge status-badge--${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function setMessage(elementId, message, kind = "") {
  const node = document.getElementById(elementId);
  node.textContent = message;
  node.className = `form-message${kind ? ` is-${kind}` : ""}`;
}

function renderWarning(message) {
  const warning = document.getElementById("admin-warning");
  warning.hidden = !message;
  warning.className = "card card--full notice is-warning";
  warning.textContent = message;
}

function flattenReports(locations) {
  return locations.flatMap((location) => (location.reports || []).map((report) => ({
    ...report,
    location_id: location.id,
    location_name: location.name,
    location_status: location.status,
  })));
}

function renderMetrics(counts = {}) {
  const metricRow = document.getElementById("admin-metrics");
  metricRow.innerHTML = ["all", "pending", "down", "fixed", "reports", "open_reports"]
    .map((key) => `
      <div class="metric-card">
        <span class="metric-card__label">${STATUS_LABELS[key]}</span>
        <span class="metric-card__value">${counts[key] ?? 0}</span>
      </div>
    `)
    .join("");
}

function syncKmlFileName() {
  const input = document.getElementById("kml-file");
  const fileName = document.getElementById("kml-file-name");
  if (!input || !fileName) return;
  fileName.textContent = input.files?.[0]?.name || "No file selected";
}

function renderTable() {
  const searchValue = document.getElementById("search-input").value.trim().toLowerCase();
  const statusFilter = document.getElementById("status-filter").value;
  const body = document.getElementById("reports-table-body");

  const rows = allReports.filter((report) => {
    const issueText = (report.issue_types || []).join(" ").toLowerCase();
    const matchesSearch = !searchValue
      || report.location_name.toLowerCase().includes(searchValue)
      || issueText.includes(searchValue)
      || (report.description || "").toLowerCase().includes(searchValue);
    const matchesStatus = statusFilter === "all" || report.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">No reports match the current filters.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = rows.map((report) => `
    <tr data-id="${escapeHtml(report.id)}" class="${report.id === selectedReportId ? "is-selected" : ""}">
      <td>
        <strong>${escapeHtml(report.location_name)}</strong>
        <div class="small-note">${escapeHtml(report.location_id)}</div>
      </td>
      <td>${escapeHtml((report.issue_types || []).join(", ") || "Not specified")}</td>
      <td>${statusBadge(report.status)}</td>
      <td>${escapeHtml(report.submitted_at || "")}</td>
      <td>${escapeHtml(formatContact(report))}</td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-id]").forEach((row) => {
    row.tabIndex = 0;
    row.setAttribute('aria-label', 'Review report for ' + row.querySelector('strong').textContent);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectReport(row.dataset.id || ''); }
    });
    row.addEventListener("click", () => selectReport(row.dataset.id || ""));
  });
}

function formatContact(report) {
  if (report.contact_method === "none" || !report.contact_method) {
    return "No contact info provided";
  }
  const method = report.contact_method === "phone" ? "Phone" : report.contact_method === "email" ? "Email" : "Contact";
  return `${method}: ${report.contact_value || "Not provided"}`;
}

function renderPhotos(photos = []) {
  const grid = document.getElementById("selected-photo-grid");
  if (!photos.length) {
    grid.innerHTML = `<p class="small-note">No photos attached to this report.</p>`;
    return;
  }
  grid.innerHTML = photos.map((photo) => `
    <div class="photo-card">
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.filename)}">
      <a href="${escapeHtml(photo.url)}" target="_blank" rel="noreferrer">${escapeHtml(photo.filename)}</a>
    </div>
  `).join("");
}

function selectReport(reportId) {
  const report = allReports.find((entry) => entry.id === reportId);
  if (!report) return;
  selectedReportId = reportId;
  document.getElementById("selected-report-id").value = report.id;
  document.getElementById("selected-location-name").value = report.location_name;
  document.getElementById("selected-issue-types").value = (report.issue_types || []).join(", ");
  document.getElementById("selected-contact").value = formatContact(report);
  document.getElementById("selected-description").value = report.description || "No description submitted.";
  document.getElementById("selected-status").value = report.status;
  document.getElementById("selected-admin-notes").value = report.admin_notes || "";
  renderPhotos(report.photos || []);
  renderTable();
}

async function fetchDashboard() {
  try { return await loadData(true); }
  catch(error) { if(error.status === 401) window.location.href = '/portal'; throw error; }
}

async function reloadDashboard(selectFirst = false) {
  const payload = await fetchDashboard();
  allLocations = payload.locations || [];
  allReports = flattenReports(allLocations);
  renderMetrics(payload.counts || {});
  renderWarning("");

  if ((!selectedReportId || !allReports.find((report) => report.id === selectedReportId)) && selectFirst && allReports.length) {
    selectedReportId = allReports[0].id;
  }

  renderTable();
  if (selectedReportId) {
    selectReport(selectedReportId);
  } else {
    document.getElementById("selected-location-name").value = "";
    document.getElementById("selected-issue-types").value = "";
    document.getElementById("selected-contact").value = "";
    document.getElementById("selected-description").value = "";
    document.getElementById("selected-admin-notes").value = "";
    document.getElementById("selected-photo-grid").innerHTML = "<p class=\"small-note\">Select a report to see its photos.</p>";
  }
}

async function saveStatus(event) {
  event.preventDefault();
  const reportId = document.getElementById("selected-report-id").value;
  if (!reportId) {
    setMessage("status-message", "Select a report first.", "error");
    return;
  }

  await reviewReport(reportId, document.getElementById('selected-status').value, document.getElementById('selected-admin-notes').value);
  const payload = await loadData(true);
  allLocations = payload.locations || [];
  allReports = flattenReports(allLocations);
  renderMetrics(payload.counts || {});
  renderTable();
  selectReport(reportId);
  setMessage("status-message", "Report review saved.", "success");
}

async function uploadKml(event) {
  event.preventDefault();
  const input = document.getElementById("kml-file");
  const file = input.files?.[0];
  if (!file) {
    setMessage("kml-message", "Choose a KML file first.", "error");
    return;
  }

  const count = await importKml(file);
  await reloadDashboard(true);
  input.value = "";
  syncKmlFileName();
  setMessage("kml-message", `Loaded ${count} active locations from ${file.name}.`, "success");
}

async function logout() {
  await signOut();
  window.location.href = "/portal";
}

function bindEvents() {
  document.getElementById('password-form').addEventListener('submit', event => handleAction(event, async () => {
    await changePassword(document.getElementById('new-password').value);
    document.getElementById('password-form').reset();
    setMessage('password-message', 'Password updated.', 'success');
  }, 'password-message'));
  document.getElementById("report-status-form").addEventListener("submit", event => handleAction(event, saveStatus, "status-message"));
  document.getElementById("kml-upload-form").addEventListener("submit", event => handleAction(event, uploadKml, "kml-message"));
  document.getElementById("kml-file").addEventListener("change", syncKmlFileName);
  document.getElementById("search-input").addEventListener("input", renderTable);
  document.getElementById("status-filter").addEventListener("change", renderTable);
  document.getElementById("logout-button").addEventListener("click", logout);
}

async function boot() {
  bindEvents();
  syncKmlFileName();
  try {
    await reloadDashboard(true);
  } catch (error) {
    renderWarning(error.message || "Could not load the admin dashboard.");
  }
}

boot();
