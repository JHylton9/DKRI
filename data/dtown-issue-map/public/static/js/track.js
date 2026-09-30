import { accessReport } from './backend.js';
import { escapeHtml as h, formatDate, handleAction } from './shared.js';

const $ = id => document.getElementById(id);
let token = decodeURIComponent(location.hash.slice(1));

function savedReports() {
  try { return JSON.parse(localStorage.getItem('dkri_report_links') || '[]'); } catch { return []; }
}
function issues(report) {
  return report.issue_types.map(type => type === 'Other' && report.issue_other ? 'Other: ' + report.issue_other : type).join(', ');
}
function renderSaved() {
  const reports = savedReports();
  $('saved-reports').innerHTML = reports.map((item, index) => '<a class="saved-report-link" href="/track#' + encodeURIComponent(item.token) + '">Report ' + (index + 1) + '<span>' + h(formatDate(item.saved_at)) + '</span></a>').join('') || '<p class="muted">No report links are saved in this browser yet.</p>';
}
function renderFollowups(rows) {
  $('track-followups').innerHTML = rows.map(row => '<article class="followup"><div><strong>' + (row.author === 'admin' ? 'Review team' : 'You') + '</strong><time>' + h(formatDate(row.created_at)) + '</time></div><p>' + h(row.message) + '</p></article>').join('') || '<p class="muted">No followups yet.</p>';
}
async function load() {
  if (!token) { $('track-report').hidden = true; $('track-empty').hidden = false; renderSaved(); return; }
  try {
    const report = await accessReport(token);
    $('track-empty').hidden = true; $('track-report').hidden = false;
    $('track-status').innerHTML = '<span class="status-badge status-badge--' + h(report.status) + '">' + h(report.status) + '</span>';
    $('track-facts').innerHTML = '<dt>Location</dt><dd>' + h(report.location_name) + '</dd><dt>Submitted</dt><dd>' + h(formatDate(report.submitted_at)) + '</dd><dt>Issues</dt><dd>' + h(issues(report)) + '</dd><dt>Description</dt><dd>' + h(report.description || 'Photo provided without a description.') + '</dd>';
    $('track-photos').innerHTML = report.photos.map(photo => '<a href="' + h(photo.url) + '" target="_blank" rel="noreferrer"><img src="' + h(photo.url) + '" alt="' + h(photo.filename) + '"></a>').join('');
    renderFollowups(report.followups);
  } catch (error) {
    $('track-report').hidden = true; $('track-empty').hidden = false; renderSaved();
    $('track-empty').insertAdjacentHTML('afterbegin', '<p class="form-message is-error">This report link is invalid or no longer available.</p>');
  }
}

$('followup-form').onsubmit = event => handleAction(event, async () => {
  const message = $('followup-message').value.trim();
  if (!message) throw new Error('Add a message first.');
  await accessReport(token, 'followup', message);
  $('followup-message').value = '';
  await load();
  $('track-message').textContent = 'Followup sent.';
  $('track-message').className = 'form-message is-success';
}, 'track-message');
window.addEventListener('hashchange', () => { token = decodeURIComponent(location.hash.slice(1)); load(); });
load();
