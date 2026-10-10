import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const root = process.env.SGN_PROJECT_ROOT || process.cwd();
const db = new PGlite({extensions:{unaccent,pg_trgm,pgcrypto}});
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  $$;
  grant usage on schema auth to authenticated,anon,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated,anon;
  grant select,insert,update,delete on storage.objects to authenticated;
`);
for(const f of (await fs.readdir(path.join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort()) {
  await db.exec(await fs.readFile(path.join(root,'supabase/migrations',f),'utf8'));
  console.log('Applied',f);
}
// Supabase defaults may grant privileges on future objects. Test our explicit revokes.
const users = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006'];
const employees = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006'];
for(let i=0;i<users.length;i++) {
  await db.query('insert into auth.users values ($1)',[users[i]]);
  await db.query('insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$2,$3,$4,$5,$6)',
    [employees[i],users[i],`fixture${i}@example.test`,`Fixture ${i}`,['sales','sales','manager','admin','sales','staff'][i],i!==4]);
}
const property = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
await db.query("insert into public.properties(id,property_code,listing_mode,status,created_by) values ($1,'SGN-001','sale','available',$2),($3,'SGN-002','sale','available',$4)",[property,employees[0],other,employees[1]]);
await db.query("insert into public.property_addresses(property_id,format,address_text) values ($1,'legacy','12 Lý Thường Kiệt, Phường 14, Quận 10, Thành phố Hồ Chí Minh')",[property]);
const provinceA='50000000-0000-4000-8000-000000000001';const provinceB='50000000-0000-4000-8000-000000000002';const commune='50000000-0000-4000-8000-000000000003';
await db.query("insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,valid_from,source_url) values($1,'TEST-A','Fixture Province A','province','2025-07-01','https://example.test/catalog'),($2,'TEST-B','Fixture Province B','province','2025-07-01','https://example.test/catalog')",[provinceA,provinceB]);
await db.query("insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,parent_id,valid_from,source_url) values($1,'TEST-C','Fixture Commune','commune',$2,'2025-07-01','https://example.test/catalog')",[commune,provinceA]);
let passed = 0;
async function check(name,fn){ await fn(); passed++; console.log('PASS',name); }
async function asUser(index){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[index===null?'':users[index]]);await db.exec(`set role ${index===null?'anon':'authenticated'}`);}
async function fails(sql,params=[],code){let error;try{await db.query(sql,params);}catch(e){error=e;}assert.ok(error,'expected query to be rejected');if(code)assert.equal(error.code,code);}
await check('all app tables have RLS',async()=>{
 const r=await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' and not c.relrowsecurity");assert.equal(r.rows.length,0);
});
await asUser(null);
await check('anonymous inventory denied',()=>fails('select * from public.properties',[],'42501'));
await check('anonymous reservation RPC denied',()=>fails('select public.request_property_lock($1,$2)',[property,'Deal agreed with customer'],'42501'));
await asUser(4);
await check('inactive employee has no inventory',async()=>assert.equal((await db.query('select * from public.properties')).rows.length,0));
await check('inactive RPC denied',()=>fails('select public.request_property_lock($1,$2)',[property,'Deal agreed with customer'],'42501'));
await asUser(0);
await check('active salesperson can read inventory',async()=>assert.equal((await db.query('select * from public.properties')).rows.length,2));
await check('accent insensitive legacy address search',async()=>assert.equal((await db.query("select * from public.search_properties('ly thuong kiet')")).rows.length,1));
await check('salesperson cannot edit another creator property',async()=>assert.equal((await db.query("update public.properties set notes='change' where id=$1 returning id",[other])).rows.length,0));
await check('salesperson cannot mark property sold',()=>fails("update public.properties set status='sold' where id=$1",[property],'42501'));
await check('salesperson cannot grant admin role',async()=>assert.equal((await db.query("update public.employees set role='admin' where id=$1 returning id",[employees[0]])).rows.length,0));
await check('salesperson cannot read import or audit tables',()=>fails('select * from private.audit_events',[],'42501'));
const lock=(await db.query('select public.request_property_lock($1,$2) as id',[property,'Customer reached agreement; manager review needed'])).rows[0].id;
await check('pending request does not reserve property',async()=>assert.equal((await db.query('select * from public.v_effective_property_locks')).rows.length,0));
await check('direct approval update denied',()=>fails("update public.property_locks set status='approved' where id=$1",[lock],'42501'));
await check('salesperson approval RPC denied',()=>fails('select public.decide_property_lock($1,true,$2)',[lock,'Evidence reviewed and approved'],'42501'));
const key='30000000-0000-4000-8000-000000000001';
const event=(await db.query("select public.record_property_activity($1,'site_visit',$2) as id",[property,key])).rows[0].id;
await check('activity retry is idempotent',async()=>assert.equal((await db.query("select public.record_property_activity($1,'site_visit',$2) as id",[property,key])).rows[0].id,event));
await check('key cannot be reused for another property',()=>fails("select public.record_property_activity($1,'site_visit',$2)",[other,key]));
await check('unconfirmed visit is excluded from KPI',async()=>assert.equal(Number((await db.query('select * from public.v_employee_daily_activity')).rows[0].confirmed_properties_visited),0));
await asUser(1);
await check('colleague cannot read private employee activity',async()=>assert.equal((await db.query('select * from public.activity_events')).rows.length,0));
const competing=(await db.query('select public.request_property_lock($1,$2) as id',[property,'Another pending employee claim for same property'])).rows[0].id;
await asUser(2);
await db.query('select public.decide_property_lock($1,true,$2)',[lock,'Agreement verified independently by manager']);
await check('manager approval creates one effective reservation',async()=>assert.equal((await db.query('select * from public.v_effective_property_locks')).rows.length,1));
await check('second approval fails exclusivity constraint',()=>fails('select public.decide_property_lock($1,true,$2)',[competing,'Another agreement reviewed by manager'],'23505'));
await db.query('select public.review_property_visit($1,true)',[event]);
await check('confirmed visits count distinct property per VN day',async()=>assert.equal(Number((await db.query('select * from public.v_employee_daily_activity')).rows[0].confirmed_properties_visited),1));
const own=(await db.query('select public.request_property_lock($1,$2) as id',[other,'Manager own customer agreement pending review'])).rows[0].id;
await check('manager self approval forbidden',()=>fails('select public.decide_property_lock($1,true,$2)',[own,'Attempting self approval is forbidden'],'42501'));
const ownVisit=(await db.query("select public.record_property_activity($1,'site_visit',$2) as id",[other,'30000000-0000-4000-8000-000000000002'])).rows[0].id;
await check('manager self visit confirmation forbidden',()=>fails('select public.review_property_visit($1,true)',[ownVisit],'42501'));
await check('new address cannot contain district',()=>fails("insert into public.property_addresses(property_id,format,address_text,district_text) values($1,'current','Test','Quận 1')",[other],'23514'));
await check('unverified address stays in separate analytic bucket',async()=>assert.equal((await db.query('select * from public.v_admin_inventory_by_area')).rows[0].current_commune_label,'Chưa xác minh địa chỉ mới'));
const verifiedAddressSql="insert into public.property_addresses(property_id,format,address_text,province_unit_id,commune_unit_id,mapping_status,verification_method,source_url,effective_on,verified_by,verified_at,commune_text) values($1,'current','Fixture current address',$2,$3,'verified','manual','https://example.test/evidence',$4,$5,now(),'Untrusted label')";
await check('wrong current province/commune hierarchy rejected',()=>fails(verifiedAddressSql,[other,provinceB,commune,'2026-10-10',employees[2]]));
await check('verified address outside unit validity rejected',()=>fails(verifiedAddressSql,[other,provinceA,commune,'2024-10-10',employees[2]]));
await db.query(verifiedAddressSql,[other,provinceA,commune,'2026-10-10',employees[2]]);
await check('analytics uses canonical verified unit name',async()=>assert.ok((await db.query('select * from public.v_admin_inventory_by_area')).rows.some(r=>r.current_commune_label==='Fixture Commune')));
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
const fileId='40000000-0000-4000-8000-000000000001';let objectPath=`${property}/${fileId}/fixture.pdf`;
const testSha256='a'.repeat(64);const validationKey='b'.repeat(64);
const storageId='80000000-0000-4000-8000-000000000001';
const registerSql='select public.register_property_file($1,$2,$3,$4,$5,$6,$7) as result';
const completionSql='select public.complete_property_upload($1,$2,$3,$4,$5,$6)';
const registration=[fileId,property,'fixture.pdf','application/pdf',1024,testSha256,'document'];
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
  await fails(registerSql,[fileId,property,'changed.pdf','application/pdf',1024,testSha256,'document'],'42501');
  assert.deepEqual((await db.query('select id,original_filename,size_bytes from public.property_files where id=$1',[fileId])).rows,[{id:fileId,original_filename:'fixture.pdf',size_bytes:1024}]);
});
await check('unsafe names, empty and oversized expectations rejected atomically',async()=>{
  for(const [name,size] of [['../bad.pdf',1024],[' ',1024],['empty.pdf',0],['large.pdf',20971521]])
    await fails(registerSql,['40000000-0000-4000-8000-000000000002',property,name,'application/pdf',size,testSha256,'document'],'23514');
  assert.deepEqual((await db.query('select id from public.property_files')).rows,[{id:fileId}]);
});
await check('PDF cannot be registered with photo purpose',()=>fails(registerSql,['40000000-0000-4000-8000-000000000002',property,'scan.pdf','application/pdf',1024,testSha256,'photo'],'23514'));
await check('completion requires actual authoritative object identity and unforgeable attestation',async()=>{
  await fails(completionSql,completion,'23514');
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
await db.query(registerSql,[crossFile,other,'Ảnh nguồn.pdf','application/pdf',1024,testSha256,'document']);
await check('cross-owner contribution preserves uploader and grants no fact editing',async()=>{
  assert.deepEqual((await db.query('select property_id,uploaded_by,original_filename from public.property_files where id=$1',[crossFile])).rows,[{property_id:other,uploaded_by:employees[0],original_filename:'Ảnh nguồn.pdf'}]);
  assert.match((await db.query('select object_path from public.property_files where id=$1',[crossFile])).rows[0].object_path,/^[a-zA-Z0-9/.-]+$/);
  assert.deepEqual((await db.query("update public.properties set notes='unauthorized' where id=$1 returning id",[other])).rows,[]);
});
await check('validation secret inaccessible to ordinary clients',()=>fails('select * from private.file_validation_keys',[],'42501'));
await asUser(2);await db.query('update public.properties set archived_at=now() where id=$1',[other]);
await asUser(0);
await check('archiving hides uploader pending metadata and blocks further completion or registration',async()=>{
  assert.deepEqual((await db.query('select id from public.property_files where id=$1',[crossFile])).rows,[]);
  await fails(registerSql,['40000000-0000-4000-8000-000000000003',other,'archive.pdf','application/pdf',1024,testSha256,'document'],'42501');
  await fails(completionSql,[crossFile,storageId,'application/pdf',1024,testSha256,signature],'42501');
});
await asUser(2);await db.query('update public.properties set archived_at=null where id=$1',[other]);
await asUser(4);
await check('deactivated employee cannot read ready file',async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
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
await check('active lease protects inventory availability',()=>fails("update public.properties set status='available' where id=$1",[rentProperty],'23514'));
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
  for(const query of ['50%','%_','%_CODE']) assert.deepEqual((await db.query('select id from public.search_properties($1)',[query])).rows.map(row=>row.id),[literalProperty]);
});
await check('literal backslash is not an escape supplied by caller',async()=>assert.deepEqual((await db.query('select id from public.search_properties($1)',['\\'])).rows.map(row=>row.id),[literalProperty]));
await check('120 literal characters remain permitted after SQL escaping',async()=>assert.deepEqual((await db.query('select id from public.search_properties($1)',['%'.repeat(120)])).rows.map(row=>row.id),[literalProperty]));
await check('oversized raw query remains rejected by search',async()=>assert.deepEqual((await db.query('select id from public.search_properties($1)',['%'.repeat(121)])).rows,[]));
await check('address search is contiguous, not reordered tokens',async()=>assert.deepEqual((await db.query('select id from public.search_properties($1)',['trai nguyen'])).rows,[]));
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
await check('reviewer cannot submit an archived physical visit',()=>fails("select public.record_property_activity($1,'site_visit',$2)",[archivedProperty,'80000000-0000-4000-8000-000000000002'],'P0001'));
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
const report={checked_at:new Date().toISOString(),engine:'PGlite embedded PostgreSQL; mocked auth/storage schemas',passed,
 limitations:['Not a live Supabase integration test','HTTP Auth, signed URLs, Vercel and browser flows not exercised','True multi-session concurrent transaction test remains a staging acceptance gate']};
await fs.writeFile(path.join(root,'docs/validation-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${passed} assertions passed`);await db.close();
