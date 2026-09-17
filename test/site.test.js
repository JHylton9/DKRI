import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseKml } from '../data/dtown-issue-map/public/static/js/model.js';

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
  for (const page of ['index','map','login','admin']) {
    const html = readFileSync(`dist/${page}.html`, 'utf8');
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/static\/[^"?]+)(?:\?[^" ]*)?"/g)) assert.ok(existsSync(`dist${asset}`), asset);
  }
  for (const page of ['report','map','login','admin']) {
    const source = readFileSync(`data/dtown-issue-map/public/static/js/${page}.js`, 'utf8');
    assert.equal(source.includes('API_BASE'), false, `${page} must not call the removed application server`);
  }
});
