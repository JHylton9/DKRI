import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const url=Deno.env.get('SUPABASE_URL')!;
const publishable='sb_publishable_yIp0_PrdNKyFzlrCe4-fPg_VUosGs29';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const primaryOwner='jaydonhylton17@gmail.com';
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
    const body=await req.json();
    if(!member)throw fail('Administrator access is required.',403);
    if(body.action==='delete_report'){
      const reportId=typeof body.report_id==='string'?body.report_id:'';
      if(!reportId||reportId.length>500)throw fail('Choose a valid report.');
      const [{data:report,error:reportError},{data:photos,error:photosError}]=await Promise.all([
        service.from('issue_reports').select('id,location_id').eq('id',reportId).maybeSingle(),
        service.from('issue_photos').select('storage_key').eq('report_id',reportId),
      ]);
      if(reportError)throw reportError;if(photosError)throw photosError;
      if(!report)throw fail('Report not found.',404);
      if(photos.length){const {error}=await service.storage.from('report-photos').remove(photos.map(photo=>photo.storage_key));if(error)throw error;}
      const {error:deleteError}=await service.from('issue_reports').delete().eq('id',reportId);if(deleteError)throw deleteError;
      await service.from('admin_activity').insert({actor_id:user.id,action:'Report deleted',target_id:reportId,detail:{location_id:report.location_id,photo_count:photos.length}});
      return reply({success:true});
    }
    if(body.action==='delete_location'){
      const locationId=typeof body.location_id==='string'?body.location_id.trim():'';
      if(!locationId||locationId.length>500)throw fail('Choose a valid location.');
      const {data:location,error:locationError}=await service.from('locations').select('id,name').eq('id',locationId).maybeSingle();
      if(locationError)throw locationError;
      if(!location)throw fail('Location not found.',404);
      const {data:reports,error:reportsError}=await service.from('issue_reports').select('id').eq('location_id',locationId);
      if(reportsError)throw reportsError;
      let photoCount=0;
      for(const report of reports||[]){
        const {data:photos,error:photosError}=await service.from('issue_photos').select('storage_key').eq('report_id',report.id);
        if(photosError)throw photosError;
        if(photos?.length){
          const {error}=await service.storage.from('report-photos').remove(photos.map(photo=>photo.storage_key));
          if(error)throw error;
          photoCount+=photos.length;
        }
        const {error:deleteReportError}=await service.from('issue_reports').delete().eq('id',report.id);
        if(deleteReportError)throw deleteReportError;
      }
      const {error:deleteLocationError}=await service.from('locations').delete().eq('id',locationId);
      if(deleteLocationError)throw deleteLocationError;
      await service.from('admin_activity').insert({actor_id:user.id,action:'Location deleted',target_id:locationId,detail:{name:location.name,report_count:reports?.length||0,photo_count:photoCount}});
      return reply({success:true});
    }
    if(member.role!=='owner'||user.email?.toLowerCase()!==primaryOwner)throw fail('This account cannot manage accounts.',403);
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
    if(body.action==='register'){
      const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
      const password=typeof body.password==='string'?body.password:'';
      const role=body.role;
      if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw fail('Enter a valid email address.');
      if(password.length<8||password.length>128)throw fail('Use an initial password between 8 and 128 characters.');
      if(!['owner','administrator'].includes(role))throw fail('Choose a valid account role.');
      const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true});
      if(error)throw error;
      const registered=data.user;
      const {error:accessError}=await service.from('admin_members').upsert({user_id:registered.id,role,updated_by:user.id});
      if(accessError){await service.auth.admin.deleteUser(registered.id);throw accessError;}
      await service.from('admin_activity').insert({actor_id:user.id,action:'Account registered',target_id:registered.id,detail:{email,role}});
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
    if(body.action==='delete_account'){
      const userId=typeof body.user_id==='string'?body.user_id:'';
      if(!/^[0-9a-f-]{36}$/i.test(userId))throw fail('Choose a valid account.');
      if(userId===user.id)throw fail('You cannot delete your own account.');
      const {data:target,error:targetError}=await service.auth.admin.getUserById(userId);
      if(targetError||!target.user)throw fail('Account not found.',404);
      const email=target.user.email||'';
      const {error:deleteError}=await service.auth.admin.deleteUser(userId);
      if(deleteError)throw deleteError;
      await service.from('admin_activity').insert({actor_id:user.id,action:'Account deleted',target_id:userId,detail:{email}});
      return reply({success:true});
    }
    throw fail('Invalid account action.');
  }catch(error){
    const status=error.status||500;if(status>=500)console.error(error.message);
    return reply({error:status>=500?'Could not manage accounts. Please try again.':error.message},status);
  }
});
