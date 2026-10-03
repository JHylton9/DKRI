import L from 'leaflet';
import { adminSession, loadReportPage, loadReportDetail, loadAdminLocations, updateLocation, deleteLocation, deleteLocations, reviewReport, addAdminFollowup, deleteReport, previewKml, publishInventory, loadImports, restoreInventory, loadActivity, loadAccounts, registerAccount, setAccountRole, deleteAccount, signOut, changePassword } from './backend.js';
import { escapeHtml as h, formatDate, handleAction } from './shared.js';
import { importChanges } from './map-model.js';
const $ = id => document.getElementById(id);
let locations=[], reports=[], selectedId='', page=0, inventory=null, versions=[], activity=[], restoreId='', deleteAccountId='', editLocationId='', deleteLocationId='', bulkSelected=new Set();
let total=0, queueRequest=0, detailRequest=0, searchTimer;
let importsLoaded=false, activityLoaded=false, accountsLoaded=false, locationEditorLoaded=false, ready=false, restoreBusy=false, currentUser=null;
let editorMap=null,editorMarker=null;
function message(id,text,error=false) { $(id).textContent=text; $(id).className='form-message '+(error?'is-error':'is-success'); }
function badge(status) { return '<span class="status-badge status-badge--'+h(status)+'">'+h(status)+'</span>'; }
function issueLabel(report) { return report.issue_types.map(type=>type==='Other'&&report.issue_other?'Other: '+report.issue_other:type).join(', '); }
function followups(rows) { return rows.map(row=>'<article class="followup"><div><strong>'+(row.author==='admin'?'Review team':'Reporter')+'</strong><time>'+h(formatDate(row.created_at))+'</time></div><p>'+h(row.message)+'</p></article>').join('')||'<p class="muted">No public followups yet.</p>'; }
function renderQueue() {
  $('queue-summary').textContent=total+' reports matching your filters';
  $('reports-table-body').innerHTML=reports.map(report=>'<tr class="'+(report.id===selectedId?'is-selected':'')+'"><td><strong>'+h(report.location_name)+'</strong></td><td>'+h(issueLabel(report)||'Not recorded')+(report.followup_count?'<div class="metadata">'+report.followup_count+' followup'+(report.followup_count===1?'':'s')+'</div>':'')+'</td><td>'+badge(report.status)+'</td><td>'+h(formatDate(report.submitted_at))+'</td><td><button data-review="'+h(report.id)+'" aria-label="Review report for '+h(report.location_name)+'">Review</button></td></tr>').join('') || '<tr><td colspan="5" class="empty-state">No reports match your filters.</td></tr>';
  $('queue-page').textContent=total+' results · Page '+(page+1)+' of '+Math.max(1,Math.ceil(total/20));
  $('queue-previous').disabled=page===0; $('queue-next').disabled=(page+1)*20>=total;
}
async function selectReport(id, focus=true) {
  const request=++detailRequest;
  let report;
  try { report=await loadReportDetail(id); } catch(error) { warning(error); return; }
  if(request!==detailRequest) return;
  selectedId=id; $('review-panel').hidden=false; $('selected-report-id').value=id;
  $('delete-report-button').hidden=false;
  $('report-facts').innerHTML='<dt>Location</dt><dd>'+h(report.location_name)+'</dd><dt>Report ID</dt><dd><code>'+h(report.id)+'</code></dd><dt>Submitted</dt><dd>'+h(formatDate(report.submitted_at))+'</dd><dt>Issue types</dt><dd>'+h(issueLabel(report))+'</dd><dt>Description</dt><dd>'+h(report.description||'Photo provided without a description.')+'</dd><dt>Contact</dt><dd>'+h(report.contact_value||'No contact details provided.')+'</dd>';
  $('selected-status').value=report.status; $('selected-admin-notes').value=report.admin_notes||'';
  $('selected-followup').value=''; $('selected-followups').innerHTML=followups(report.followups);
  $('selected-photo-grid').innerHTML=report.photos.map(photo=>'<a href="'+h(photo.url)+'" target="_blank" rel="noreferrer"><img loading="lazy" src="'+h(photo.url)+'" alt="'+h(photo.filename)+'"></a>').join('') || '<p class="muted">No photos attached.</p>';
  renderQueue();
  if(focus) { $('review-panel').scrollIntoView({block:'start',behavior:'instant'}); $('selected-status').focus({preventScroll:true}); message('status-message',''); }
}
async function reloadQueue() {
  const request=++queueRequest;
  $('queue-summary').textContent='Loading reports…';
  const data=await loadReportPage({page,search:$('search-input').value,status:$('status-filter').value});
  if(request!==queueRequest) return;
  total=data.count; reports=data.reports;
  if(page>0 && page*20>=total) {page=0;return reloadQueue();}
  renderQueue();
}
async function renderImports(reset=false) {
  if(reset) versions=[];
  const chunk=await loadImports(versions.length); versions.push(...chunk); importsLoaded=true;
  $('import-history').innerHTML=versions.map(version=>'<tr><td>'+h(version.filename)+'</td><td>'+h(formatDate(version.imported_at))+'</td><td>'+(version.point_count??'Legacy')+'</td><td><span class="pill">'+(version.is_current?'Current':'Archived')+'</span></td><td>'+(version.point_count&&!version.is_current?'<button data-restore="'+h(version.id)+'">Restore</button>':'<span class="metadata">'+(version.is_current?'Published':'Original KML retained')+'</span>')+'</td></tr>').join('') || '<tr><td colspan="5">No published inventories.</td></tr>';
  $('imports-more').hidden=chunk.length<20;
}
function visibleLocationIds() {
  const query=$('edit-location-search').value.trim().toLowerCase();
  return locations.filter(location=>!query||location.name.toLowerCase().includes(query)).map(location=>location.id);
}
function updateBulkToolbar() {
  $('delete-selected-locations').disabled=bulkSelected.size===0;
  const visible=visibleLocationIds();
  $('select-visible-locations').checked=visible.length>0&&visible.every(id=>bulkSelected.has(id));
}
function populateLocationEditor(id='') {
  if (id) editLocationId=id;
  const query=$('edit-location-search').value.trim().toLowerCase();
  const filtered=locations.filter(location=>!query||location.name.toLowerCase().includes(query));
  const sorted=filtered.slice().sort((a,b)=>a.name.localeCompare(b.name));
  $('edit-location-list').innerHTML=sorted.length?sorted.map(location=>'<div class="picker-item"><label class="picker-bulk"><input type="checkbox" data-bulk-location="'+h(location.id)+'" '+((bulkSelected.has(location.id))?'checked':'')+'><span class="sr-only">Select '+h(location.name)+'</span></label><button type="button" class="picker-row" role="option" aria-selected="'+String(location.id===editLocationId)+'" data-location-id="'+h(location.id)+'"><span><strong>'+h(location.name)+'</strong>'+(location.is_active?'':'<span class="picker-meta">Archived</span>')+'</span></button></div>').join(''):'<p class="muted empty-picker">No matching locations</p>';
  if (editLocationId && !sorted.some(location=>location.id===editLocationId)) editLocationId='';
  updateBulkToolbar();
  renderLocationEditor();
}
function setEditorCoordinates(latitude,longitude,moveMap=true) {
  $('edit-location-latitude').value=Number(latitude).toFixed(6);
  $('edit-location-longitude').value=Number(longitude).toFixed(6);
  editorMarker?.setLatLng([latitude,longitude]);
  if(moveMap)editorMap?.panTo([latitude,longitude]);
}
function ensureEditorMap(location) {
  const point=[location.latitude,location.longitude];
  if(!editorMap){
    editorMap=L.map('location-coordinate-map',{zoomControl:true}).setView(point,18);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(editorMap);
    editorMarker=L.marker(point,{draggable:true}).addTo(editorMap);
    editorMarker.on('dragend',()=>{const point=editorMarker.getLatLng();setEditorCoordinates(point.lat,point.lng,false);});
    editorMap.on('click',event=>setEditorCoordinates(event.latlng.lat,event.latlng.lng));
  }else{editorMap.setView(point,18);editorMarker.setLatLng(point);}
  requestAnimationFrame(()=>editorMap.invalidateSize({pan:false}));
}
function renderLocationEditor() {
  const location=locations.find(item=>item.id===editLocationId);
  $('location-edit-fields').hidden=!location;
  $('location-edit-empty').hidden=Boolean(location);
  message('location-edit-message','');
  if(!location)return;
  $('edit-location-name').value=location.name;
  $('edit-location-description').value=location.description||'';
  $('edit-location-latitude').value=location.latitude;
  $('edit-location-longitude').value=location.longitude;
  $('edit-location-altitude').value=location.altitude;
  $('edit-location-active').checked=location.is_active;
  $('edit-location-status').textContent=location.is_active?'Active':'Archived';
  $('edit-location-reports').textContent=location.report_count+' report'+(location.report_count===1?'':'s');
  $('edit-location-updated').textContent='Updated '+formatDate(location.updated_at);
  ensureEditorMap(location);
}
async function loadLocationEditor(id='') {
  locations=await loadAdminLocations();locationEditorLoaded=true;
  $('admin-location-count').textContent=locations.length.toLocaleString()+' mapped locations';
  populateLocationEditor(id);
}
async function renderActivity(reset=false) {
  if(reset) activity=[];
  const chunk=await loadActivity(activity.length); activity.push(...chunk); activityLoaded=true;
  $('activity-rows').innerHTML=activity.map(row=>'<tr><td>'+h(formatDate(row.occurred_at))+'</td><td>'+h(row.action)+(row.detail.filename?'<div class="metadata">'+h(row.detail.filename)+'</div>':'')+(row.detail.status?'<div class="metadata">'+h(row.detail.previous_status)+' → '+h(row.detail.status)+'</div>':'')+'</td><td><code>'+h(row.actor_id||'System')+'</code></td><td><code>'+h(row.target_id)+'</code></td></tr>').join('') || '<tr><td colspan="4" class="empty-state">No activity recorded yet. New staff changes will appear here.</td></tr>';
  $('activity-more').hidden=chunk.length<50;
}
async function renderAccounts() {
  const data=await loadAccounts();accountsLoaded=true;
  $('accounts-table-body').innerHTML=data.accounts.map(account=>'<tr><td><strong>'+h(account.email||'No email')+'</strong>'+(account.id===data.current_user_id?'<div class="metadata">Current account</div>':'')+'</td><td>'+(account.last_sign_in_at?h(formatDate(account.last_sign_in_at)):'Never')+'</td><td><select data-account-role="'+h(account.id)+'" '+(account.id===data.current_user_id?'disabled':'')+'><option value="" '+(!account.role?'selected':'')+'>No access</option><option value="administrator" '+(account.role==='administrator'?'selected':'')+'>Administrator</option><option value="owner" '+(account.role==='owner'?'selected':'')+'>Owner</option></select><span class="metadata autosave-note">Saves automatically</span></td><td><button class="button--danger" data-delete-account="'+h(account.id)+'" data-account-email="'+h(account.email||'this account')+'" '+(account.id===data.current_user_id?'disabled':'')+'>Delete</button></td></tr>').join('')||'<tr><td colspan="4" class="empty-state">No accounts found.</td></tr>';
}
async function section() {
  const requested=location.hash.slice(1);
  const allowed=['reports','locations','activity',...(currentUser?.canManageAccounts?['accounts','password']:[])];
  const name=allowed.includes(requested)?requested:'reports';
  document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==name);
  document.querySelectorAll('[data-section]').forEach(link=>link.dataset.section===name?link.setAttribute('aria-current','page'):link.removeAttribute('aria-current'));
  if(!ready) return;
  try {
    if(name==='locations') {
      if(!locationEditorLoaded) await loadLocationEditor();
      if(!importsLoaded) await renderImports(true);
    }
    if(name==='activity'&&!activityLoaded) await renderActivity(true);
    if(name==='accounts'&&!accountsLoaded) await renderAccounts();
  } catch(error) { warning(error); }
}
function warning(error) { $('admin-warning').hidden=false; $('admin-warning').textContent=error.message||'Could not complete this action.'; }
async function buttonAction(button,action) {
  if(button.disabled) return;
  const text=button.textContent; button.disabled=true; button.textContent='Working…';
  try { await action(); } catch(error) { warning(error); } finally {
    button.disabled=false; button.textContent=text;
    if(button.id==='queue-previous') button.disabled=page===0;
    if(button.id==='queue-next') button.disabled=(page+1)*20>=total;
  }
}
function clearPreview() { inventory=null; $('import-preview').hidden=true; }
function bind() {
  window.addEventListener('hashchange',section);
  $('logout-button').onclick=event=>buttonAction(event.currentTarget,async()=>{await signOut();location.href='/portal';});
  $('refresh-reports').onclick=event=>buttonAction(event.currentTarget,async()=>{await reloadQueue();activityLoaded=false;});
  $('search-input').oninput=()=>{clearTimeout(searchTimer); searchTimer=setTimeout(()=>{page=0;reloadQueue().catch(warning);},200);};
  $('status-filter').onchange=()=>{page=0;reloadQueue().catch(warning);};
  $('queue-previous').onclick=event=>buttonAction(event.currentTarget,async()=>{page--;await reloadQueue();});
  $('queue-next').onclick=event=>buttonAction(event.currentTarget,async()=>{page++;await reloadQueue();});
  $('reports-table-body').onclick=event=>{const button=event.target.closest('[data-review]');if(button)selectReport(button.dataset.review);};
  $('close-review').onclick=()=>{selectedId='';detailRequest++;$('review-panel').hidden=true;renderQueue();};
  $('delete-report-button').onclick=()=>{
    if(!selectedId)return;
    const report=reports.find(item=>item.id===selectedId);
    $('delete-report-description').textContent=report?'Report for '+report.location_name:selectedId;
    $('delete-report-dialog').returnValue='';$('delete-report-dialog').showModal();
  };
  $('report-status-form').onsubmit=event=>handleAction(event,async()=>{
    if(!selectedId) throw new Error('Select a report first.');
    await reviewReport(selectedId,$('selected-status').value,$('selected-admin-notes').value);
    const reply=$('selected-followup').value.trim();
    if(reply) await addAdminFollowup(selectedId,reply);
    await selectReport(selectedId,false);
    await reloadQueue(); activityLoaded=false; message('status-message','Review saved.');
  },'status-message');
  $('password-form').onsubmit=event=>handleAction(event,async()=>{
    if($('new-password').value!==$('confirm-password').value) throw new Error('The passwords do not match.');
    await changePassword($('new-password').value); $('password-form').reset();message('password-message','Password updated.');
  },'password-message');
  $('kml-file').onchange=()=>{clearPreview();message('kml-message','');};
  $('edit-location-search').oninput=()=>populateLocationEditor();
  $('edit-location-list').onclick=event=>{
    const row=event.target.closest('[data-location-id]');if(!row)return;
    editLocationId=row.dataset.locationId;populateLocationEditor();
  };
  $('edit-location-list').onchange=event=>{
    const box=event.target.closest('[data-bulk-location]');if(!box)return;
    if(box.checked) bulkSelected.add(box.dataset.bulkLocation); else bulkSelected.delete(box.dataset.bulkLocation);
    updateBulkToolbar();
  };
  $('select-visible-locations').onchange=event=>{
    const visible=visibleLocationIds();
    if(event.target.checked) visible.forEach(id=>bulkSelected.add(id)); else visible.forEach(id=>bulkSelected.delete(id));
    populateLocationEditor();
  };
  $('delete-selected-locations').onclick=()=>{
    if(!bulkSelected.size)return;
    $('delete-locations-description').textContent=bulkSelected.size+' location'+(bulkSelected.size===1?'':'s')+' selected, including any report history attached to them.';
    $('delete-locations-dialog').returnValue='';$('delete-locations-dialog').showModal();
  };
  for(const id of ['edit-location-latitude','edit-location-longitude'])$(id).onchange=()=>{
    const latitude=Number($('edit-location-latitude').value),longitude=Number($('edit-location-longitude').value);
    if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180)setEditorCoordinates(latitude,longitude);
  };
  $('reset-location-edit').onclick=renderLocationEditor;
  $('delete-location-button').onclick=()=>{
    if(!editLocationId)return;
    const location=locations.find(item=>item.id===editLocationId);
    deleteLocationId=editLocationId;
    $('delete-location-description').textContent=location
      ? location.name+' ('+location.report_count+' report'+(location.report_count===1?'':'s')+')'
      : editLocationId;
    $('delete-location-dialog').returnValue='';$('delete-location-dialog').showModal();
  };
  $('location-edit-form').onsubmit=event=>handleAction(event,async()=>{
    const id=editLocationId;if(!id)throw new Error('Choose a location first.');
    const latitude=Number($('edit-location-latitude').value),longitude=Number($('edit-location-longitude').value),altitude=Number($('edit-location-altitude').value);
    if(!Number.isFinite(latitude)||latitude < -90||latitude > 90)throw new Error('Enter a valid latitude.');
    if(!Number.isFinite(longitude)||longitude < -180||longitude > 180)throw new Error('Enter a valid longitude.');
    if(!Number.isFinite(altitude))throw new Error('Enter a valid altitude.');
    await updateLocation({id,name:$('edit-location-name').value,description:$('edit-location-description').value,latitude,longitude,altitude,is_active:$('edit-location-active').checked});
    await loadLocationEditor(id);activityLoaded=false;message('location-edit-message','Location saved. The public map now reflects this change.');
  },'location-edit-message');
  $('kml-upload-form').onsubmit=event=>handleAction(event,async()=>{
    clearPreview();
    const file=$('kml-file').files[0];if(!file)throw new Error('Choose a KML file.');
    inventory=await previewKml(file); locations=await loadAdminLocations();
    const changes=importChanges(inventory.points,locations);
    $('import-summary').textContent=inventory.filename+' · '+inventory.points.length+' locations · '+changes.added+' added, '+changes.retained+' retained, '+changes.archived+' archived.';
    $('preview-rows').innerHTML=inventory.points.slice(0,10).map(point=>'<tr><td>'+h(point.name)+'</td><td>'+point.latitude.toFixed(6)+'</td><td>'+point.longitude.toFixed(6)+'</td></tr>').join('');
    $('import-preview').hidden=false;message('kml-message','File validated. Review the preview before publishing.');
  },'kml-message');
  $('cancel-import').onclick=()=>{clearPreview();$('kml-upload-form').reset();message('kml-message','Import cancelled. The map has not changed.');};
  $('publish-import').onclick=event=>buttonAction(event.currentTarget,async()=>{
    if(!inventory)throw new Error('Validate a file first.');
    await publishInventory(inventory);clearPreview();$('kml-upload-form').reset();
    message('kml-message','Inventory published. The public map now uses these locations.');
    activityLoaded=false;await reloadQueue();await renderImports(true);await loadLocationEditor();
  });
  $('imports-more').onclick=event=>buttonAction(event.currentTarget,()=>renderImports());
  $('activity-more').onclick=event=>buttonAction(event.currentTarget,()=>renderActivity());
  $('register-account-form').onsubmit=event=>handleAction(event,async()=>{
    await registerAccount($('register-email').value,$('register-password').value,$('register-role').value);
    $('register-account-form').reset();await renderAccounts();activityLoaded=false;
    message('accounts-message','Account registered and ready to sign in.');
  },'accounts-message');
  $('accounts-table-body').onchange=async event=>{
    const select=event.target.closest('[data-account-role]');if(!select)return;
    select.disabled=true;
    try {await setAccountRole(select.dataset.accountRole,select.value||null);activityLoaded=false;message('accounts-message','Account access updated automatically.');}
    catch(error){message('accounts-message',error.message||'Could not update account access.',true);await renderAccounts();}
    finally{if(select.isConnected)select.disabled=false;}
  };
  $('accounts-table-body').onclick=event=>{
    const button=event.target.closest('[data-delete-account]');if(!button)return;
    deleteAccountId=button.dataset.deleteAccount;
    $('delete-account-description').textContent=button.dataset.accountEmail;
    $('delete-account-dialog').returnValue='';$('delete-account-dialog').showModal();
  };
  $('import-history').onclick=event=>{
    const button=event.target.closest('[data-restore]');if(!button||restoreBusy)return;
    restoreId=button.dataset.restore;
    $('restore-description').textContent=versions.find(version=>version.id===restoreId)?.filename||'Selected version';
    $('restore-dialog').returnValue='';
    $('restore-dialog').showModal();
  };
  $('restore-dialog').addEventListener('close',async()=>{
    if($('restore-dialog').returnValue!=='restore'||restoreBusy)return;
    restoreBusy=true;
    try {
      await restoreInventory(restoreId);activityLoaded=false;
      message('kml-message','Version restored and published. Report history is preserved.');
      await reloadQueue();await renderImports(true);await loadLocationEditor();
    } catch(error) { warning(error); } finally { restoreBusy=false; }
  });
  $('delete-account-dialog').addEventListener('close',async()=>{
    if($('delete-account-dialog').returnValue!=='delete'||!deleteAccountId)return;
    try {await deleteAccount(deleteAccountId);deleteAccountId='';await renderAccounts();activityLoaded=false;message('accounts-message','Account deleted.');}
    catch(error){message('accounts-message',error.message||'Could not delete the account.',true);}
  });
  $('delete-report-dialog').addEventListener('close',async()=>{
    if($('delete-report-dialog').returnValue!=='delete'||!selectedId)return;
    const deletingId=selectedId;
    try {
      await deleteReport(deletingId);selectedId='';detailRequest++;$('review-panel').hidden=true;
      await reloadQueue();activityLoaded=false;message('admin-warning','Report deleted.');$('admin-warning').hidden=false;$('admin-warning').className='form-message is-success';
    } catch(error){message('status-message',error.message||'Could not delete the report.',true);}
  });
  $('delete-location-dialog').addEventListener('close',async()=>{
    if($('delete-location-dialog').returnValue!=='delete'||!deleteLocationId)return;
    const removingId=deleteLocationId;
    try {
      await deleteLocation(removingId);deleteLocationId='';editLocationId='';bulkSelected.delete(removingId);
      await loadLocationEditor();activityLoaded=false;await reloadQueue();
      message('location-edit-message','Location deleted.');
    } catch(error){message('location-edit-message',error.message||'Could not delete the location.',true);}
  });
  $('delete-locations-dialog').addEventListener('close',async()=>{
    if($('delete-locations-dialog').returnValue!=='delete'||!bulkSelected.size)return;
    const ids=[...bulkSelected];
    try {
      await deleteLocations(ids);bulkSelected.clear();editLocationId='';
      await loadLocationEditor();activityLoaded=false;await reloadQueue();
      message('location-edit-message',ids.length+' location'+(ids.length===1?'':'s')+' deleted.');
    } catch(error){message('location-edit-message',error.message||'Could not delete the selected locations.',true);}
  });
}
async function boot() {
  bind(); section();
  try {
    currentUser=await adminSession();
    if(!currentUser) {location.replace('/portal');return;}
    document.querySelector('[data-section="accounts"]').hidden=!currentUser.canManageAccounts;
    document.querySelector('[data-section="password"]').hidden=!currentUser.canManageAccounts;
    $('admin-identity').textContent=currentUser.email+' · '+(currentUser.adminRole==='owner'?'Owner':'Administrator');
    $('password-username').value=currentUser.email;
    await reloadQueue();ready=true;await section();
  } catch(error) { warning(error); }
}
boot();
