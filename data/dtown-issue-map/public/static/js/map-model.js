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
      && (!query || [location.id, location.name, ...location.issue_types].join(' ').toLowerCase().includes(query));
  });
}
export function importChanges(points, locations) {
  const active = new Set(locations.filter(location => location.is_active).map(location => location.id));
  const incoming = new Set(points.map(point => point.id));
  return { added: points.filter(point => !active.has(point.id)).length,
    retained: points.filter(point => active.has(point.id)).length,
    archived: [...active].filter(id => !incoming.has(id)).length };
}

