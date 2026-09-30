import L from 'leaflet';
import { loadMapData, locationHistory } from './backend.js';
import { escapeHtml as h, formatDate } from './shared.js';
import { filterLocations } from './map-model.js';

const $ = id => document.getElementById(id);
const colors = { pending: '#986a2d', down: '#a3292e', fixed: '#32694b', empty: '#686c72' };
let locations = [], visible = [], selectedId = '', page = 0, historyOffset = 0, selectionVersion = 0;
let map, markers, activeTiles;
const tiles = {};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (new URLSearchParams(location.search).has('location_id')) location.replace('/report' + location.search);

function filters() {
  return { query: $('map-search').value, status: $('map-status').value, category: $('map-category').value,
    from: $('map-from').value, to: $('map-to').value, reports: $('layer-reports').checked, empty: $('layer-empty').checked };
}
function expandSheet(expanded) {
  document.querySelector('.map-sidebar').classList.toggle('is-expanded', expanded);
  $('sheet-toggle').setAttribute('aria-expanded', String(expanded));
  $('sheet-toggle').setAttribute('aria-label', expanded ? 'Hide map controls' : 'Show map controls');
  requestAnimationFrame(() => map?.invalidateSize({ pan: true, animate: false }));
}
function fit(items = visible) {
  if (map && items.length) map.fitBounds(items.map(item => [item.latitude,item.longitude]), { padding: [32,32], maxZoom: 17, animate: !reduceMotion });
}
function rows(items) {
  return items.map(item => '<button class="location-row" data-location="' + h(item.id) + '" aria-pressed="' + (item.id === selectedId) + '"><span class="legend-dot ' + (item.report_count ? h(item.status) : 'unreported') + '" aria-hidden="true"></span><span><strong>' + h(item.name) + '</strong><small>' + (item.report_count ? h(item.status) + ' · ' + item.report_count + (item.report_count === 1 ? ' report' : ' reports') : 'No reports') + '</small></span><span class="row-arrow" aria-hidden="true">›</span></button>').join('') || '<p class="empty-state">No matching locations. Try changing your filters.</p>';
}
function renderList() {
  const searching = filters().query.trim().length > 0;
  $('results').hidden = searching;
  $('search-results').hidden = !searching;
  if (searching) {
    $('search-results').innerHTML = '<p class="metadata" role="status">' + visible.length + ' matches' + (visible.length > 100 ? '. Showing the first 100. Narrow your search.' : '') + '</p>' + rows(visible.slice(0,100));
  } else {
    page = Math.min(page, Math.max(0,Math.ceil(visible.length / 20)-1));
    $('result-count').textContent = visible.length;
    $('location-list').innerHTML = rows(visible.slice(page*20,page*20+20));
    $('map-pagination').hidden = visible.length <= 20;
    $('previous-page').disabled = page === 0;
    $('next-page').disabled = (page+1)*20 >= visible.length;
    $('page-label').textContent = (page+1) + ' / ' + Math.max(1,Math.ceil(visible.length/20));
  }
}
function renderMarkers() {
  if (!markers) return;
  markers.clearLayers();
  const radius = map.getZoom() >= 17 ? 8 : map.getZoom() >= 15 ? 6 : 4;
  for (const item of visible) {
    const label = document.createElement('span');
    label.textContent = item.name + ' · ' + (item.report_count ? item.status : 'No reports');
    L.circleMarker([item.latitude,item.longitude], {
      radius: radius + (selectedId === item.id ? 3 : 0), color: selectedId === item.id ? '#20242b' : '#fff',
      weight: selectedId === item.id ? 3 : 1.5, fillColor: colors[item.report_count ? item.status : 'empty'], fillOpacity: item.report_count ? .95 : .45,
    }).bindTooltip(label).on('click', () => selectLocation(item.id, false)).addTo(markers);
  }
}
function update() {
  const state = filters();
  $('filter-error').textContent = state.from && state.to && state.from > state.to ? 'The end date must be on or after the start date.' : '';
  visible = filterLocations(locations,state);
  $('reset-filters').hidden = !state.query && state.status==='all' && state.category==='all' && !state.from && !state.to && state.reports && state.empty;
  if (selectedId && !visible.some(item => item.id === selectedId)) {
    selectedId = ''; selectionVersion++; $('feature-details').hidden = true;
  }
  renderList(); renderMarkers();
}
function issueLabel(report) {
  return report.issue_types.map(type => type === 'Other' && report.issue_other ? 'Other: ' + report.issue_other : type).join(', ');
}
function historyMarkup(reports) {
  return reports.map(report => '<article class="history-row"><div class="history-meta"><span class="status-badge status-badge--' + h(report.status) + '">' + h(report.status) + '</span><time class="metadata">' + h(formatDate(report.submitted_at)) + '</time></div><p>' + h(issueLabel(report)) + '</p>' + (report.description ? '<p>' + h(report.description) + '</p>' : '') + '<div class="photo-grid">' + report.photos.map(photo => '<a href="' + h(photo.url) + '" target="_blank" rel="noreferrer"><img loading="lazy" src="' + h(photo.url) + '" alt="' + h(photo.filename) + '"></a>').join('') + '</div></article>').join('');
}
async function moreHistory(version, initial = false) {
  const id = selectedId, button = $('history-more');
  if (button) button.disabled = true;
  try {
    const reports = await locationHistory(id, historyOffset);
    if (version !== selectionVersion) return;
    if (initial) $('history-items').innerHTML = '';
    $('history-items').insertAdjacentHTML('beforeend', historyMarkup(reports));
    if (!reports.length && initial) $('history-items').innerHTML = '<p class="muted">No reports for this location yet.</p>';
    historyOffset += reports.length;
    $('history-message').textContent = '';
    $('history-more').textContent = 'Load older reports';
    $('history-more').hidden = reports.length < 20;
  } catch (error) {
    if (version !== selectionVersion) return;
    $('history-message').textContent = 'Could not load reports. ' + error.message;
    $('history-more').textContent = 'Retry';
    $('history-more').hidden = false;
  } finally { if (button?.isConnected) button.disabled = false; }
}
async function selectLocation(id, zoom = true) {
  const item = locations.find(item => item.id === id);
  if (!item) return;
  selectedId = id;
  const version = ++selectionVersion;
  historyOffset = 0;
  expandSheet(true);
  $('feature-details').hidden = false;
  $('feature-details').innerHTML = '<div class="section-heading"><h2>' + h(item.name) + '</h2><button id="close-detail" class="icon-button" aria-label="Close location details">×</button></div>'
    + '<dl class="detail-list"><dt>Status</dt><dd>' + (item.report_count ? '<span class="status-badge status-badge--' + h(item.status) + '">' + h(item.status) + '</span>' : 'No reports') + '</dd><dt>Reports</dt><dd>' + item.report_count + ' total · ' + item.open_report_count + ' open</dd><dt>Latest</dt><dd>' + h(formatDate(item.latest_report_at)) + '</dd><dt>Position</dt><dd>' + item.latitude.toFixed(6) + ', ' + item.longitude.toFixed(6) + '</dd></dl>'
    + (item.description ? '<p class="muted">' + h(item.description) + '</p>' : '')
    + '<div class="detail-actions"><button id="zoom-feature">Zoom to location</button><a class="button button--primary" href="/report?location_id=' + encodeURIComponent(id) + '">Report an issue here</a></div>'
    + '<div class="report-history"><h3>Report history</h3><div id="history-items"></div><p id="history-message" class="form-message" role="status">Loading reports…</p><button id="history-more" hidden>Load older reports</button></div>';
  $('zoom-feature').onclick = () => map.setView([item.latitude,item.longitude],18,{animate:!reduceMotion});
  $('close-detail').onclick = () => { selectedId=''; selectionVersion++; $('feature-details').hidden=true; renderMarkers(); renderList(); };
  $('history-more').onclick = () => moreHistory(version, historyOffset===0);
  if (zoom) map.setView([item.latitude,item.longitude],17,{animate:!reduceMotion});
  renderList(); renderMarkers();
  $('feature-details').scrollIntoView({block:'nearest',behavior:'instant'});
  await moreHistory(version,true);
}
function initMap() {
  // At Kingston's latitude, level 14 makes Leaflet's metric scale top out at 500 m.
  // Users can freely zoom from that neighbourhood view down to street detail.
  map = L.map('map',{zoomControl:false,minZoom:14,maxZoom:19,preferCanvas:true,zoomAnimation:!reduceMotion,fadeAnimation:!reduceMotion}).setView([17.9714,-76.792],15);
  tiles.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'});
  tiles.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri, Maxar, Earthstar Geographics'});
  Object.values(tiles).forEach(layer => layer.on('tileerror',()=>{ if(layer===activeTiles) $('tile-error').hidden=false; }));
  activeTiles=tiles.street; activeTiles.addTo(map);
  markers=L.layerGroup().addTo(map);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  map.on('zoomend',renderMarkers);
  $('zoom-in').onclick=()=>map.zoomIn();
  $('zoom-out').onclick=()=>map.zoomOut();
  $('show-all').onclick=()=>fit();
  $('retry-tiles').onclick=()=>{ $('tile-error').hidden=true; activeTiles.redraw(); };
  document.querySelectorAll('[data-basemap]').forEach(button=>button.onclick=()=>{
    map.removeLayer(activeTiles); activeTiles=tiles[button.dataset.basemap]; activeTiles.addTo(map); $('tile-error').hidden=true;
    document.querySelectorAll('[data-basemap]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  });
  new ResizeObserver(()=>map.invalidateSize({pan:true,animate:false})).observe(document.querySelector('.map-surface'));
}
async function boot() {
  const latestToken = sessionStorage.getItem('dkri_latest_report_token');
  if (new URLSearchParams(location.search).get('submitted') === '1' && latestToken) {
    const reportUrl = '/track#' + encodeURIComponent(latestToken);
    $('submission-notice').hidden = false;
    $('view-submitted-report').href = reportUrl;
    $('dialog-view-report').href = reportUrl;
    $('submission-dialog').showModal();
    $('dialog-view-map').onclick = () => {
      $('submission-dialog').close();
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('submitted');
      history.replaceState(null, '', cleanUrl);
    };
  }
  $('sheet-toggle').onclick=()=>expandSheet($('sheet-toggle').getAttribute('aria-expanded')!=='true');
  document.querySelector('.skip-link').onclick=()=>{ expandSheet(true); $('map-search').value=''; update(); $('results').focus(); };
  document.querySelector('.sidebar-body').addEventListener('click',event=>{
    const row=event.target.closest('[data-location]'); if(row) selectLocation(row.dataset.location);
  });
  for(const id of ['map-search','map-status','map-category','map-from','map-to','layer-reports','layer-empty']) {
    $(id).addEventListener(id==='map-search'?'input':'change',()=>{page=0;update();});
  }
  $('reset-filters').onclick=()=>{
    $('map-search').value=''; $('map-status').value='all'; $('map-category').value='all'; $('map-from').value=''; $('map-to').value='';
    $('layer-reports').checked=true; $('layer-empty').checked=true; page=0; update(); fit();
  };
  $('previous-page').onclick=()=>{page--;renderList();};
  $('next-page').onclick=()=>{page++;renderList();};
  try {
    initMap();
    const payload=await loadMapData();
    locations=payload.locations.sort((a,b)=>a.name.localeCompare(b.name));
    $('map-category').insertAdjacentHTML('beforeend',payload.issue_types.map(type=>'<option>'+h(type)+'</option>').join(''));
    $('report-count').textContent=locations.reduce((count,item)=>count+Number(item.report_count),0)+' reports across '+locations.length+' locations';
    update(); fit(); $('map-loading').hidden=true;
  } catch(error) {
    $('map-loading').textContent='Could not load the map. '+error.message;
    $('location-list').innerHTML='<p class="empty-state">Could not load locations.</p><button id="retry-data">Retry</button>';
    $('retry-data').onclick=()=>location.reload();
    expandSheet(true);
  }
}
boot();
