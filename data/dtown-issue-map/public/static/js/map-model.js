const EARTH_RADIUS_M = 6371000;

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Pick the closest active mapped point within maxMeters (default 120 m). */
export function nearestActiveLocation(locations, latitude, longitude, maxMeters = 120) {
  let best = null;
  let bestDistance = Infinity;
  for (const location of locations) {
    if (location.is_active === false) continue;
    const distance = distanceMeters(latitude, longitude, location.latitude, location.longitude);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = location;
    }
  }
  if (!best || bestDistance > maxMeters) return null;
  return { location: best, distanceMeters: bestDistance };
}

export function filterLocations(locations, filters) {
  const query = filters.query.trim().toLowerCase();
  const jamaicaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Jamaica', year: 'numeric', month: '2-digit', day: '2-digit' });
  return locations.filter(location => {
    const date = location.latest_report_at ? jamaicaDate.format(new Date(location.latest_report_at)) : '';
    return (location.report_count ? filters.reports : filters.empty)
      && (filters.status === 'all' || (location.report_count > 0 && location.status === filters.status))
      && (filters.category === 'all' || location.issue_types.includes(filters.category))
      && (!filters.from || (date && date >= filters.from))
      && (!filters.to || (date && date <= filters.to))
      && (!query || [location.name, ...location.issue_types].join(' ').toLowerCase().includes(query));
  });
}
export function importChanges(points, locations) {
  const active = new Set(locations.filter(location => location.is_active).map(location => location.id));
  const incoming = new Set(points.map(point => point.id));
  return { added: points.filter(point => !active.has(point.id)).length,
    retained: points.filter(point => active.has(point.id)).length,
    archived: [...active].filter(id => !incoming.has(id)).length };
}

