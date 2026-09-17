import { loadData } from './backend.js';
import { escapeHtml } from './shared.js';
const STATUS_LABELS = {
  all: "All Locations",
  pending: "Pending",
  down: "Down",
  fixed: "Fixed",
};

const STATUS_CLASS = {
  pending: "issue-marker--pending",
  down: "issue-marker--down",
  fixed: "issue-marker--fixed",
};



let activeStatus = "all";
let map;
let layerGroup;
let allLocations = [];
let mapCounts = {};
let fullBounds = null;





function statusBadge(status) {
  return `<span class="status-badge status-badge--${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}



function renderMetrics(counts) {
  mapCounts = counts || {};
  const metricRow = document.getElementById("metric-row");
  if (!metricRow) return;
  metricRow.innerHTML = ["all", "pending", "down", "fixed"]
    .map((status) => `
      <div class="metric-card">
        <span class="metric-card__label">${STATUS_LABELS[status]}</span>
        <span class="metric-card__value">${counts[status] ?? 0}</span>
      </div>
    `)
    .join("");
}

function renderMapMeta(visibleCount) {
  const filterLabel = STATUS_LABELS[activeStatus].toLowerCase();
  const summaryLabel = activeStatus === "all" ? "locations" : `${filterLabel} locations`;
  const mapMeta = document.getElementById("map-meta");
  if (!mapMeta) return;
  mapMeta.innerHTML = `
    <span>Total reports: <strong>${mapCounts.reports ?? 0}</strong></span>
    <span>Open reports: <strong>${mapCounts.open_reports ?? 0}</strong></span>
    <span>Photos: <strong>${mapCounts.photos ?? 0}</strong></span>
    <span>Showing <strong>${visibleCount}</strong> ${escapeHtml(summaryLabel)}</span>
  `;
}

function getVisibleLocations() {
  return activeStatus === "all"
    ? allLocations
    : allLocations.filter((location) => location.status === activeStatus);
}

function buildReportHistory(location) {
  const reports = (location.reports || []).slice(0, 2);
  if (!reports.length) {
    return `<p class="small-note">No reports have been submitted for this location yet.</p>`;
  }
  return `
    <p class="popup-section-label">Recent activity</p>
    <div class="popup-report-list">
      ${reports.map((report) => `
        <div class="popup-report">
          <div class="popup-report__meta">
            ${statusBadge(report.status)}
            <span class="pill">${escapeHtml((report.issue_types || []).join(", ") || "General issue")}</span>
          </div>
          <p><strong>Submitted:</strong> ${escapeHtml(report.submitted_at)}</p>
          ${report.description ? `<p>${escapeHtml(report.description)}</p>` : ""}
          ${report.photos?.length ? `
            <div class="photo-grid">
              ${report.photos.slice(0, 3).map((photo) => `
                <div class="photo-card">
                  <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.filename)}">
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function buildPopup(location) {
  return `
    <article class="popup-card">
      <h3>${escapeHtml(location.name)}</h3>
      <p>${statusBadge(location.status)}</p>
      <p><strong>Location code:</strong> ${escapeHtml(location.id)}</p>
      <p><strong>Coordinates:</strong> ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}</p>
      <p><strong>Current view:</strong> ${location.open_report_count} open reports, ${location.report_count} total reports</p>
      ${location.issue_types?.length ? `<p><strong>Common issues:</strong> ${escapeHtml(location.issue_types.join(", "))}</p>` : ""}
      ${location.description ? `<p>${escapeHtml(location.description)}</p>` : ""}
      <p><a class="button button--ghost button--wide" href="/?location_id=${encodeURIComponent(location.id)}">Report issue here</a></p>
      ${buildReportHistory(location)}
    </article>
  `;
}

function buildMarker(location) {
  const icon = L.divIcon({
    className: "",
    html: `<div class="issue-marker ${STATUS_CLASS[location.status] || STATUS_CLASS.pending}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
  return L.marker([location.latitude, location.longitude], { icon }).bindPopup(buildPopup(location));
}

function updateViewport(locations) {
  if (!map || !locations.length) return;

  const bounds = locations.length === allLocations.length && fullBounds
    ? fullBounds
    : L.latLngBounds(
    locations.map((location) => [location.latitude, location.longitude]),
  );
  map.fitBounds(bounds, {
    padding: [34, 34],
    maxZoom: 17,
  });
}

function renderMarkers() {
  if (!layerGroup) return;
  layerGroup.clearLayers();
  const visible = getVisibleLocations();
  visible.forEach((location) => layerGroup.addLayer(buildMarker(location)));
  renderLocationList(visible);
  renderMapMeta(visible.length);
  updateViewport(visible);
}

function renderLocationList(locations) {
  const container = document.getElementById("location-list");
  if (!container) return;
  container.innerHTML = locations.map((location) => `
    <article class="location-list__item">
      <div class="popup-report__meta">
        <h3>${escapeHtml(location.name)}</h3>
        ${statusBadge(location.status)}
      </div>
      <div class="meta-strip">
        <span>Code ${escapeHtml(location.id)}</span>
        <span>${location.open_report_count} open</span>
      </div>
      <p class="small-note">${escapeHtml((location.issue_types || []).join(", ") || "No issue categories yet")}</p>
      <div class="meta-strip">
        <span>${location.report_count} reports</span>
        <span>${location.photo_count} photos</span>
      </div>
      <p><a href="/?location_id=${encodeURIComponent(location.id)}">Submit a new report for this location</a></p>
    </article>
  `).join("") || `<p class="empty-state">No locations match the <strong>${escapeHtml(STATUS_LABELS[activeStatus].toLowerCase())}</strong> filter.</p>`;

}

function renderMapError(message) {
  const mapNode = document.getElementById("map");
  if (!mapNode) return;
  mapNode.classList.add("map-canvas--error");
  mapNode.innerHTML = `
    <div class="map-canvas__message">
      <strong>Map unavailable</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function initMap(bounds) {
  map = L.map("map", { zoomControl: true, scrollWheelZoom: true });
  const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  });
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri" },
  );
  streets.addTo(map);
  L.control.layers({ Streets: streets, Satellite: satellite }, {}, { position: "topleft" }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);

  if (bounds.min_lat !== null) {
    const leafletBounds = [
      [bounds.min_lat, bounds.min_lng],
      [bounds.max_lat, bounds.max_lng],
    ];
    fullBounds = L.latLngBounds(leafletBounds);
    map.fitBounds(fullBounds, { padding: [26, 26] });
  } else {
    map.setView([17.9714, -76.792], 15);
  }
}

function bindFilters() {
  document.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.remove("is-active"));
      button.classList.add("is-active");
      activeStatus = button.dataset.status || "all";
      renderMarkers();
    });
  });
}

async function loadMap() { return loadData(); }

async function boot() {
  bindFilters();
  try {
    const payload = await loadMap();
    allLocations = payload.locations || [];
    renderMetrics(payload.counts || {});
    initMap(payload.bounds || {});
    renderMarkers();
  } catch (error) {
    renderMapError(error.message || "Could not load the public map.");
    const locationList = document.getElementById("location-list");
    if (locationList) {
      locationList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
  }
}

boot();
