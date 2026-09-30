import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const url = Deno.env.get('SUPABASE_URL')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const publishable = 'sb_publishable_yIp0_PrdNKyFzlrCe4-fPg_VUosGs29';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const fail = (message: string,status=400)=>Object.assign(new Error(message),{status});
const hex = (bytes: Uint8Array)=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
async function hash(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
}

Deno.serve(async req=>{
  const reply=(body: unknown,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'},
  });
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({error:'Method not allowed.'},405);
  if(req.headers.get('apikey')!==publishable)return reply({error:'Invalid app key.'},401);
  try {
    const body=await req.json();
    const token=typeof body.token==='string'?body.token:'';
    if(!/^[0-9a-f]{64}$/.test(token))throw fail('This report link is invalid.',404);
    const {data:privateRow,error:privateError}=await db.from('report_private')
      .select('report_id').eq('access_token_hash',await hash(token)).maybeSingle();
    if(privateError)throw privateError;
    if(!privateRow)throw fail('This report link is invalid or no longer available.',404);
    if(body.action==='followup'){
      const message=typeof body.message==='string'?body.message.trim():'';
      if(!message||message.length>2000)throw fail('Enter a follow-up of 2,000 characters or fewer.');
      const {error}=await db.from('report_followups').insert({
        report_id:privateRow.report_id,author:'reporter',message,
      });
      if(error)throw error;
    } else if(body.action!=='view') throw fail('Invalid action.');
    const [{data:report,error:reportError},{data:followups,error:followupError}]=await Promise.all([
      db.from('issue_reports').select('id,description,issue_types,issue_other,status,submitted_at,updated_at,locations(name),issue_photos(storage_key,original_name)')
        .eq('id',privateRow.report_id).single(),
      db.from('report_followups').select('id,author,message,created_at').eq('report_id',privateRow.report_id)
        .order('created_at').order('id'),
    ]);
    if(reportError)throw reportError;
    if(followupError)throw followupError;
    return reply({
      location_name:report.locations.name,description:report.description,issue_types:report.issue_types,
      issue_other:report.issue_other,status:report.status,submitted_at:report.submitted_at,updated_at:report.updated_at,
      photos:report.issue_photos.map(photo=>({
        filename:photo.original_name,
        url:db.storage.from('report-photos').getPublicUrl(photo.storage_key).data.publicUrl,
      })),
      followups,
    });
  } catch(error) {
    const status=error.status||500;
    if(status>=500)console.error(error.message);
    return reply({error:status>=500?'Could not load this report. Please try again.':error.message},status);
  }
});
