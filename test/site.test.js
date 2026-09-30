import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseKml } from '../data/dtown-issue-map/public/static/js/model.js';
import { filterLocations, importChanges } from '../data/dtown-issue-map/public/static/js/map-model.js';

test('fixed-location KML parsing rejects unsafe or invalid location inventories', () => {
  const points = parseKml(readFileSync('data/dtown-issue-map/data/issues.kml', 'utf8'));
  assert.equal(points.length, 16);
  assert.equal(new Set(points.map(p => p.id)).size, 16);
  assert.ok(points.every(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)));
  assert.throws(() => parseKml('<!DOCTYPE kml><kml/>'));
  assert.throws(() => parseKml('<kml><Placemark><Point><coordinates>0,91</coordinates></Point></Placemark></kml>'));
  assert.throws(() => parseKml('<kml><Placemark id="same"><Point><coordinates>0,1</coordinates></Point></Placemark><Placemark id="same"><Point><coordinates>0,2</coordinates></Point></Placemark></kml>'));
});

test('deployment contains static entry pages and no application API function', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(config.functions, undefined);
  assert.equal(existsSync('api/index.js'), false);
  for (const route of config.rewrites) assert.ok(existsSync(`dist${route.destination}`), `Missing route target: ${route.destination}`);
  for (const route of config.redirects) assert.ok(config.rewrites.some(rewrite => rewrite.source === route.destination), `Unresolved redirect: ${route.destination}`);
  for (const path of ['.env.local', 'ADMIN-CREDENTIALS.local.txt', 'api/index.js', 'supabase']) assert.equal(existsSync(`dist/${path}`), false, `Private or server file in deployment: ${path}`);
  for (const page of ['index','map','report','track','login','admin']) {
    const html = readFileSync(`dist/${page}.html`, 'utf8');
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/static\/[^"?]+)(?:\?[^" ]*)?"/g)) assert.ok(existsSync(`dist${asset}`), asset);
    assert.match(html, /href="https:\/\/www\.theleapco\.com\/"[^>]+rel="noopener noreferrer"/);
  }
  assert.match(readFileSync('dist/index.html','utf8'), /class="map-workspace"/);
  for (const page of ['report','map','track','login','admin']) {
    const source = readFileSync(`data/dtown-issue-map/public/static/js/${page}.js`, 'utf8');
    assert.equal(source.includes('API_BASE'), false, `${page} must not call the removed application server`);
  }
});

test('map filters combine layers, search, categories and inclusive latest-report dates', () => {
  const locations = [
    { id: 'A', name: 'Church Street', report_count: 1, status: 'fixed', issue_types: ['Blocked drain'], latest_report_at: '2026-09-29T12:00:00Z', is_active: true },
    { id: 'B', name: 'King Street', report_count: 0, status: 'pending', issue_types: [], latest_report_at: null, is_active: true },
    { id: 'C', name: 'Old location', report_count: 1, status: 'pending', issue_types: ['Lighting issue'], latest_report_at: '2026-09-28T12:00:00Z', is_active: false },
  ];
  const defaults = { query: '', status: 'all', category: 'all', from: '', to: '', reports: true, empty: true };
  assert.equal(filterLocations(locations, { ...defaults, query: 'CHURCH', category: 'Blocked drain', from: '2026-09-29', to: '2026-09-29' })[0].id, 'A');
  assert.equal(filterLocations(locations, { ...defaults, reports: false })[0].id, 'B');
  assert.deepEqual(filterLocations(locations, { ...defaults, status: 'pending' }).map(row => row.id), ['C'], 'Unreported locations must not masquerade as pending reports');
  assert.equal(filterLocations(locations, { ...defaults, from: '2026-09-30', to: '2026-09-29' }).length, 0);
  assert.deepEqual(importChanges([{id:'A'},{id:'C'}], locations), { added: 1, retained: 1, archived: 1 });
  const eveningReport = [{ ...locations[0], latest_report_at: '2026-09-30T02:00:00Z' }];
  assert.equal(filterLocations(eveningReport, { ...defaults, from: '2026-09-29', to: '2026-09-29' }).length, 1, 'Date filters use the same Jamaica calendar date as report labels');
});

test('public map allows a 500 metre overview and street-level zoom', () => {
  const mapSource = readFileSync('data/dtown-issue-map/public/static/js/map.js', 'utf8');
  assert.match(mapSource, /minZoom:14,maxZoom:19/);
  assert.match(mapSource, /maxZoom: 17/);
});

test('report validation stays in-page and submission prioritizes report tracking', () => {
  const reportHtml = readFileSync('data/dtown-issue-map/public/report.html', 'utf8');
  const mapHtml = readFileSync('data/dtown-issue-map/public/map.html', 'utf8');
  const reportSource = readFileSync('data/dtown-issue-map/public/static/js/report.js', 'utf8');
  assert.match(reportHtml, /id="report-form"[^>]+novalidate/);
  assert.match(reportSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.ok(mapHtml.indexOf('>View report<') < mapHtml.indexOf('>View map<'));
});

test('admin location editor preserves immutable location codes', () => {
  const adminHtml=readFileSync('data/dtown-issue-map/public/admin.html','utf8');
  const adminSource=readFileSync('data/dtown-issue-map/public/static/js/admin.js','utf8');
  assert.match(adminHtml,/id="edit-location-code" disabled/);
  assert.match(adminSource,/await updateLocation\(\{id,name:/);
});

test('public navigation routes explicitly to map and reporting', () => {
  const mapHtml=readFileSync('data/dtown-issue-map/public/map.html','utf8');
  assert.match(mapHtml,/class="brand" href="\/map"/);
  assert.match(mapHtml,/class="button button--primary" href="\/report">Report an issue/);
});

test('account access auto-saves and deletion requires confirmation', () => {
  const adminHtml=readFileSync('data/dtown-issue-map/public/admin.html','utf8');
  const adminSource=readFileSync('data/dtown-issue-map/public/static/js/admin.js','utf8');
  assert.doesNotMatch(adminSource,/data-save-account/);
  assert.match(adminSource,/accounts-table-body'\)\.onchange/);
  assert.match(adminHtml,/id="delete-account-dialog"/);
});
