import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const db=new DatabaseSync('data/dtown-issue-map/data/issue_map.db',{readOnly:true});
const q=v=>v==null?'null':typeof v==='boolean'||typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const statements=['begin;'];
function insert(table,row){statements.push(`insert into public.${table} (${Object.keys(row).join(',')}) values (${Object.values(row).map(q).join(',')}) on conflict do nothing;`);}
for(const row of db.prepare('select * from locations').all()){const {normalized_name,...value}=row;value.is_active=Boolean(value.is_active);insert('locations',value);}
for(const row of db.prepare('select * from issue_reports').all()){
 const {contact_method,contact_value,reporter_label,admin_notes,...report}=row;insert('issue_reports',report);
 const types=db.prepare('select issue_type from issue_report_types where report_id=?').all(row.id).map(t=>q(t.issue_type));
 statements.push(`update public.issue_reports set issue_types=array[${types.join(',')}]::text[] where id=${q(row.id)};`);
 insert('report_private',{report_id:row.id,contact_method,contact_value,reporter_label,admin_notes});
}
insert('location_imports',{filename:'issues.kml',kml_text:readFileSync('data/dtown-issue-map/data/issues.kml','utf8')});
statements.push('commit;');db.close();console.log(statements.join('\n'));
