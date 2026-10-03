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
  const context = checked(await supabase.rpc('current_admin_context'));
  return context?.role ? { ...user, adminRole: context.role, canManageAccounts: context.can_manage_accounts } : null;
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
async function adminAccountAction(body) {
  const { data, error } = await supabase.functions.invoke('admin-accounts', { body });
  if (error) {
    let detail = error.message;
    if (error.context?.json) { try { detail = (await error.context.json()).error || detail; } catch {} }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export const loadAccounts = () => adminAccountAction({ action: 'list' });
export const registerAccount = (email, password, role) => adminAccountAction({ action: 'register', email, password, role });
export const setAccountRole = (userId, role) => adminAccountAction({ action: 'set_role', user_id: userId, role });
export const deleteAccount = userId => adminAccountAction({ action: 'delete_account', user_id: userId });
export const deleteReport = reportId => adminAccountAction({ action: 'delete_report', report_id: reportId });
export const deleteLocation = locationId => adminAccountAction({ action: 'delete_location', location_id: locationId });
export const deleteLocations = locationIds => adminAccountAction({ action: 'delete_locations', location_ids: locationIds });
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
export async function accessReport(token, action = 'view', message = '') {
  const { data, error } = await supabase.functions.invoke('report-access', { body: { token, action, message } });
  if (error) {
    let detail = error.message;
    if (error.context?.json) { try { detail = (await error.context.json()).error || detail; } catch {} }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function reviewReport(id, status, notes) {
  checked(await supabase.rpc('review_report', { p_id: id, p_status: status, p_notes: notes }));
}
export async function addAdminFollowup(id, message) {
  checked(await supabase.rpc('admin_add_report_followup', { p_report_id: id, p_message: message }));
}
export async function loadMapData() {
  return { locations: (await allRows('location_map')).filter(row => row.is_active).sort((a,b) => a.name.localeCompare(b.name)), issue_types: ISSUE_TYPES };
}
export async function locationHistory(id, offset = 0) {
  return checked(await supabase.from('issue_reports')
    .select('id,description,issue_types,issue_other,status,submitted_at,issue_photos(id,storage_key,original_name)')
    .eq('location_id', id).order('submitted_at', { ascending: false }).order('id').range(offset, offset + 19))
    .map(row => ({ ...row, photos: row.issue_photos.map(photo => ({
      filename: photo.original_name,
      url: supabase.storage.from('report-photos').getPublicUrl(photo.storage_key).data.publicUrl,
    })) }));
}
export async function previewKml(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('KML files must be 2 MB or smaller.');
  const kml = await file.text();
  return { filename: file.name, kml, points: parseKml(kml) };
}
export async function publishInventory(inventory) {
  checked(await supabase.rpc('replace_locations', { p_points: inventory.points, p_filename: inventory.filename, p_kml: inventory.kml }));
}
export async function loadImports(offset = 0) {
  return checked(await supabase.from('location_imports').select('id,filename,imported_at,is_current,point_count')
    .order('imported_at', { ascending: false }).order('id').range(offset, offset + 19));
}
export async function restoreInventory(id) {
  checked(await supabase.rpc('restore_location_import', { p_id: id }));
}
export async function updateLocation(location) {
  checked(await supabase.rpc('admin_update_location', {
    p_id: location.id,p_name: location.name,p_description: location.description,
    p_latitude: location.latitude,p_longitude: location.longitude,p_altitude: location.altitude,
    p_is_active: location.is_active,
  }));
}
export async function loadActivity(offset = 0) {
  return checked(await supabase.from('admin_activity').select('*').order('occurred_at', { ascending: false }).order('id').range(offset, offset + 49));
}

export async function loadReportPage({ page = 0, search = '', status = 'all' } = {}) {
  let query = supabase.from('admin_report_queue').select('id,location_id,location_name,issue_types,issue_other,status,submitted_at,followup_count', { count: 'exact' });
  if (search.trim()) query = query.ilike('search_text', '%' + search.trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') + '%');
  if (status !== 'all') query = query.eq('status', status);
  const response = await query.order('submitted_at', { ascending: false }).order('id').range(page * 20, page * 20 + 19);
  checked(response);
  return { reports: response.data, count: response.count };
}
export async function loadReportDetail(id) {
  const row = checked(await supabase.from('issue_reports')
    .select('*,locations(name),report_private(*),issue_photos(*),report_followups(*)').eq('id', id).single());
  return { ...row, ...row.report_private, location_name: row.locations.name,
    photos: row.issue_photos.map(photo => ({ filename: photo.original_name,
      url: supabase.storage.from('report-photos').getPublicUrl(photo.storage_key).data.publicUrl })),
    followups: row.report_followups.sort((a,b) => a.created_at.localeCompare(b.created_at)) };
}
export async function loadAdminLocations() { return allRows('location_map'); }
