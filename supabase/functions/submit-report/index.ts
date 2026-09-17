import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const url = Deno.env.get('SUPABASE_URL')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const publishable = 'sb_publishable_yIp0_PrdNKyFzlrCe4-fPg_VUosGs29';
const types = ['Garbage buildup','Illegal dumping','Damaged / missing bin','Blocked drain','Lighting issue','Signage issue','Vagrancy / loitering'];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
function text(form: FormData, name: string, limit = 10000) {
  const value = form.get(name) ?? '';
  if (typeof value !== 'string' || value.length > limit) throw fail('Invalid or oversized field.');
  return value.trim();
}
function mime(bytes: Uint8Array) {
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return 'image/png';
  const ascii = new TextDecoder().decode(bytes);
  if (/^GIF8[79]a/.test(ascii)) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8,12)==='WEBP') return 'image/webp';
  throw fail('Photos must be JPG, PNG, WEBP, or GIF images.');
}
Deno.serve(async req => {
  const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method==='OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method!=='POST') return reply({ error: 'Method not allowed.' },405);
  // Intentionally public reporting. A publishable key identifies this app; no admin privileges are accepted from the request.
  if (req.headers.get('apikey')!==publishable) return reply({error:'Invalid app key.'},401);
  const uploaded: string[]=[];
  try {
    const limit=52*1024*1024;
    if (Number(req.headers.get('content-length'))>limit) throw fail('Report is too large.',413);
    let size=0;
    const bounded=req.body?.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.byteLength;if(size>limit)throw fail('Report is too large.',413);controller.enqueue(chunk);}}));
    const form=await new Response(bounded,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();
    const location=text(form,'location_id',500), description=text(form,'description'), method=text(form,'contact_method',20);
    const contact=method==='none'?'':text(form,'contact_value',300);
    const issues=[...new Set(form.getAll('issue_types'))];
    if (!issues.length || issues.some(type=>typeof type!=='string'||!types.includes(type))) throw fail('Choose at least one valid issue type.');
    if (!['none','email','phone'].includes(method)) throw fail('Choose a valid contact method.');
    if (method==='email'&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact)) throw fail('Enter a valid email address.');
    if (method==='phone'&&contact.replace(/\D/g,'').length<7) throw fail('Enter a valid phone number.');
    const {data:active,error:locationError}=await db.from('locations').select('id').eq('id',location).eq('is_active',true).maybeSingle();
    if(locationError) throw locationError;
    if(!active) throw fail('Choose an active location.');
    const photos=form.getAll('photos').filter((f): f is File=>f instanceof File && f.size>0);
    if(photos.length>5)throw fail('Choose up to five photos.');
    const extensions: Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
    // Validate every photo before uploading any of them.
    const validated=[];
    for(const file of photos){
      if(file.size>10*1024*1024)throw fail('Each photo must be 10 MB or smaller.');
      validated.push({file,type:mime(new Uint8Array(await file.slice(0,12).arrayBuffer()))});
    }
    const id=crypto.randomUUID(), records=[];
    for(const {file,type} of validated){
      const key=`${id}/${crypto.randomUUID()}.${extensions[type]}`;
      const {error}=await db.storage.from('report-photos').upload(key,file,{contentType:type,upsert:false});
      if(error)throw error;
      uploaded.push(key); records.push({storage_key:key,original_name:file.name.slice(0,255),content_type:type});
    }
    const {data,error}=await db.rpc('submit_report',{p_id:id,p_location:location,p_description:description,p_types:issues,p_method:method,p_contact:contact,p_photos:records});
    if(error)throw error;
    return reply(data,201);
  }catch(error){
    if(uploaded.length){const {error:cleanup}=await db.storage.from('report-photos').remove(uploaded);if(cleanup)console.error('Photo cleanup failed',cleanup.message);}
    const status=error.status||500;
    if(status>=500)console.error(error.message);
    return reply({error:status>=500?'Could not submit your report. Please try again.':error.message},status);
  }
});
