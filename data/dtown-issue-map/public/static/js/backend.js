import { createClient } from '@supabase/supabase-js';
import { ISSUE_TYPES, parseKml } from './model.js';
export const supabase = createClient(
  'https://wkwnuzmsohnanxntpvze.supabase.co',
  'sb_publishable_yIp0_PrdNKyFzlrCe4-fPg_VUosGs29',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
function checked({ data, error }) { if (error) throw error; return data; }
async function allRows(table, columns = '*') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = checked(await supabase.from(table).select(columns).order(table === 'report_private' ? 'report_id' : 'id').range(offset, offset + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
export async function adminSession() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const permitted = checked(await supabase.rpc('is_admin'));
  return permitted ? user : null;
}
export async function signIn(email, password) {
  checked(await supabase.auth.signInWithPassword({ email, password }));
  if (!await adminSession()) {
    await supabase.auth.signOut();
    throw new Error('This account does not have admin access.');
  }
}
export async function signOut() { checked(await supabase.auth.signOut({ scope: 'local' })); }
export async function changePassword(password) {
  if (password.length < 12) throw new Error('Use at least 12 characters.');
  checked(await supabase.auth.updateUser({ password }));
}
export async function loadData(admin = false) {
  if (admin && !await adminSession()) throw Object.assign(new Error('Please sign in with an admin account.'), { status: 401 });
  const [locations, reports, photos, privateRows] = await Promise.all([
    allRows('locations'), allRows('issue_reports'), allRows('issue_photos'), admin ? allRows('report_private') : [],
  ]);
  const privateById = new Map(privateRows.map(row => [row.report_id, row]));
  const photosByReport = new Map();
  for (const photo of photos) {
    if (!photosByReport.has(photo.report_id)) photosByReport.set(photo.report_id, []);
    photosByReport.get(photo.report_id).push({ id: photo.id, filename: photo.original_name, content_type: photo.content_type, uploaded_at: photo.uploaded_at, url: supabase.storage.from('report-photos').getPublicUrl(photo.storage_key).data.publicUrl });
  }
  const byLocation = new Map();
  for (const row of reports.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))) {
    const { report_id, ...privateFields } = privateById.get(row.id) || {};
    const report = { ...row, ...(admin ? privateFields : {}), photos: photosByReport.get(row.id) || [] };
    if (!byLocation.has(row.location_id)) byLocation.set(row.location_id, []);
    byLocation.get(row.location_id).push(report);
  }
  const items = locations.filter(l => admin || l.is_active).sort((a,b) => a.name.localeCompare(b.name)).map(location => {
    const history = byLocation.get(location.id) || [];
    return { ...location, code_label: location.id, reports: history,
      status: history.some(r => r.status === 'down') ? 'down' : !history.length || history.some(r => r.status === 'pending') ? 'pending' : 'fixed',
      issue_types: [...new Set(history.flatMap(r => r.issue_types))].sort(), report_count: history.length,
      open_report_count: history.filter(r => r.status !== 'fixed').length,
      photo_count: history.reduce((n,r) => n + r.photos.length, 0), latest_report_at: history[0]?.submitted_at || '',
    };
  });
  const counts = { all: items.length, pending: 0, down: 0, fixed: 0, reports: 0, open_reports: 0, photos: 0 };
  const bounds = { min_lat: null, max_lat: null, min_lng: null, max_lng: null };
  for (const l of items) {
    counts[l.status]++; counts.reports += l.report_count; counts.open_reports += l.open_report_count; counts.photos += l.photo_count;
    for (const [axis, n] of [['lat',l.latitude],['lng',l.longitude]]) {
      bounds[`min_${axis}`] = Math.min(bounds[`min_${axis}`] ?? n, n);
      bounds[`max_${axis}`] = Math.max(bounds[`max_${axis}`] ?? n, n);
    }
  }
  return { locations: items, counts, bounds, issue_types: ISSUE_TYPES };
}
export async function submitReport(form) {
  const { data, error } = await supabase.functions.invoke('submit-report', { body: form });
  if (error) {
    let message = error.message;
    if (error.context?.json) { try { message = (await error.context.json()).error || message; } catch {} }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function reviewReport(id, status, notes) {
  checked(await supabase.rpc('review_report', { p_id: id, p_status: status, p_notes: notes }));
}
export async function importKml(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('KML files must be 2 MB or smaller.');
  const kml = await file.text();
  const points = parseKml(kml);
  checked(await supabase.rpc('replace_locations', { p_points: points, p_filename: file.name, p_kml: kml }));
  return points.length;
}
