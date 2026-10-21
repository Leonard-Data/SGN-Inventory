import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { maintenanceContract } from './maintenance-contract.mjs';
import { correctionContract } from './correction-contract.mjs';
import { commentsContract } from './comments-contract.mjs';
import { commentRemovalContract } from './comment-removal-contract.mjs';
import { commentEditContract } from './comment-edit-contract.mjs';
import { companyActivityContract } from './company-activity-contract.mjs';
import { myActivityContract } from './my-activity-contract.mjs';
import { rankingContract } from './ranking-contract.mjs';
import { priceHistoryContract } from './price-history-contract.mjs';
import { inventoryAgeContract } from './inventory-age-contract.mjs';
import { inventoryFilterContract } from './inventory-filter-contract.mjs';
import { inventoryPagingContract } from './inventory-paging-contract.mjs';
import { inventoryStreamContract } from './inventory-stream-contract.mjs';
import { vendorContract } from './vendor-contract.mjs';
import { contactDirectoryContract } from './contact-directory-contract.mjs';
import { propertyVendorLinkContract } from './property-vendor-links-contract.mjs';
import { referenceCatalogContract } from './reference-catalog-contract.mjs';
import { saleCompletionContract } from './sale-completion-contract.mjs';
import { employeeDeactivationContract } from './employee-deactivation-contract.mjs';
import { employeeAccountDeletionContract } from './employee-account-deletion-contract.mjs';
import { auditRetentionContract } from './audit-retention-contract.mjs';
import { employeeDeactivationConcurrency } from './employee-deactivation-concurrency.mjs';
import { propertyVendorLinksConcurrency } from './property-vendor-links-concurrency.mjs';
import { contactLinksConcurrency } from './contact-links-concurrency.mjs';
import { employeeInvitationContract } from './employee-invitation-contract.mjs';
import { employeeInvitationConcurrency } from './employee-invitation-concurrency.mjs';
import { employeeInvitationAcceptanceContract } from './employee-invitation-acceptance-contract.mjs';
import { employeeInvitationResendContract } from './employee-invitation-resend-contract.mjs';
import { employeeProfileContract } from './employee-profile-contract.mjs';
import { applyEmbeddedSchema } from './embedded-schema.mjs';
import { provinceActivityContract } from './province-activity-contract.mjs';
import { addressDuplicateMergeContract } from './address-duplicate-merge-contract.mjs';
import { statusTrailContract } from './status-trail-contract.mjs';
import { contactNumberContract } from './contact-number-contract.mjs';
import { propertyDimensionContract } from './property-dimension-contract.mjs';
import { statusRequestContract } from './status-request-contract.mjs';
const root = process.env.SGN_PROJECT_ROOT || process.cwd();
const db = new PGlite({extensions:{unaccent,pg_trgm,pgcrypto}});
await applyEmbeddedSchema({root,exec:(sql)=>db.exec(sql)});
// Supabase defaults may grant privileges on future objects. Test our explicit revokes.
const users = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006'];
const employees = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006'];
const unlinkedUser = '00000000-0000-4000-8000-000000000007';
const unlinkedEmployee = '10000000-0000-4000-8000-000000000007';
for(let i=0;i<users.length;i++) {
  await db.query('insert into auth.users values ($1)',[users[i]]);
  await db.query('insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$2,$3,$4,$5,$6)',
    [employees[i],users[i],`fixture${i}@example.test`,`Fixture ${i}`,['sales','sales','manager','admin','sales','staff'][i],i!==4]);
}
await db.query('insert into auth.users values ($1)', [unlinkedUser]);
// employees_check requires an unlinked employee row (auth_user_id null) to be inactive.
await db.query(
  "insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,null,'unlinked@example.test','Unlinked fixture','sales',false)",
  [unlinkedEmployee],
);
const property = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values ($1,'SGN-001','sale','available',$2),($3,'SGN-002','sale','available',$4)",[property,employees[0],other,employees[1]]);
await db.query("insert into public.property_addresses(property_id,format,address_text) values ($1,'legacy','12 Lý Thường Kiệt, Phường 14, Quận 10, Thành phố Hồ Chí Minh')",[property]);
const provinceA='50000000-0000-4000-8000-000000000001';const provinceB='50000000-0000-4000-8000-000000000002';const commune='50000000-0000-4000-8000-000000000003';
await db.query("insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,valid_from,source_url) values($1,'TEST-A','Fixture Province A','province','2025-07-01','https://example.test/catalog'),($2,'TEST-B','Fixture Province B','province','2025-07-01','https://example.test/catalog')",[provinceA,provinceB]);
await db.query("insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,parent_id,valid_from,source_url) values($1,'TEST-C','Fixture Commune','commune',$2,'2025-07-01','https://example.test/catalog')",[commune,provinceA]);
let passed = 0;
async function check(name,fn){ await fn(); passed++; console.log('PASS',name); }
async function asUser(index){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[index==='unlinked'?unlinkedUser:index===null?'':users[index]]);await db.exec(`set role ${index===null?'anon':'authenticated'}`);}
async function asService(){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role service_role');}
async function fails(sql,params=[],code){let error;try{await db.query(sql,params);}catch(e){error=e;}assert.ok(error,'expected query to be rejected');if(code)assert.equal(error.code,code);}
await check('all app tables have RLS',async()=>{
 const r=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' and not c.relrowsecurity");assert.equal(r.rows.length,0);
});
await asUser(null);
await check('anonymous inventory denied',()=>fails('select * from public.properties',[],'42501'));
await check('anonymous employee directory read denied',()=>fails('select * from public.employees',[],'42501'));
await check('anonymous reservation RPC denied',()=>fails('select public.request_property_lock($1,$2)',[property,'Deal agreed with customer'],'42501'));
await asUser(4);
await check('inactive employee has no inventory',async()=>assert.equal((await db.query('select * from public.properties')).rows.length,0));
await check('inactive employee directory read denied',async()=>assert.equal((await db.query('select * from public.employees')).rows.length,0));
await check('inactive RPC denied',()=>fails('select public.request_property_lock($1,$2)',[property,'Deal agreed with customer'],'42501'));
await asUser(0);
await check('active salesperson can read inventory',async()=>assert.equal((await db.query('select * from public.properties')).rows.length,2));
await check('accent insensitive legacy address search',async()=>assert.equal((await db.query("select * from public.page_inventory(p_query => 'ly thuong kiet')")).rows.length,1));
await check('salesperson cannot bypass revision RPC for another creator property',()=>fails("update public.properties set notes='change' where id=$1 returning id",[other],'42501'));
await check('salesperson cannot write a property status directly',()=>fails("update public.properties set status='sold' where id=$1",[property],'42501'));
await check('salesperson cannot grant admin role',async()=>assert.equal((await db.query("update public.employees set role='admin' where id=$1 returning id",[employees[0]])).rows.length,0));
// An employee's own record is the only employee row the table read returns; colleague identity
// for business attribution comes from the sanctioned name projection, which carries no personal
// field.
await check('an active employee reads only their own employee row',async()=>assert.deepEqual((await db.query('select id from public.employees')).rows.map((row)=>row.id),[employees[0]]));
await check('the sanctioned name projection resolves colleagues without a personal field',async()=>{
  const rows=(await db.query('select * from public.list_employee_names($1)',[employees])).rows;
  assert.deepEqual(rows.map((row)=>row.id),employees);
  assert.deepEqual(Object.keys(rows[0]).sort(),['display_name','id']);
});
// An access revision advances only when a recorded access fact changes, and it is assigned on
// every update so no client can choose it; a protected read compares it with the session it
// authorized on. Fixture 5 is restored to staff, active and its original locale at the end.
const accessRevision=async(sql,params)=>(await db.query(sql,params)).rows[0].access_revision;
await db.exec('reset role');
await check('an ordinary employee edit keeps the access revision',async()=>assert.equal(await accessRevision("update public.employees set preferred_locale='en' where id=$1 returning access_revision",[employees[5]]),0));
await check('a role change advances the access revision once',async()=>assert.equal(await accessRevision("update public.employees set role='manager' where id=$1 returning access_revision",[employees[5]]),1));
await check('deactivation and reactivation each advance the access revision',async()=>{
  assert.equal(await accessRevision('update public.employees set is_active=false where id=$1 returning access_revision',[employees[5]]),2);
  assert.equal(await accessRevision("update public.employees set role='staff',is_active=true where id=$1 returning access_revision",[employees[5]]),3);
});
await db.query("update public.employees set preferred_locale='vi' where id=$1",[employees[5]]);
await asUser(3);
await check('an admin cannot choose the access revision',async()=>assert.equal(await accessRevision('update public.employees set access_revision=99 where id=$1 returning access_revision',[employees[5]]),3));
await asUser(0);
await check('salesperson cannot read import or audit tables',()=>fails('select * from private.audit_events',[],'42501'));
const lock=(await db.query('select public.request_property_lock($1,$2) as id',[property,'Customer reached agreement; manager review needed'])).rows[0].id;
await check('pending request does not reserve property',async()=>assert.equal((await db.query('select * from public.v_effective_property_locks')).rows.length,0));
await check('direct approval update denied',()=>fails("update public.property_locks set status='approved' where id=$1",[lock],'42501'));
await check('salesperson approval RPC denied',()=>fails('select public.decide_property_lock($1,true,$2)',[lock,'Evidence reviewed and approved'],'42501'));
const key='30000000-0000-4000-8000-000000000001';
await check('physical-visit submission is retired',()=>fails("select public.record_property_activity($1,'site_visit',$2)",[property,key],'P0001'));
await check('physical-visit confirmation entrypoint is removed',()=>fails('select public.review_property_visit($1,true)',[property],'42883'));
await check('daily activity view exposes owner-contact counts without visit metrics',async()=>{
  const cols=(await db.query("select column_name from information_schema.columns where table_name='v_employee_daily_activity'")).rows.map(r=>r.column_name).sort();
  assert.deepEqual(cols,['business_day','distinct_properties_viewed','employee_id','owner_contact_properties','page_view_events']);
});
await asUser(1);
await check('colleague cannot read private employee activity',async()=>assert.equal((await db.query('select * from public.activity_events')).rows.length,0));
const competing=(await db.query('select public.request_property_lock($1,$2) as id',[property,'Another pending employee claim for same property'])).rows[0].id;
await asUser(2);
await db.query('select public.decide_property_lock($1,true,$2)',[lock,'Agreement verified independently by manager']);
await check('manager approval creates one effective reservation',async()=>{
  const rows=(await db.query('select requested_by,employee_name from public.v_effective_property_locks')).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].requested_by,employees[0]);
  // The claimant's name resolves through the sanctioned projection, not a colleague row read.
  assert.equal(rows[0].employee_name,'Fixture 0');
});
await check('manager lock summary still covers every employee',async()=>{
  const rows=(await db.query('select employee_id,display_name,effective_lock_count::int as count from public.v_admin_locks_by_employee')).rows;
  assert.equal(rows.length,employees.length + 1);
  const claimant=rows.find((row)=>row.employee_id===employees[0]);
  assert.deepEqual({displayName:claimant?.display_name,count:claimant?.count},{displayName:'Fixture 0',count:1});
});
await check('second approval fails exclusivity constraint',()=>fails('select public.decide_property_lock($1,true,$2)',[competing,'Another agreement reviewed by manager'],'23505'));
const own=(await db.query('select public.request_property_lock($1,$2) as id',[other,'Manager own customer agreement pending review'])).rows[0].id;
await check('manager self approval forbidden',()=>fails('select public.decide_property_lock($1,true,$2)',[own,'Attempting self approval is forbidden'],'42501'));
const maintainSql='select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1)) as id';
async function maintainFacts(id,changes){const rev=(await db.query('select revision from public.properties where id=$1',[id])).rows[0].revision;return db.query(maintainSql,[id,'property',id,rev,changes]);}
async function addAddress(id,changes){const rev=(await db.query('select revision from public.properties where id=$1',[id])).rows[0].revision;return (await db.query(maintainSql,[id,'address',null,rev,changes])).rows[0].id;}
await check('new address cannot contain district',()=>addAddress(other,{format:'current',address_text:'Test',district_text:'Quận 1'}).then(()=>assert.fail('must reject'),error=>assert.equal(error.code,'23514')));
await check('unverified address stays in separate analytic bucket',async()=>assert.equal((await db.query('select * from public.v_admin_inventory_by_area')).rows[0].current_commune_label,'Chưa xác minh địa chỉ mới'));
const verifiedId=await addAddress(other,{format:'current',address_text:'Fixture current address',commune_text:'Untrusted label'});
const verifiedRev=(await db.query('select revision from public.property_addresses where id=$1',[verifiedId])).rows[0].revision;
const verifiedChanges={province_unit_id:provinceA,commune_unit_id:commune,mapping_status:'verified',verification_method:'manual',source_url:'https://example.test/evidence',effective_on:'2026-10-10',mapping_evidence:'Property boundary checked against official evidence'};
await check('wrong current province/commune hierarchy rejected',()=>fails(maintainSql,[other,'mapping',verifiedId,verifiedRev,{...verifiedChanges,province_unit_id:provinceB}],'23514'));
await check('verified address outside unit validity rejected',()=>fails(maintainSql,[other,'mapping',verifiedId,verifiedRev,{...verifiedChanges,effective_on:'2024-10-10'}],'23514'));
await db.query(maintainSql,[other,'mapping',verifiedId,verifiedRev,verifiedChanges]);
await check('analytics uses canonical verified unit name',async()=>assert.ok((await db.query('select * from public.v_admin_inventory_by_area')).rows.some(r=>r.current_commune_label==='Fixture Commune')));
// The form keeps the official selection alone, so search must reach that address through the
// official unit name even though no written source label was recorded for it.
await check('address search reaches an official unit name with no source label',async()=>assert.equal((await db.query("select * from public.page_inventory(p_query => 'Fixture Commune')")).rows.length,1));
await asUser(0);
await check('salesperson admin analytics return no rows',async()=>assert.equal((await db.query('select * from public.v_admin_inventory_by_area')).rows.length,0));
await asUser(1);
await check('colleague cannot release another employee reservation',()=>fails('select public.release_property_lock($1,$2)',[lock,'Colleague attempts releasing another lock'],'42501'));
await asUser(0);
await db.query('select public.release_property_lock($1,$2)',[lock,'Customer withdrew; reservation released by owner']);
await check('release clears effective reservation',async()=>assert.equal((await db.query('select * from public.v_effective_property_locks')).rows.length,0));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
const stale=(await db.query("insert into public.property_locks(property_id,requested_by,reason,status,requested_at,expires_at,decided_by,decided_at) values($1,$2,'Expired approved agreement','approved',now()-interval '3 days',now()-interval '1 day',$3,now()-interval '2 days') returning id",[property,employees[0],employees[2]])).rows[0].id;
await asUser(1);
await check('expired approved rows are not effective',async()=>assert.equal((await db.query('select * from public.v_effective_property_locks')).rows.length,0));
await asUser(0);
await db.query('select public.request_property_lock($1,$2)',[property,'New request expires stale reservation first']);
await check('new request lazily expires previous approved row',async()=>assert.equal((await db.query('select status from public.property_locks where id=$1',[stale])).rows[0].status,'expired'));
const fileId="40000000-0000-4000-8000-000000000001";let objectPath;
const otherCatId='ffffffff-ffff-ffff-ffff-ffffffffffff';
const testSha256='a'.repeat(64);const validationKey='b'.repeat(64);
const storageId='80000000-0000-4000-8000-000000000001';
const registerSql='select public.register_property_file($1,$2,$3,$4,$5,$6,$7,$8) as result';
const registration=[fileId,property,'fixture.pdf','application/pdf',1024,testSha256,'document',otherCatId];
const completionSql='select public.complete_property_upload($1,$2,$3,$4,$5,$6)';
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query('insert into private.file_validation_keys(id,key_hex) values(1,$1)',[validationKey]);
await asUser(0);
await check('legacy completion and review mutation paths removed',async()=>{
  await fails('select public.complete_property_upload($1)',[fileId],'42883');
  await fails('select public.review_property_file($1,$2)',[fileId,'accepted'],'42883');
});
await check('direct ready insertion and update denied',async()=>{
  await fails("insert into public.property_files(id,property_id,document_type,object_path,original_filename,uploaded_by,upload_status) values($1,$2,'other',$3,'fixture.pdf',$4,'ready')",[fileId,property,objectPath,employees[0]],'42501');
  await fails("update public.property_files set upload_status='ready' where id=$1",[fileId],'42501');
});
objectPath=(await db.query(registerSql,registration)).rows[0].result.objectPath;
const payload=['v1',fileId,property,employees[0],objectPath,storageId,'application/pdf','1024',testSha256].join('|');
const signature=createHmac('sha256',Buffer.from(validationKey,'hex')).update(payload).digest('hex');
const completion=[fileId,storageId,'application/pdf',1024,testSha256,signature];
await check('same registration key converges without replacing expectations',async()=>{
  await db.query(registerSql,registration);
  await fails(registerSql,[fileId,property,'changed.pdf','application/pdf',1024,testSha256,'document',otherCatId],'42501');
  assert.deepEqual((await db.query('select id,original_filename,size_bytes from public.property_files where id=$1',[fileId])).rows,[{id:fileId,original_filename:'fixture.pdf',size_bytes:1024}]);
});
await check('unsafe names, empty and oversized expectations rejected atomically',async()=>{
  for(const [name,size] of [['../bad.pdf',1024],[' ',1024],['empty.pdf',0],['large.pdf',20971521]])
    await fails(registerSql,['40000000-0000-4000-8000-000000000002',property,name,'application/pdf',size,testSha256,'document',otherCatId],'23514');
  assert.deepEqual((await db.query('select id from public.property_files')).rows,[{id:fileId}]);
});
await check('PDF cannot be registered with photo purpose',()=>fails(registerSql,['40000000-0000-4000-8000-000000000002',property,'scan.pdf','application/pdf',1024,testSha256,'photo',otherCatId],'23514'));
await check('completion requires the server attestation over the stored object identity',async()=>{
  // R2 is not visible to the database, so the attestation is the evidence of the inspected
  // object; the property_files row keeps deciding who may read it.
  await fails(completionSql,[...completion.slice(0,5),'0'.repeat(64)],'42501');
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[fileId])).rows[0].upload_status,'pending');
});
await check('unregistered Storage insertion denied',()=>fails("insert into storage.objects(bucket_id,name) values('property-files','unregistered.pdf')",[],'42501'));
await db.query("insert into storage.objects(id,bucket_id,name) values($1,'property-files',$2)",[storageId,objectPath]);
await check('only original uploader may inspect pending bytes',async()=>{
  assert.deepEqual((await db.query('select name from storage.objects where name=$1',[objectPath])).rows,[{name:objectPath}]);
  await asUser(1);
  assert.deepEqual((await db.query('select id from public.property_files where id=$1',[fileId])).rows,[]);
  assert.deepEqual((await db.query('select name from storage.objects where name=$1',[objectPath])).rows,[]);
  await fails(completionSql,completion,'42501');
  await asUser(0);
});
await check('false count or object attestation cannot publish pending attachment',async()=>{
  await fails(completionSql,[fileId,storageId,'application/pdf',1025,testSha256,signature],'23514');
  await fails(completionSql,[fileId,'80000000-0000-4000-8000-000000000002','application/pdf',1024,testSha256,signature],'42501');
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[fileId])).rows[0].upload_status,'pending');
});
await db.query(completionSql,completion);
await check('repeated signed completion converges and preserves original identity',async()=>{
  const first=(await db.query('select id,property_id,uploaded_by,object_path,upload_status,validated_object_id,validated_at from public.property_files where id=$1',[fileId])).rows;
  assert.equal(first[0].upload_status,'ready');assert.equal(first[0].validated_object_id,storageId);
  assert.equal(first[0].property_id,property);assert.equal(first[0].uploaded_by,employees[0]);assert.equal(first[0].object_path,objectPath);
  await db.query(completionSql,completion);
  assert.deepEqual((await db.query('select id,property_id,uploaded_by,object_path,upload_status,validated_object_id,validated_at from public.property_files where id=$1',[fileId])).rows,first);
});
await asUser(1);
await check('ready bytes are privately shared with another property reader',async()=>assert.deepEqual((await db.query('select name from storage.objects where name=$1',[objectPath])).rows,[{name:objectPath}]));
await check('ordinary object overwrite and delete denied',async()=>{
  assert.deepEqual((await db.query("update storage.objects set name='changed' where id=$1 returning id",[storageId])).rows,[]);
  assert.deepEqual((await db.query('delete from storage.objects where id=$1 returning id',[storageId])).rows,[]);
});
await asUser(0);
const crossFile='40000000-0000-4000-8000-000000000002';
await db.query(registerSql,[crossFile,other,'Ảnh nguồn.pdf','application/pdf',1024,testSha256,'document',otherCatId]);
await check('cross-owner contribution preserves uploader and grants no fact editing',async()=>{
  assert.deepEqual((await db.query('select property_id,uploaded_by,original_filename from public.property_files where id=$1',[crossFile])).rows,[{property_id:other,uploaded_by:employees[0],original_filename:'Ảnh nguồn.pdf'}]);
  assert.match((await db.query('select object_path from public.property_files where id=$1',[crossFile])).rows[0].object_path,/^[a-zA-Z0-9/.-]+$/);
  await fails("update public.properties set notes='unauthorized' where id=$1 returning id",[other],'42501');
});
await check('validation secret inaccessible to ordinary clients',()=>fails('select * from private.file_validation_keys',[],'42501'));
await asUser(2);await maintainFacts(other,{archived_at:new Date().toISOString()});
await asUser(0);
await check('archiving hides uploader pending metadata and blocks further completion or registration',async()=>{
  assert.deepEqual((await db.query('select id from public.property_files where id=$1',[crossFile])).rows,[]);
  await fails(registerSql,['40000000-0000-4000-8000-000000000003',other,'archive.pdf','application/pdf',1024,testSha256,'document',otherCatId],'42501');
  await fails(completionSql,[crossFile,storageId,'application/pdf',1024,testSha256,signature],'42501');
});
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.query('update public.properties set archived_at=null where id=$1',[other]);
await asUser(4);
await check('deactivated employee cannot read ready file',async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
await asUser(0);
let customCategory;
await check('category creation normalizes Unicode edges and case without folding accents',async()=>{
  const edges='\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  customCategory=(await db.query('select public.create_or_get_category($1) as id',[`${edges}Pháp lý${edges}`])).rows[0].id;
  const original=(await db.query('select name,created_by,builtin from public.document_categories where id=$1',[customCategory])).rows[0];
  assert.deepEqual(original,{name:'Pháp lý',created_by:employees[0],builtin:null});
  await asUser(1);
  assert.equal((await db.query('select public.create_or_get_category($1) as id',['PHÁP LÝ'])).rows[0].id,customCategory);
  assert.notEqual((await db.query('select public.create_or_get_category($1) as id',['Phap ly'])).rows[0].id,customCategory);
  await fails('select public.create_or_get_category($1)',[edges],'23514');
  await asUser(0);
});
await check('category reads and creation obey active-employee and direct-write boundaries',async()=>{
  await fails('insert into public.document_categories(name) values($1)',['Unauthorized'],'42501');
  await fails('update public.document_categories set name=$1 where id=$2',['Unauthorized',customCategory],'42501');
  await fails('delete from public.document_categories where id=$1',[customCategory],'42501');
  for(const actor of [4,null]){
    await asUser(actor);
    if(actor===null) await fails('select * from public.document_categories',[],'42501');
    else assert.deepEqual((await db.query('select * from public.document_categories')).rows,[]);
    await fails('select public.create_or_get_category($1)',['Unauthorized'],'42501');
  }
  await asUser(0);
});
await check('register_property_file defaults to Other category',async()=>{
  const fid='40000000-0000-4000-8000-000000000003';
  await db.query('select public.register_property_file($1,$2,$3,$4,$5,$6,$7)',[fid,property,'default-cat.pdf','application/pdf',1024,testSha256,'document']);
  const f=await db.query('select category_id from public.property_files where id=$1',[fid]);
  assert.equal(f.rows[0].category_id,otherCatId);
});
await check('register_property_file accepts explicit category',async()=>{
  const fid='40000000-0000-4000-8000-000000000004';
  await db.query(registerSql,[fid,property,'explicit-cat.pdf','application/pdf',1024,testSha256,'document',customCategory]);
  const f=await db.query('select category_id from public.property_files where id=$1',[fid]);
  assert.equal(f.rows[0].category_id,customCategory);
});
await check('forged category UUID rejected',()=>fails(registerSql,['40000000-0000-4000-8000-000000000005',property,'bad-cat.pdf','application/pdf',1024,testSha256,'document','00000000-0000-0000-0000-000000000000'],'23514'));
await check('retry preserves existing category (no recategorization)',async()=>{
  const cat=await db.query("select public.create_or_get_category('Giấy tờ khác') as id");
  const fid='40000000-0000-4000-8000-000000000006';
  await db.query(registerSql,[fid,property,'retry-cat.pdf','application/pdf',1024,testSha256,'document',cat.rows[0].id]);
  // Retry with same identity but default category should NOT overwrite.
  await db.query(registerSql,[fid,property,'retry-cat.pdf','application/pdf',1024,testSha256,'document',otherCatId]);
  const f=await db.query('select category_id from public.property_files where id=$1',[fid]);
  assert.equal(f.rows[0].category_id,cat.rows[0].id);
});
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
const categoryProperty='22000000-0000-4000-8000-000000000001';
const categoryFile='42000000-0000-4000-8000-000000000001';
const nullUploaderFile='42000000-0000-4000-8000-000000000002';
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-CATEGORY','sale','available',$2)",[categoryProperty,employees[0]]);
await asUser(1);
await db.query(registerSql,[categoryFile,categoryProperty,'category-correction.pdf','application/pdf',1024,testSha256,'document',otherCatId]);
await db.exec('reset role');
await db.query("insert into public.property_files(id,property_id,document_type,object_path,original_filename,purpose,upload_status,uploaded_by,review_status,reviewed_by) values($1,$2,'other',$3,'legacy-category.pdf','document','ready',null,'accepted',$4)",[nullUploaderFile,categoryProperty,`${categoryProperty}/${nullUploaderFile}/content`,employees[2]]);
const categoryOriginal=(await db.query('select * from public.property_files where id=$1',[categoryFile])).rows[0];
const nullUploaderOriginal=(await db.query('select * from public.property_files where id=$1',[nullUploaderFile])).rows[0];
await asUser(1);
const correctionCategory=(await db.query("select public.create_or_get_category('Hồ sơ chỉnh sửa') as id")).rows[0].id;
const correctionSql='select public.set_file_category($1,$2,$3)';
await check('uploader without property edit authority corrects only category and can choose Other',async()=>{
  await db.query(correctionSql,[categoryProperty,categoryFile,correctionCategory]);
  assert.deepEqual((await db.query('select * from public.property_files where id=$1',[categoryFile])).rows[0],{...categoryOriginal,category_id:correctionCategory});
  await db.query(correctionSql,[categoryProperty,categoryFile,otherCatId]);
  assert.deepEqual((await db.query('select * from public.property_files where id=$1',[categoryFile])).rows[0],categoryOriginal);
});
await check('NULL historical uploader does not grant contributor correction authority',()=>fails(correctionSql,[categoryProperty,nullUploaderFile,correctionCategory],'42501'));
await check('category creator cannot correct another uploader attachment without edit authority',()=>fails(correctionSql,[property,fileId,correctionCategory],'42501'));
await asUser(0);
await check('sales owner corrects another employee file without changing its state or identity',async()=>{
  await db.query(correctionSql,[categoryProperty,categoryFile,correctionCategory]);
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.property_files where id=$1',[categoryFile])).rows[0],{...categoryOriginal,category_id:correctionCategory});
  await asUser(0);
});
await check('unknown category, missing file and mismatched property leave assignment unchanged',async()=>{
  await fails(correctionSql,[categoryProperty,categoryFile,'00000000-0000-0000-0000-000000000000'],'23514');
  await fails(correctionSql,[categoryProperty,'42000000-0000-4000-8000-ffffffffffff',otherCatId],'23514');
  await fails(correctionSql,[property,categoryFile,otherCatId],'23514');
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.property_files where id=$1',[categoryFile])).rows[0],{...categoryOriginal,category_id:correctionCategory});
});
for(const actor of [5,2,3]){
  await asUser(actor);
  await check(`editor ${actor} can correct historical NULL-uploader attachment`,async()=>{
    await db.query(correctionSql,[categoryProperty,nullUploaderFile,correctionCategory]);
    assert.deepEqual((await db.query('select * from public.property_files where id=$1',[nullUploaderFile])).rows[0],{...nullUploaderOriginal,category_id:correctionCategory});
  });
}
for(const actor of [null,4]){
  await asUser(actor);
  await check(`${actor===null?'anonymous':'inactive'} category correction denied`,()=>fails(correctionSql,[categoryProperty,nullUploaderFile,otherCatId],'42501'));
}
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.query('update public.properties set archived_at=now() where id=$1',[categoryProperty]);
await asUser(2);
await check('even editor cannot correct archived attachment',()=>fails(correctionSql,[categoryProperty,nullUploaderFile,otherCatId],'42501'));
await db.exec('reset role');await db.query('update public.properties set archived_at=null where id=$1',[categoryProperty]);
await asUser(1);await db.exec('reset role');await db.query('update public.employees set is_active=false where id=$1',[employees[1]]);
await db.exec('set role authenticated');
await check('existing session loses uploader correction authority immediately after deactivation',()=>fails(correctionSql,[categoryProperty,categoryFile,otherCatId],'42501'));
await db.exec('reset role');await db.query('update public.employees set is_active=true where id=$1',[employees[1]]);
await asUser(0);
await db.exec('reset role');
await check('audit records exist for workflow mutations',async()=>assert.ok((await db.query('select count(*)::int as n from private.audit_events')).rows[0].n>0));
await check('Vietnam day boundary is applied',async()=>assert.equal((await db.query("select ('2026-10-09 17:05:00+00'::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date::text as day")).rows[0].day,'2026-10-10'));
await db.query("select set_config('request.jwt.claim.sub','',false)");
const rentProperty='20000000-0000-4000-8000-000000000003';const tenant='60000000-0000-4000-8000-000000000001';
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-RENT-001','rent','available',$2)",[rentProperty,employees[5]]);
await db.query("insert into public.contacts(id,display_name,contact_type) values($1,'Synthetic Tenant','tenant')",[tenant]);
const dates=(await db.query("select date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date::text as start, (date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')+interval '3 months'-interval '1 day')::date::text as finish, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as today")).rows[0];
await asUser(0);
await db.query("select public.set_my_locale('en')");
await check('employee can persist EN language preference',async()=>assert.equal((await db.query('select preferred_locale from public.employees where id=$1',[employees[0]])).rows[0].preferred_locale,'en'));
await check('unsupported locale rejected',()=>fails("select public.set_my_locale('fr')"));
await check('sales cannot create lease',()=>fails('select public.create_rental_agreement($1,$2,$3,$4,$5,$6)',[rentProperty,tenant,'RENT-TEST-0',dates.start,dates.finish,'12000000'],'42501'));
await asUser(5);
const lease=(await db.query('select public.create_rental_agreement($1,$2,$3,$4,$5,$6) as id',[rentProperty,tenant,'RENT-TEST-1',dates.start,dates.finish,'12000000'])).rows[0].id;
await check('fractional VND lease rent rejected',()=>fails('select public.create_rental_agreement($1,$2,$3,$4,$5,$6)',[rentProperty,tenant,'RENT-FRACTION',dates.start,dates.finish,'100.5']));
await check('staff cannot activate lease',()=>fails('select public.activate_rental_agreement($1)',[lease],'42501'));
await asUser(2);
await db.query('select public.activate_rental_agreement($1)',[lease]);
await check('activation creates exactly one row per calendar month',async()=>assert.equal((await db.query('select * from public.rental_months where agreement_id=$1',[lease])).rows.length,3));
await check('current VN month is active rental month',async()=>assert.equal((await db.query('select * from public.v_rental_month_status where agreement_id=$1 and is_active_month',[lease])).rows.length,1));
await check('active lease protects inventory availability',async()=>{const rev=(await db.query('select revision from public.properties where id=$1',[rentProperty])).rows[0].revision;await fails(maintainSql,[rentProperty,'property',rentProperty,rev,{status:'available'}],'23514');});
const duplicateLease=(await db.query('select public.create_rental_agreement($1,$2,$3,$4,$5,$6) as id',[rentProperty,tenant,'RENT-TEST-2',dates.start,dates.finish,'12000000'])).rows[0].id;
await asUser(3);
await check('second active whole-property rental rejected',()=>fails('select public.activate_rental_agreement($1)',[duplicateLease],'23505'));
await asUser(2);
const ownLease=(await db.query('select public.create_rental_agreement($1,$2,$3,$4,$5,$6) as id',[rentProperty,tenant,'RENT-OWN',dates.start,dates.finish,'12000000'])).rows[0].id;
await check('lease self activation rejected',()=>fails('select public.activate_rental_agreement($1)',[ownLease],'42501'));
const firstMonth=(await db.query('select * from public.rental_months where agreement_id=$1 order by month_start',[lease])).rows[0];
const prepaidMonth=(await db.query('select * from public.rental_months where agreement_id=$1 order by month_start',[lease])).rows[1];
await asUser(5);
const prepaid=(await db.query("select public.record_rental_payment($1,'receipt',12000000,$2,'bank_transfer',$3,'ADVANCE-MONTH') as id",[prepaidMonth.id,dates.today,'70000000-0000-4000-8000-000000000005'])).rows[0].id;
await asUser(2);
await db.query("select public.decide_rental_payment($1,'confirm','Advance bank receipt independently verified')",[prepaid]);
await check('advance receipt marks future month paid without active occupancy',async()=>{const r=(await db.query('select * from public.v_rental_month_status where id=$1',[prepaidMonth.id])).rows[0];assert.equal(r.payment_status,'paid');assert.equal(r.is_active_month,false);});
await asUser(5);
const paymentKey='70000000-0000-4000-8000-000000000001';
const receipt=(await db.query("select public.record_rental_payment($1,'receipt',$2,$3,'bank_transfer',$4,'TEST-RECEIPT') as id",[firstMonth.id,'3000000',dates.today,paymentKey])).rows[0].id;
await check('payment retry does not duplicate receipt',async()=>assert.equal((await db.query("select public.record_rental_payment($1,'receipt',$2,$3,'bank_transfer',$4,'TEST-RECEIPT') as id",[firstMonth.id,'3000000',dates.today,paymentKey])).rows[0].id,receipt));
await check('payment retry key cannot change amount',()=>fails("select public.record_rental_payment($1,'receipt',$2,$3,'bank_transfer',$4,'TEST-RECEIPT')",[firstMonth.id,'4000000',dates.today,paymentKey]));
await check('unconfirmed receipts do not reduce dues',async()=>assert.equal(Number((await db.query('select balance_due_vnd from public.v_rental_month_status where id=$1',[firstMonth.id])).rows[0].balance_due_vnd),12000000));
await check('direct payment mutation denied',()=>fails("update public.rental_payments set status='confirmed' where id=$1",[receipt],'42501'));
await asUser(2);
await db.query("select public.decide_rental_payment($1,'confirm','Bank receipt evidence independently verified')",[receipt]);
await check('confirmed receipt yields partial month balance',async()=>{const r=(await db.query('select * from public.v_rental_month_status where id=$1',[firstMonth.id])).rows[0];assert.equal(r.payment_status,'partial');assert.equal(Number(r.balance_due_vnd),9000000);});
const selfPay=(await db.query("select public.record_rental_payment($1,'receipt',1,$2,'cash',$3) as id",[firstMonth.id,dates.today,'70000000-0000-4000-8000-000000000002'])).rows[0].id;
await check('payment self confirmation denied',()=>fails("select public.decide_rental_payment($1,'confirm','Trying to review own receipt is forbidden')",[selfPay],'42501'));
await asUser(5);
const overpay=(await db.query("select public.record_rental_payment($1,'receipt',10000000,$2,'cash',$3) as id",[firstMonth.id,dates.today,'70000000-0000-4000-8000-000000000003'])).rows[0].id;
const excessiveRefund=(await db.query("select public.record_rental_payment($1,'refund',4000000,$2,'cash',$3) as id",[firstMonth.id,dates.today,'70000000-0000-4000-8000-000000000004'])).rows[0].id;
await asUser(2);
await check('receipt exceeding monthly due rejected',()=>fails("select public.decide_rental_payment($1,'confirm','Receipt exceeds remaining amount due')",[overpay]));
await check('refund exceeding confirmed balance rejected',()=>fails("select public.decide_rental_payment($1,'confirm','Refund exceeds all confirmed receipts')",[excessiveRefund]));
await asUser(0);
await check('sales sees occupancy but not payment details',async()=>{assert.ok((await db.query('select * from public.v_rental_property_status')).rows.length>0);assert.equal((await db.query('select * from public.rental_payments')).rows.length,0);assert.equal((await db.query('select * from public.v_rental_month_status')).rows.length,0);});
await asUser(2);
await db.query("select public.close_rental_agreement($1,'ended',$2,'Tenant departed early; reviewed termination')",[lease,dates.today]);
await check('early termination voids future dues without deleting months',async()=>{const rows=(await db.query('select * from public.rental_months where agreement_id=$1 order by month_start',[lease])).rows;assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.status==='voided').length,2);});
await check('termination retains confirmed receipt evidence',async()=>assert.equal((await db.query('select status from public.rental_payments where id=$1',[receipt])).rows[0].status,'confirmed'));
await check('prepaid future month becomes refund due after termination',async()=>{const r=(await db.query('select * from public.v_rental_month_status where id=$1',[prepaidMonth.id])).rows[0];assert.equal(r.payment_status,'refund_due');assert.equal(Number(r.refund_due_vnd),12000000);});
await check('ended lease returns inventory to available',async()=>assert.equal((await db.query('select status from public.properties where id=$1',[rentProperty])).rows[0].status,'available'));
await asUser(5);
const refund=(await db.query("select public.record_rental_payment($1,'refund',12000000,$2,'bank_transfer',$3,'REFUND-MONTH') as id",[prepaidMonth.id,dates.today,'70000000-0000-4000-8000-000000000006'])).rows[0].id;
await asUser(2);
await db.query("select public.decide_rental_payment($1,'confirm','Returned bank funds independently verified')",[refund]);
await check('confirmed refund clears future-month credit and retains history',async()=>{const r=(await db.query('select * from public.v_rental_month_status where id=$1',[prepaidMonth.id])).rows[0];assert.equal(r.payment_status,'voided');assert.equal(Number(r.net_paid_vnd),0);assert.equal(Number(r.refund_due_vnd),0);});
await check('cannot void original receipt after funds were refunded',()=>fails("select public.decide_rental_payment($1,'void','Correction must preserve confirmed refund balance')",[prepaid]));
const partialDates=(await db.query("select (date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')+interval '1 month'+interval '14 days')::date::text as start,(date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')+interval '3 months'-interval '1 day')::date::text as finish")).rows[0];
await asUser(5);
const partialLease=(await db.query('select public.create_rental_agreement($1,$2,$3,$4,$5,$6) as id',[rentProperty,tenant,'RENT-PRORATE',partialDates.start,partialDates.finish,'12000000'])).rows[0].id;
await asUser(2);
await db.query('select public.activate_rental_agreement($1)',[partialLease]);
await check('partial first month prorates using actual calendar days',async()=>{const r=(await db.query("select amount_due_vnd,round(12000000::numeric*(occupied_to-occupied_from+1)/((month_start+interval '1 month')::date-month_start)) as expected from public.rental_months where agreement_id=$1 order by month_start limit 1",[partialLease])).rows[0];assert.equal(Number(r.amount_due_vnd),Number(r.expected));assert.ok(Number(r.amount_due_vnd)<12000000);});
await check('future lease has scheduled occupancy and no active month',async()=>{assert.equal((await db.query('select occupancy_status from public.v_rental_property_status where id=$1',[partialLease])).rows[0].occupancy_status,'scheduled');assert.equal((await db.query('select * from public.v_rental_month_status where agreement_id=$1 and is_active_month',[partialLease])).rows.length,0);});
await db.query("select public.close_rental_agreement($1,'canceled',null,'Future tenant canceled before scheduled occupancy')",[partialLease]);
await check('future tenancy cancellation voids all generated months',async()=>assert.ok((await db.query('select status,amount_due_vnd from public.rental_months where agreement_id=$1',[partialLease])).rows.every(r=>r.status==='voided' && Number(r.amount_due_vnd)===0)));
await asUser(null);
await check('anonymous rental tables denied',()=>fails('select * from public.rental_agreements',[],'42501'));
await asUser(4);
await check('inactive language update denied',()=>fails("select public.set_my_locale('en')",[],'42501'));
await check('inactive rental RPC denied',()=>fails('select public.create_rental_agreement($1,$2,$3,$4,$5,$6)',[rentProperty,tenant,'RENT-INACTIVE',dates.start,dates.finish,'12000000'],'42501'));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
const literalProperty='20000000-0000-4000-8000-000000000004';
const wildcardControl='20000000-0000-4000-8000-000000000005';
await db.query("insert into public.properties(id,property_code,listing_mode,status) values($1,'LITERAL%_CODE','sale','available'),($2,'LITERALXXCODE','sale','available')",[literalProperty,wildcardControl]);
await db.query("insert into public.property_addresses(property_id,format,address_text) values($1,'legacy',$3),($2,'legacy',$4)",[literalProperty,wildcardControl,'Nhà 50%_ Nguyễn Trãi \\ '+ '%'.repeat(120),'Nhà 500X Nguyễn Trãi X control']);
await asUser(0);
await check('search treats percent and underscore as literal with excluded controls',async()=>{
  for(const query of ['50%','%_','%_CODE']) assert.deepEqual((await db.query('select id from public.page_inventory(p_query => $1)',[query])).rows.map(row=>row.id),[literalProperty]);
});
await check('literal backslash is not an escape supplied by caller',async()=>assert.deepEqual((await db.query('select id from public.page_inventory(p_query => $1)',['\\'])).rows.map(row=>row.id),[literalProperty]));
await check('120 literal characters remain permitted after SQL escaping',async()=>assert.deepEqual((await db.query('select id from public.page_inventory(p_query => $1)',['%'.repeat(120)])).rows.map(row=>row.id),[literalProperty]));
await check('oversized raw query is refused, never read as empty inventory',()=>fails('select id from public.page_inventory(p_query => $1)',['%'.repeat(121)],'22023'));
await check('address search is contiguous, not reordered tokens',async()=>assert.deepEqual((await db.query('select id from public.page_inventory(p_query => $1)',['trai nguyen'])).rows,[]));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
const archivedProperty='20000000-0000-4000-8000-000000000006';
const archivedViewKey='80000000-0000-4000-8000-000000000001';
await db.query("insert into public.properties(id,property_code,listing_mode,status,archived_at) values($1,'ARCHIVED-REVIEW','sale','available',now())",[archivedProperty]);
await asUser(2);
await check('reviewer archived detail records one retry-safe page view without a physical visit',async()=>{
  const first=(await db.query("select public.record_property_activity($1,'page_view',$2) as id",[archivedProperty,archivedViewKey])).rows[0].id;
  assert.equal((await db.query("select public.record_property_activity($1,'page_view',$2) as id",[archivedProperty,archivedViewKey])).rows[0].id,first);
  assert.deepEqual((await db.query("select property_id,employee_id,kind,visit_status from public.activity_events where id=$1",[first])).rows,[{property_id:archivedProperty,employee_id:employees[2],kind:'page_view',visit_status:null}]);
});
await check('reviewer cannot submit a retired physical visit',()=>fails("select public.record_property_activity($1,'site_visit',$2)",[archivedProperty,'80000000-0000-4000-8000-000000000002'],'P0001'));
await check('sales and staff cannot read or record an archived property',async()=>{
  for(const index of [0,5]) {
    await asUser(index);
    assert.deepEqual((await db.query('select id from public.properties where id=$1',[archivedProperty])).rows,[]);
    await fails("select public.record_property_activity($1,'page_view',$2)",[archivedProperty,archivedViewKey],'P0001');
  }
});
await db.exec('reset role');await db.query('update public.employees set is_active=false where id=$1',[employees[2]]);
await asUser(2);
await check('deactivated reviewer cannot replay an archived page-view identity',()=>fails("select public.record_property_activity($1,'page_view',$2)",[archivedProperty,archivedViewKey],'42501'));
await db.exec('reset role');await db.query('update public.employees set is_active=true where id=$1',[employees[2]]);
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
const coverProperty='20000000-0000-4000-8000-000000000009';
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'COVER-001','sale','available',$2)",[coverProperty,employees[0]]);
const coverFixtures=[
  {id:'40000000-0000-4000-8000-000000000050',purpose:'photo',ready:true,validated:true,parent:coverProperty,uploader:employees[1]},
  {id:'40000000-0000-4000-8000-000000000051',purpose:'photo',ready:true,validated:true,parent:coverProperty,uploader:employees[1]},
  {id:'40000000-0000-4000-8000-000000000052',purpose:'document',ready:true,validated:true,parent:coverProperty,uploader:employees[1]},
  {id:'40000000-0000-4000-8000-000000000053',purpose:'photo',ready:false,validated:false,parent:coverProperty,uploader:employees[1]},
  {id:'40000000-0000-4000-8000-000000000054',purpose:'photo',ready:true,validated:false,parent:coverProperty,uploader:null},
  {id:'40000000-0000-4000-8000-000000000055',purpose:'photo',ready:true,validated:true,parent:other,uploader:employees[1]},
];
for(const fixture of coverFixtures) {
  fixture.path=`${fixture.parent}/${fixture.id}/content`;
  fixture.objectId=fixture.id.replace('40000000','80000000');
  await db.query("insert into storage.objects(id,bucket_id,name) values($1,'property-files',$2)",[fixture.objectId,fixture.path]);
  await db.query("insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by,upload_status,validated_at,validated_object_id) values($1,$2,'other',$3,'fixture.png',$4,$5,$6,$7,$8,$9,$10,$11)",[
    fixture.id,fixture.parent,fixture.path,fixture.uploader?'image/png':null,fixture.uploader?1024:null,fixture.uploader?testSha256:null,fixture.purpose,fixture.uploader,fixture.ready?'ready':'pending',fixture.validated?new Date().toISOString():null,fixture.validated?fixture.objectId:null,
  ]);
}
const [firstCover,secondCover,certificateImage,pendingPhoto,legacyPhoto,crossPhoto]=coverFixtures;
const coverSourceColumns='id,property_id,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by,upload_status,review_status,reviewed_by';
const coverBefore=(await db.query(`select ${coverSourceColumns} from public.property_files where property_id=$1 order by id`,[coverProperty])).rows;
await asUser(0);
await check('sales editor selects another uploader photo without granting ordinary cover writes',async()=>{
  await db.query('select public.set_property_cover($1,$2)',[coverProperty,firstCover.id]);
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[coverProperty])).rows[0].cover_file_id,firstCover.id);
  await fails('update public.properties set cover_file_id=$1 where id=$2',[secondCover.id,coverProperty],'42501');
  await db.query("select set_config('app.cover_authorized',$1,false)",[secondCover.id]);
  await fails('update public.properties set cover_file_id=$1 where id=$2',[secondCover.id,coverProperty],'42501');
  await fails("insert into public.properties(property_code,listing_mode,cover_file_id) values('COVER-FORGE','sale',$1)",[firstCover.id],'42501');
});
await check('document images, pending, unvalidated and cross-property cover candidates preserve selected photo',async()=>{
  for(const [candidate,code] of [[certificateImage,'23514'],[pendingPhoto,'23514'],[legacyPhoto,'23514'],[crossPhoto,'42501']])
    await fails('select public.set_property_cover($1,$2)',[coverProperty,candidate.id],code);
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[coverProperty])).rows[0].cover_file_id,firstCover.id);
});
await check('explicit ready legacy photo validation binds original nullable attribution and never selects a cover',async()=>{
  const facts=[legacyPhoto.id,legacyPhoto.objectId,'image/png',1024,testSha256];
  const originalPayload=['v1',legacyPhoto.id,coverProperty,'',legacyPhoto.path,legacyPhoto.objectId,'image/png','1024',testSha256].join('|');
  const originalSignature=createHmac('sha256',Buffer.from(validationKey,'hex')).update(originalPayload).digest('hex');
  await db.query(completionSql,[...facts,originalSignature]);
  assert.deepEqual((await db.query('select uploaded_by,mime_type,size_bytes,sha256,validated_object_id from public.property_files where id=$1',[legacyPhoto.id])).rows,[{uploaded_by:null,mime_type:null,size_bytes:null,sha256:null,validated_object_id:legacyPhoto.objectId}]);
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[coverProperty])).rows[0].cover_file_id,firstCover.id);
  const pendingPayload=['v1',pendingPhoto.id,coverProperty,pendingPhoto.uploader,pendingPhoto.path,pendingPhoto.objectId,'image/png','1024',testSha256].join('|');
  await fails(completionSql,[pendingPhoto.id,pendingPhoto.objectId,'image/png',1024,testSha256,createHmac('sha256',Buffer.from(validationKey,'hex')).update(pendingPayload).digest('hex')],'42501');
  assert.deepEqual((await db.query(`select ${coverSourceColumns} from public.property_files where property_id=$1 order by id`,[coverProperty])).rows,coverBefore.filter((row)=>row.upload_status==='ready'));
});
await asUser(1);
await check('photo uploader without property edit authority cannot set replace or clear its cover',async()=>{
  for(const candidate of [firstCover.id,secondCover.id,null])
    await fails('select public.set_property_cover($1,$2)',[coverProperty,candidate],'42501');
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[coverProperty])).rows[0].cover_file_id,firstCover.id);
});
await asUser(5);
await check('staff replaces then clears cover while all source attachment records remain',async()=>{
  await db.query('select public.set_property_cover($1,$2)',[coverProperty,secondCover.id]);
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[coverProperty])).rows[0].cover_file_id,secondCover.id);
  await db.query('select public.set_property_cover($1,null)',[coverProperty]);
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[coverProperty])).rows[0].cover_file_id,null);
  assert.deepEqual((await db.query(`select ${coverSourceColumns} from public.property_files where property_id=$1 order by id`,[coverProperty])).rows,coverBefore.filter((row)=>row.upload_status==='ready'));
});
await asUser(null);
await check('anonymous cover changes denied',()=>fails('select public.set_property_cover($1,$2)',[coverProperty,firstCover.id],'42501'));
await asUser(4);
await check('inactive cover changes denied',()=>fails('select public.set_property_cover($1,$2)',[coverProperty,firstCover.id],'42501'));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query('update public.properties set archived_at=now() where id=$1',[coverProperty]);
await asUser(2);
await check('even reviewer cannot change archived cover',()=>fails('select public.set_property_cover($1,$2)',[coverProperty,firstCover.id],'42501'));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query('update public.properties set archived_at=null where id=$1',[coverProperty]);
await asUser(0);await db.exec('reset role');await db.query('update public.employees set is_active=false where id=$1',[employees[0]]);await db.exec('set role authenticated');
await check('existing identity loses cover mutation authority after live deactivation',()=>fails('select public.set_property_cover($1,$2)',[coverProperty,firstCover.id],'42501'));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.query('update public.employees set is_active=true where id=$1',[employees[0]]);
assert.deepEqual((await db.query(`select ${coverSourceColumns} from public.property_files where property_id=$1 order by id`,[coverProperty])).rows,coverBefore);
// Property file storage moved to Cloudflare R2 with per-property class limits.
const limitProperty='20000000-0000-4000-8000-00000000000a';
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-LIMITS','sale','available',$2)",[limitProperty,employees[0]]);
await asUser(0);
const limitDocument=(index)=>`43000000-0000-4000-8000-00000000000${index}`;
const limitImage=(index)=>`43000000-0000-4000-8000-0000000001${String(index).padStart(2,'0')}`;
async function registerLimited(id,mime,size,purpose='document'){
  const row=(await db.query(registerSql,[id,limitProperty,`limit-${id.slice(-2)}.${mime==='application/pdf'?'pdf':'png'}`,mime,size,testSha256,purpose,otherCatId])).rows[0];
  return row.result.objectPath;
}
async function completeLimited(id,path,mime,size){
  const objectId=id.replace('43000000','83000000');
  const signedPayload=['v1',id,limitProperty,employees[0],path,objectId,mime,String(size),testSha256].join('|');
  const signed=createHmac('sha256',Buffer.from(validationKey,'hex')).update(signedPayload).digest('hex');
  return db.query(completionSql,[id,objectId,mime,size,testSha256,signed]);
}
await check('document class keeps 5 files of up to 20 MiB and refuses the sixth',async()=>{
  await fails(registerSql,[limitDocument(6),limitProperty,'limit-06.pdf','application/pdf',20971521,testSha256,'document',otherCatId],'23514');
  const firstPath=await registerLimited(limitDocument(1),'application/pdf',20971520);
  for(let n=2;n<=5;n++) await registerLimited(limitDocument(n),'application/pdf',1024);
  await fails(registerSql,[limitDocument(6),limitProperty,'limit-06.pdf','application/pdf',1024,testSha256,'document',otherCatId],'P0020');
  assert.equal((await db.query("select count(*)::int as n from public.property_files where property_id=$1 and mime_type='application/pdf'",[limitProperty])).rows[0].n,5);
  await completeLimited(limitDocument(1),firstPath,'application/pdf',20971520);
});
await check('image class keeps 10 images of up to 5 MiB and refuses an eleventh',async()=>{
  await fails(registerSql,[limitImage(11),limitProperty,'limit-11.png','image/png',5242881,testSha256,'photo',otherCatId],'P0022');
  const paths=[];
  for(let n=1;n<=10;n++) paths.push(await registerLimited(limitImage(n),'image/png',5242880,n===1?'photo':'document'));
  await fails(registerSql,[limitImage(11),limitProperty,'limit-11.png','image/png',1024,testSha256,'photo',otherCatId],'P0021');
  assert.equal((await db.query("select count(*)::int as n from public.property_files where property_id=$1 and mime_type='image/png'",[limitProperty])).rows[0].n,10);
  await completeLimited(limitImage(1),paths[0],'image/png',5242880);
});
await check('the property cover is one of the 10 images and earns no extra slot',async()=>{
  await db.query('select public.set_property_cover($1,$2)',[limitProperty,limitImage(1)]);
  assert.equal((await db.query('select cover_file_id from public.properties where id=$1',[limitProperty])).rows[0].cover_file_id,limitImage(1));
  await fails(registerSql,[limitImage(11),limitProperty,'limit-11.png','image/png',1024,testSha256,'photo',otherCatId],'P0021');
});
await check('completion defensively refuses a pending file that would exceed its class limit',async()=>{
  const racedId='43000000-0000-4000-8000-000000000120';
  await db.exec('reset role');
  await db.query("insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by) values($1,$2,'other',$3,'raced.png','image/png',1024,$4,'document',$5)",[racedId,limitProperty,`${limitProperty}/${racedId}/content`,testSha256,employees[0]]);
  await asUser(0);
  await fails(completionSql,[racedId,racedId.replace('43000000','83000000'),'image/png',1024,testSha256,createHmac('sha256',Buffer.from(validationKey,'hex')).update(['v1',racedId,limitProperty,employees[0],`${limitProperty}/${racedId}/content`,racedId.replace('43000000','83000000'),'image/png','1024',testSha256].join('|')).digest('hex')],'P0021');
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[racedId])).rows[0].upload_status,'pending');
});
await check('an unvalidated ready image is still confirmed on a property over its class cap',async()=>{
  const legacyProperty='20000000-0000-4000-8000-000000000012';
  const legacyFile='46000000-0000-4000-8000-000000000001';
  const objectId='86000000-0000-4000-8000-000000000001';
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-LEGACY','sale','available',$2)",[legacyProperty,employees[0]]);
  // Eleven ready images from before the class caps existed: the rows are the authority, so they
  // all keep their slot and the one without technical confirmation must still be confirmable.
  await db.query("insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by,upload_status,validated_at,validated_object_id) select s.fid,$1::uuid,'other',$2::text||'/'||s.fid::text||'/content','legacy-'||s.n||'.png','image/png',1024,$3,'document',$4,'ready',case when s.n=1 then null else now() end,case when s.n=1 then null else s.fid end from (select ('46000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid as fid,n from generate_series(1,11) n) s",[legacyProperty,legacyProperty,testSha256,employees[0]]);
  await asUser(0);
  const signature=createHmac('sha256',Buffer.from(validationKey,'hex')).update(['v1',legacyFile,legacyProperty,employees[0],`${legacyProperty}/${legacyFile}/content`,objectId,'image/png','1024',testSha256].join('|')).digest('hex');
  await db.query(completionSql,[legacyFile,objectId,'image/png',1024,testSha256,signature]);
  const confirmed=(await db.query('select upload_status,validated_at,validated_object_id from public.property_files where id=$1',[legacyFile])).rows[0];
  assert.equal(confirmed.upload_status,'ready');
  assert.equal(confirmed.validated_object_id,objectId);
  assert.notEqual(confirmed.validated_at,null);
  assert.equal((await db.query("select count(*)::int as n from public.property_files where property_id=$1 and upload_status='ready'",[legacyProperty])).rows[0].n,11);
});
await check('an abandoned or refused upload stops reserving its class slot',async()=>{
  const slotProperty='20000000-0000-4000-8000-00000000000f';
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-SLOTS','sale','available',$2)",[slotProperty,employees[0]]);
  // Four registrations abandoned long ago: their signed upload URL lived 60 seconds, so they
  // can no longer receive bytes and must not keep holding slots.
  await db.query("insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by,created_at) select s.fid,$1::uuid,'other',$2::text||'/'||s.fid::text||'/content','stale-'||s.n||'.pdf','application/pdf',1024,$3,'document',$4,now()-interval '20 minutes' from (select ('44000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid as fid,n from generate_series(1,4) n) s",[slotProperty,slotProperty,testSha256,employees[0]]);
  await asUser(0);
  const slotDocument=(n)=>`44000000-0000-4000-8000-00000000001${n}`;
  for(let n=1;n<=5;n++) await db.query(registerSql,[slotDocument(n),slotProperty,`slot-${n}.pdf`,'application/pdf',1024,testSha256,'document',otherCatId]);
  await fails(registerSql,[slotDocument(6),slotProperty,'slot-6.pdf','application/pdf',1024,testSha256,'document',otherCatId],'P0020');
  // The release reports whether it moved the pending row, so a rival completion that already
  // made the file ready can never be followed by deleting that file's bytes.
  assert.equal((await db.query('select public.fail_property_upload($1) as released',[slotDocument(5)])).rows[0].released,true);
  assert.equal((await db.query('select public.fail_property_upload($1) as released',[slotDocument(5)])).rows[0].released,false);
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[slotDocument(5)])).rows[0].upload_status,'cleanup_pending');
  // The slot is free while the bytes may still exist, and a released row takes no new upload.
  await fails(registerSql,[slotDocument(5),slotProperty,'slot-5.pdf','application/pdf',1024,testSha256,'document',otherCatId],'23514');
  await db.query(registerSql,[slotDocument(6),slotProperty,'slot-6.pdf','application/pdf',1024,testSha256,'document',otherCatId]);
  // No client session may assert that bytes are gone; the trusted server records it.
  await fails('select public.mark_upload_cleaned($1)',[slotDocument(5)],'42501');
  await asService();
  await db.query('select public.mark_upload_cleaned($1)',[slotDocument(5)]);
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[slotDocument(5)])).rows[0].upload_status,'failed');
  await asUser(0);
  // Only the two-step path reaches failed: a settled row is neither re-uploadable nor re-run.
  await fails(registerSql,[slotDocument(5),slotProperty,'slot-5.pdf','application/pdf',1024,testSha256,'document',otherCatId],'23514');
});
await check('failing an upload never touches a ready row or another employee row',async()=>{
  await asUser(0);
  assert.equal((await db.query('select public.fail_property_upload($1) as released',[limitDocument(1)])).rows[0].released,false);
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[limitDocument(1)])).rows[0].upload_status,'ready');
  const colleagueRow='44000000-0000-4000-8000-000000000201';
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by) values($1,'20000000-0000-4000-8000-00000000000f','other',$2,'colleague.pdf','application/pdf',1024,$3,'document',$4)",[colleagueRow,`20000000-0000-4000-8000-00000000000f/${colleagueRow}/content`,testSha256,employees[0]]);
  await asUser(1);
  assert.equal((await db.query('select public.fail_property_upload($1) as released',[colleagueRow])).rows[0].released,false);
  await asUser(null);
  await fails('select public.fail_property_upload($1)',[colleagueRow],'42501');
  await fails('select public.mark_upload_cleaned($1)',[colleagueRow],'42501');
  // Even the trusted server cannot jump a pending upload straight to failed.
  await asService();
  await db.query('select public.mark_upload_cleaned($1)',[colleagueRow]);
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[colleagueRow])).rows[0].upload_status,'pending');
  await asUser(0);
});
await check('a released upload on an archived property stays reachable for the server sweep',async()=>{
  const sweepProperty='20000000-0000-4000-8000-000000000011';
  const sweepFile='45000000-0000-4000-8000-000000000001';
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-SWEEP','sale','available',$2)",[sweepProperty,employees[0]]);
  await asUser(1);
  await db.query(registerSql,[sweepFile,sweepProperty,'sweep.pdf','application/pdf',1024,testSha256,'document',otherCatId]);
  assert.equal((await db.query('select public.fail_property_upload($1) as released',[sweepFile])).rows[0].released,true);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query('update public.properties set archived_at=now() where id=$1',[sweepProperty]);
  // No employee session reaches the row once its property is archived, and no session may
  // record the deletion either.
  await asUser(0);
  assert.equal((await db.query('select id from public.property_files where id=$1',[sweepFile])).rows.length,0);
  await asUser(1);
  assert.equal((await db.query('select id from public.property_files where id=$1',[sweepFile])).rows.length,0);
  await fails('select public.mark_upload_cleaned($1)',[sweepFile],'42501');
  // The trusted server sweep still finds it, whoever uploaded it and wherever it lives.
  await asService();
  assert.equal((await db.query("select count(*)::int as n from public.property_files where upload_status='cleanup_pending' and id=$1",[sweepFile])).rows[0].n,1);
  await db.query('select public.mark_upload_cleaned($1)',[sweepFile]);
  assert.equal((await db.query('select upload_status from public.property_files where id=$1',[sweepFile])).rows[0].upload_status,'failed');
  await asUser(0);
});
const maintainedProperty=await maintenanceContract({db,asUser,check,fails,employees,property,other});
await correctionContract({db,asUser,check,fails,employees,property:maintainedProperty});
// Ticket #36: recorded Asking-price history over the allowlisted business-history seam.
await priceHistoryContract({db,asUser,check,fails,employees});
// Ticket #29: a deliberate disclosure commits one property per employee/Vietnam day.
const ownerProperty='20000000-0000-4000-8000-00000000000b';
const ownerProperty2='20000000-0000-4000-8000-00000000000c';
const brokerProperty='20000000-0000-4000-8000-00000000000d';
const phoneGapProperty='20000000-0000-4000-8000-00000000000e';
const sharedOwner='60000000-0000-4000-8000-0000000000b1';
const brokerLink='60000000-0000-4000-8000-0000000000b2';
const ownerNoPhone='60000000-0000-4000-8000-0000000000b3';
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-OWNER-1','sale','available',$5),($2,'SGN-OWNER-2','sale','available',$5),($3,'SGN-BROKER-1','sale','available',$5),($4,'SGN-PHONEGAP-1','sale','available',$5)",[ownerProperty,ownerProperty2,brokerProperty,phoneGapProperty,employees[0]]);
await db.query("insert into public.contacts(id,display_name,phones,raw_phone_text,contact_type) values($1,'Synthetic Shared Owner','{0901234567}','090 123 4567','broker'),($2,'Synthetic Broker Link','{0911111111}','091 111 1111','owner'),($3,'Synthetic Owner No Phone','{}',null,'owner')",[sharedOwner,brokerLink,ownerNoPhone]);
await db.query("insert into public.property_contacts(property_id,contact_id,relation,is_primary) values($1,$4,'owner',true),($2,$4,'owner',false),($3,$4,'broker',true),($3,$5,'broker',false),($6,$7,'owner',true)",[ownerProperty,ownerProperty2,brokerProperty,sharedOwner,brokerLink,phoneGapProperty,ownerNoPhone]);
await asUser(0);
const ownerKey='30000000-0000-4000-8000-000000000031';
const disclosure=(await db.query('select public.reveal_owner_contact($1,$2) as result',[ownerProperty,ownerKey])).rows[0].result;
await check('owner disclosure returns the property recorded owner phone and credits one property',async()=>{
  assert.equal(disclosure.credited,true);assert.notEqual(disclosure.eventId,null);
  assert.deepEqual(disclosure.contact,{id:sharedOwner,displayName:'Synthetic Shared Owner',relation:'owner',isPrimary:true,phone:'0901234567'});
  assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),1);
});
await check('owner disclosure retry returns the original event and day without duplicating credit',async()=>{
  const retry=(await db.query('select public.reveal_owner_contact($1,$2) as result',[ownerProperty,ownerKey])).rows[0].result;
  assert.equal(retry.eventId,disclosure.eventId);assert.equal(retry.businessDay,disclosure.businessDay);
  assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),1);
});
await check('independent reveals keep distinct event identities without inflating the property count',async()=>{
  const second=(await db.query('select public.reveal_owner_contact($1,$2) as result',[ownerProperty,randomUUID()])).rows[0].result;
  assert.notEqual(second.eventId,disclosure.eventId);
  assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),1);
});
await check('owner-contact retry key cannot be reused for another property',()=>fails('select public.reveal_owner_contact($1,$2)',[ownerProperty2,ownerKey],'P0005'));
await check('a shared owner through another property counts another property',async()=>{
  await db.query('select public.reveal_owner_contact($1,$2)',[ownerProperty2,randomUUID()]);
  assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),2);
});
await check('broker-only relationship is not owner eligibility',()=>fails('select public.reveal_owner_contact($1,$2)',[brokerProperty,randomUUID()],'P0003'));
await check('recorded owner without a phone is explicit and adds no credit',()=>fails('select public.reveal_owner_contact($1,$2)',[phoneGapProperty,randomUUID()],'P0004'));
await check('denied disclosures added no owner-contact credit',async()=>assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),2));
await check('direct activity mutation remains denied',()=>fails("insert into public.activity_events(employee_id,property_id,kind,idempotency_key) values($1,$2,'owner_contact_access',$3)",[employees[0],ownerProperty,randomUUID()],'42501'));
await asUser(1);
await check('different employees have independent owner-contact counts',async()=>{
  await db.query('select public.reveal_owner_contact($1,$2)',[ownerProperty,randomUUID()]);
  assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),1);
});
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.query('update public.properties set archived_at=now() where id=$1',[ownerProperty2]);
await asUser(2);
await check('manager archived review keeps contact access without new credit',async()=>{
  const archived=(await db.query('select public.reveal_owner_contact($1,$2) as result',[ownerProperty2,randomUUID()])).rows[0].result;
  assert.equal(archived.credited,false);assert.equal(archived.eventId,null);assert.equal(archived.contact.phone,'0901234567');
  assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),0);
});
await asUser(0);
await check('ordinary employee stays denied archived contact access',()=>fails('select public.reveal_owner_contact($1,$2)',[ownerProperty2,randomUUID()],'P0002'));
await check('archiving a property does not erase earlier owner-contact credit',async()=>assert.equal(Number((await db.query('select owner_contact_properties from public.my_today_activity()')).rows[0].owner_contact_properties),2));
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
await asUser(2);
const managerKey=randomUUID();
const managerFirst=(await db.query('select public.reveal_owner_contact($1,$2) as result',[ownerProperty,managerKey])).rows[0].result;
await check('manager retry after archiving returns the original reference and day',async()=>{
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query('update public.properties set archived_at=now() where id=$1',[ownerProperty]);
  await asUser(2);
  const retried=(await db.query('select public.reveal_owner_contact($1,$2) as result',[ownerProperty,managerKey])).rows[0].result;
  assert.equal(retried.eventId,managerFirst.eventId);
  assert.equal(retried.businessDay,managerFirst.businessDay);
  assert.equal(retried.credited,true);
});
await check('reusing a committed key on another archived property is rejected',()=>fails('select public.reveal_owner_contact($1,$2)',[ownerProperty2,managerKey],'P0005'));
await asUser(null);
await check('anonymous today activity denied',()=>fails('select * from public.my_today_activity()',[],'42501'));
await check('anonymous owner disclosure denied',()=>fails('select public.reveal_owner_contact($1,$2)',[ownerProperty,randomUUID()],'42501'));
await asUser(4);
await check('unlinked and inactive today activity denied',()=>fails('select * from public.my_today_activity()',[],'42501'));
await check('inactive owner disclosure denied',()=>fails('select public.reveal_owner_contact($1,$2)',[ownerProperty,randomUUID()],'42501'));
await commentsContract({db,asUser,check,fails,employees,property});
// Ticket #45: accountable Property comment removal.
await commentRemovalContract({db,asUser,check,fails,employees});
// Ticket #46: author editing with retained revisions, composed with removal and posting retry.
await commentEditContract({db,asUser,check,fails,employees});
// Ticket #31: company employee-by-day activity for live manager/admin readers.
await companyActivityContract({db,asUser,check,fails,employees});
// Ticket #30: the employee's own activity over an explicit Vietnam date range.
await myActivityContract({db,asUser,check,fails,employees});
// Ticket #34: the reviewer-only Employee owner-contact activity ranking.
await rankingContract({db,asUser,check,fails,employees});
// Issue #37: explicit original inventory entry dates and eligible chronological ordering.
await inventoryAgeContract({db,asUser,check,fails,employees});
// Advance Filter and Search Island: the advanced status/mode/type/price/area inventory filters.
await inventoryFilterContract({db,asUser,check,fails,employees});
// Ticket #140: the counted, offset-paged inventory read that replaced the cursor walks.
await inventoryPagingContract({db,asUser,check,fails,employees});
// Ticket #154: the newest-created-first stream that replaced the numbered pager on the page.
await inventoryStreamContract({db,asUser,check,fails,employees});
// Seeded Vietnamese province/city and ward/commune reference catalogue.
await referenceCatalogContract({db,asUser,check,fails,employees,root});
// Ticket #35: reviewer-only province activity grouped by latest verified primary province.
await provinceActivityContract({db,asUser,check,fails,employees});
// Issue #38: one reviewed logical sale completion and the completed-sale ranking.
await saleCompletionContract({db,asUser,check,fails,employees});
// Issue #66: guarded employee administration, last-active-admin protection and provider
// reconciliation without losing the record.
await employeeDeactivationContract({db,asUser,check,fails,employees});
// Issue #67: permanent sign-in-account deletion with the retained employee, every business
// reference and the historical Auth attribution preserved.
await employeeAccountDeletionContract({db,asUser,check,fails});
await employeeDeactivationConcurrency({root,check});
await propertyVendorLinksConcurrency({root,check});
await contactLinksConcurrency({root,check});
// Issue #68: the recorded role-bound employee invitation and its per-address guard.
await employeeInvitationContract({db,asUser,check,fails});
await employeeInvitationConcurrency({root,check});
// Issue #69: accepting the recorded invitation, linking and activating the exact invitee.
await employeeInvitationAcceptanceContract({db,asUser,check,fails});
// Sending a recorded, still unaccepted invitation again: one more recorded attempt, no second
// invitation row, and no resend for an accepted, active or deletion-in-flight person.
await employeeInvitationResendContract({db,asUser,check,fails});
// Employee profile edit: the admin edit, the person's own name and bio, the last-active-admin
// rule, the deactivated/deleted refusal and the bio limit.
await employeeProfileContract({db,asUser,check,fails});
// Ticket #73: the vendor directory authority, validation, retry and paging rules.
await vendorContract({db,asUser,check,fails,employees});
// Ticket #74: property-to-vendor links, their correction and the recorded link row as the trail;
// property history stays price-only, with no link or unlink projection.
await propertyVendorLinkContract({db,asUser,check,fails,employees,property,other});
// Audit-trail retention: the window boundary, repeat safety, own-table binding and the
// application/API denial around the administrative trim.
await auditRetentionContract({db,asUser,check,fails,employees});
// Ticket #71: the shared Contact directory read and its contact-scoped correction.
await contactDirectoryContract({db,asUser,check,fails,employees});
// Issue #147: the shared-address group, and the deliberate merge of duplicate records.
await addressDuplicateMergeContract({db,asUser,check,fails,employees,validationKey});
// Ticket #173: the property status trail and direct non-final status changes.
await statusTrailContract({db,asUser,check,fails,employees});
// Ticket #174: sold and rented as a reviewer decision recorded on the same trail.
await statusRequestContract({db,asUser,check,fails,employees});
// Recording a contact number on any unarchived property: any active employee may create the
// contact and its link, while correcting or unlinking it stays staff/manager/admin.
await contactNumberContract({db,asUser,check,fails,employees,property});
// A stored frontage or depth contradicting its own area text: the rounding the legacy sheet's
// dimension columns lost, reported by row so the operator sees which records are wrong.
await propertyDimensionContract({db,check,employees});
const report={checked_at:new Date().toISOString(),engine:'PGlite embedded PostgreSQL plus an embedded real PostgreSQL engine for the two-connection last-admin, property-vendor-link and contact-link races; mocked auth/storage schemas',passed,
 limitations:['Not a live Supabase integration test','HTTP Auth, presigned R2 URLs, Vercel and browser flows not exercised','Hosted/staging independent-session contention at production load remains an acceptance gate']};
await fs.writeFile(path.join(root,'docs/validation-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${passed} assertions passed`);await db.close();
