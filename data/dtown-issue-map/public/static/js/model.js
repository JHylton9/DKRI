import { XMLParser, XMLValidator } from 'fast-xml-parser';
export const ISSUE_TYPES = ['Garbage buildup', 'Illegal dumping', 'Damaged / missing bin', 'Blocked drain', 'Lighting issue', 'Signage issue', 'Vagrancy / loitering'];
export const STATUSES = ['pending', 'down', 'fixed'];
export const now = () => new Date().toISOString();
export function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
export const normalize = value => value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

export function parseKml(text) {
  if (typeof text !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw invalid('Upload a valid KML file.');
  const root = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(text);
  if (!root.kml) throw invalid('Upload a valid KML file.');
  const points = [];
  let index = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'Placemark') for (const item of [value].flat()) {
        index++;
        const raw = String(item.Point?.coordinates ?? '').trim();
        if (!raw) continue;
        const parts = raw.split(',').map(value => value.trim());
        const [longitude, latitude, altitude = 0] = parts.map(Number);
        if (parts.length < 2 || !parts[0] || !parts[1] || ![longitude, latitude, altitude].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
        const name = String(item.name || `Location ${index}`).trim();
        points.push({ id: String(item['@_id'] || `${normalize(String(item.name || '')) || 'location'}-${index}`), name, description: String(item.description || ''), latitude, longitude, altitude });
      } else if (Array.isArray(value)) value.forEach(walk); else walk(value);
    }
  }
  walk(root.kml);
  if (!points.length || new Set(points.map(p => p.id)).size !== points.length) throw invalid('KML must contain valid points with unique IDs.');
  return points;
}

