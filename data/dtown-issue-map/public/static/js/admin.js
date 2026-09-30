import { adminSession, loadReportPage, loadReportDetail, loadAdminLocations, reviewReport, previewKml, publishInventory, loadImports, restoreInventory, loadActivity, signOut, changePassword } from './backend.js';
import { escapeHtml as h, formatDate, handleAction } from './shared.js';
import { importChanges } from './map-model.js';
const $ = id => document.getElementById(id);
let locations=[], reports=[], selectedId='', page=0, inventory=null, versions=[], activity=[], restoreId='';
let total=0, queueRequest=0, detailRequest=0, searchTimer;
let importsLoaded=false, activityLoaded=false, ready=false, restoreBusy=false;
function message(id,text,error=false) { $(id).textContent=text; $(id).className='form-message '+(error?'is-error':'is-success'); }
function badge(status) { return '<span class="status-badge status-badge--'+h(status)+'">'+h(status)+'</span>'; }
function renderQueue() {
  $('queue-summary').textContent=total+' reports matching your filters';
  $('reports-table-body').innerHTML=reports.map(report=>'<tr class="'+(report.id===selectedId?'is-selected':'')+'"><td><strong>'+h(report.location_name)+'</strong><div class="metadata">'+h(report.location_id)+'</div></td><td>'+h(report.issue_types.join(', ')||'Not recorded')+'</td><td>'+badge(report.status)+'</td><td>'+h(formatDate(report.submitted_at))+'</td><td><button data-review="'+h(report.id)+'" aria-label="Review report for '+h(report.location_name)+'">Review</button></td></tr>').join('') || '<tr><td colspan="5" class="empty-state">No reports match your filters.</td></tr>';
  $('queue-page').textContent=total+' results · Page '+(page+1)+' of '+Math.max(1,Math.ceil(total/20));
  $('queue-previous').disabled=page===0; $('queue-next').disabled=(page+1)*20>=total;
}
async function selectReport(id, focus=true) {
  const request=++detailRequest;
  let report;
  try { report=await loadReportDetail(id); } catch(error) { warning(error); return; }
  if(request!==detailRequest) return;
  selectedId=id; $('review-panel').hidden=false; $('selected-report-id').value=id;
  $('report-facts').innerHTML='<dt>Location</dt><dd>'+h(report.location_name)+'</dd><dt>Report ID</dt><dd><code>'+h(report.id)+'</code></dd><dt>Submitted</dt><dd>'+h(formatDate(report.submitted_at))+'</dd><dt>Issue types</dt><dd>'+h(report.issue_types.join(', '))+'</dd><dt>Description</dt><dd>'+h(report.description||'No description provided.')+'</dd><dt>Contact</dt><dd>'+h(report.contact_value||'No contact details provided.')+'</dd>';
  $('selected-status').value=report.status; $('selected-admin-notes').value=report.admin_notes||'';
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
async function renderActivity(reset=false) {
  if(reset) activity=[];
  const chunk=await loadActivity(activity.length); activity.push(...chunk); activityLoaded=true;
  $('activity-rows').innerHTML=activity.map(row=>'<tr><td>'+h(formatDate(row.occurred_at))+'</td><td>'+h(row.action)+(row.detail.filename?'<div class="metadata">'+h(row.detail.filename)+'</div>':'')+(row.detail.status?'<div class="metadata">'+h(row.detail.previous_status)+' → '+h(row.detail.status)+'</div>':'')+'</td><td><code>'+h(row.actor_id||'System')+'</code></td><td><code>'+h(row.target_id)+'</code></td></tr>').join('') || '<tr><td colspan="4" class="empty-state">No activity recorded yet. New staff changes will appear here.</td></tr>';
  $('activity-more').hidden=chunk.length<50;
}
async function section() {
  const name=['reports','locations','activity','password'].includes(location.hash.slice(1))?location.hash.slice(1):'reports';
  document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==name);
  document.querySelectorAll('[data-section]').forEach(link=>link.dataset.section===name?link.setAttribute('aria-current','page'):link.removeAttribute('aria-current'));
  if(!ready) return;
  try {
    if(name==='locations'&&!importsLoaded) await renderImports(true);
    if(name==='activity'&&!activityLoaded) await renderActivity(true);
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
  $('report-status-form').onsubmit=event=>handleAction(event,async()=>{
    if(!selectedId) throw new Error('Select a report first.');
    await reviewReport(selectedId,$('selected-status').value,$('selected-admin-notes').value);
    await reloadQueue(); activityLoaded=false; message('status-message','Review saved.');
  },'status-message');
  $('password-form').onsubmit=event=>handleAction(event,async()=>{
    if($('new-password').value!==$('confirm-password').value) throw new Error('The passwords do not match.');
    await changePassword($('new-password').value); $('password-form').reset();message('password-message','Password updated.');
  },'password-message');
  $('kml-file').onchange=()=>{clearPreview();message('kml-message','');};
  $('kml-upload-form').onsubmit=event=>handleAction(event,async()=>{
    clearPreview();
    const file=$('kml-file').files[0];if(!file)throw new Error('Choose a KML file.');
    inventory=await previewKml(file); locations=await loadAdminLocations();
    const changes=importChanges(inventory.points,locations);
    $('import-summary').textContent=inventory.filename+' · '+inventory.points.length+' locations · '+changes.added+' added, '+changes.retained+' retained, '+changes.archived+' archived.';
    $('preview-rows').innerHTML=inventory.points.slice(0,10).map(point=>'<tr><td>'+h(point.id)+'</td><td>'+h(point.name)+'</td><td>'+point.latitude.toFixed(6)+'</td><td>'+point.longitude.toFixed(6)+'</td></tr>').join('');
    $('import-preview').hidden=false;message('kml-message','File validated. Review the preview before publishing.');
  },'kml-message');
  $('cancel-import').onclick=()=>{clearPreview();$('kml-upload-form').reset();message('kml-message','Import cancelled. The map has not changed.');};
  $('publish-import').onclick=event=>buttonAction(event.currentTarget,async()=>{
    if(!inventory)throw new Error('Validate a file first.');
    await publishInventory(inventory);clearPreview();$('kml-upload-form').reset();
    message('kml-message','Inventory published. The public map now uses these locations.');
    activityLoaded=false;await reloadQueue();await renderImports(true);
  });
  $('imports-more').onclick=event=>buttonAction(event.currentTarget,()=>renderImports());
  $('activity-more').onclick=event=>buttonAction(event.currentTarget,()=>renderActivity());
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
      await reloadQueue();await renderImports(true);
    } catch(error) { warning(error); } finally { restoreBusy=false; }
  });
}
async function boot() {
  bind(); section();
  try {
    const user=await adminSession();
    if(!user) {location.replace('/portal');return;}
    $('admin-identity').textContent=user.email+' · Administrator';
    $('password-username').value=user.email;
    await reloadQueue();ready=true;await section();
  } catch(error) { warning(error); }
}
boot();
