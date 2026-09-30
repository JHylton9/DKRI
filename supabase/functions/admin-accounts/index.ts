import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const url=Deno.env.get('SUPABASE_URL')!;
const publishable='sb_publishable_yIp0_PrdNKyFzlrCe4-fPg_VUosGs29';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});

Deno.serve(async req=>{
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({error:'Method not allowed.'},405);
  try {
    const authorization=req.headers.get('authorization')||'';
    const callerClient=createClient(url,publishable,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:userError}=await callerClient.auth.getUser();
    if(userError||!user)throw fail('Sign in again to continue.',401);
    const {data:member,error:memberError}=await service.from('admin_members').select('role').eq('user_id',user.id).maybeSingle();
    if(memberError)throw memberError;
    if(member?.role!=='owner')throw fail('Owner access is required to manage accounts.',403);
    const body=await req.json();
    if(body.action==='list'){
      const [{data:members,error:membersError},{data:users,error:usersError}]=await Promise.all([
        service.from('admin_members').select('user_id,role,created_at,updated_at').order('created_at'),
        service.auth.admin.listUsers({page:1,perPage:1000}),
      ]);
      if(membersError)throw membersError;if(usersError)throw usersError;
      const roles=new Map(members.map(row=>[row.user_id,row]));
      return reply({accounts:users.users.map(account=>({
        id:account.id,email:account.email||'',created_at:account.created_at,last_sign_in_at:account.last_sign_in_at,
        role:roles.get(account.id)?.role||null,access_updated_at:roles.get(account.id)?.updated_at||null,
      })).sort((a,b)=>a.email.localeCompare(b.email)),current_user_id:user.id});
    }
    if(body.action==='invite'){
      const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
      const role=body.role;
      if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw fail('Enter a valid email address.');
      if(!['owner','administrator'].includes(role))throw fail('Choose a valid account role.');
      const {data,error}=await service.auth.admin.inviteUserByEmail(email);
      if(error)throw error;
      const invited=data.user;
      const {error:accessError}=await service.from('admin_members').upsert({user_id:invited.id,role,updated_by:user.id});
      if(accessError){await service.auth.admin.deleteUser(invited.id);throw accessError;}
      await service.from('admin_activity').insert({actor_id:user.id,action:'Account invited',target_id:invited.id,detail:{email,role}});
      return reply({success:true});
    }
    if(body.action==='set_role'){
      const userId=typeof body.user_id==='string'?body.user_id:'';
      const role=body.role===null?null:body.role;
      if(!/^[0-9a-f-]{36}$/i.test(userId))throw fail('Choose a valid account.');
      if(userId===user.id)throw fail('You cannot change your own access. Ask another owner.');
      if(role!==null&&!['owner','administrator'].includes(role))throw fail('Choose a valid account role.');
      if(role===null){
        const {error}=await service.from('admin_members').delete().eq('user_id',userId);if(error)throw error;
      }else{
        const {error}=await service.from('admin_members').upsert({user_id:userId,role,updated_at:new Date().toISOString(),updated_by:user.id});if(error)throw error;
      }
      await service.from('admin_activity').insert({actor_id:user.id,action:role?'Account role updated':'Account access revoked',target_id:userId,detail:{role}});
      return reply({success:true});
    }
    throw fail('Invalid account action.');
  }catch(error){
    const status=error.status||500;if(status>=500)console.error(error.message);
    return reply({error:status>=500?'Could not manage accounts. Please try again.':error.message},status);
  }
});
