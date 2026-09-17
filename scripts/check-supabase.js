import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const url = 'https://wkwnuzmsohnanxntpvze.supabase.co';
const key = 'sb_publishable_yIp0_PrdNKyFzlrCe4-fPg_VUosGs29';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const publicClient = createClient(url, key, options);
const admin = createClient(url, key, options);
const credentials = existsSync('ADMIN-CREDENTIALS.local.txt') ? readFileSync('ADMIN-CREDENTIALS.local.txt', 'utf8') : '';
const email = process.env.DTOWN_TEST_ADMIN_EMAIL || credentials.match(/^Email: (.+)$/m)?.[1]?.trim();
const password = process.env.DTOWN_TEST_ADMIN_PASSWORD || credentials.match(/^Initial password: (.+)$/m)?.[1]?.trim();
const { data: locations, error: locationError } = await publicClient.from('locations').select('*');
assert.ifError(locationError); assert.ok(locations.length > 0, 'The public map must have active locations.');
const privateAttempt = await publicClient.from('report_private').select('*'); assert.ok(privateAttempt.error);
const rolesAttempt = await publicClient.from('admin_members').select('*'); assert.ok(rolesAttempt.error);
const forgery = await publicClient.from('issue_reports').insert({ id: crypto.randomUUID(), location_id: locations[0].id, status: 'fixed' }); assert.ok(forgery.error);
const directRpc = await publicClient.rpc('submit_report', { p_id: crypto.randomUUID(), p_location: locations[0].id, p_description: 'Unauthorized direct RPC', p_types: ['Blocked drain'], p_method: 'none', p_contact: '', p_photos: [] }); assert.ok(directRpc.error);
if (!email || !password) {
  console.log('Live public-data and access-control checks passed. Admin sign-in skipped: provide DTOWN_TEST_ADMIN_EMAIL and DTOWN_TEST_ADMIN_PASSWORD to check it.');
  process.exit(0);
}
const { error: loginError } = await admin.auth.signInWithPassword({ email, password }); assert.ifError(loginError);
const role = await admin.rpc('is_admin'); assert.ifError(role.error); assert.equal(role.data, true);
const privateRead = await admin.from('report_private').select('*'); assert.ifError(privateRead.error);
await admin.auth.signOut({ scope: 'local' });
console.log('Live checks passed: public locations, private-data protection, blocked direct writes and admin sign-in.');
