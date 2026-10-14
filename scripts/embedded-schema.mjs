import fs from 'node:fs/promises';
import path from 'node:path';

// Applies the mock Supabase Auth/Storage shims and every forward migration to any engine
// exposing an `exec(sql)` (PGlite) or `query(sql)` (node-postgres) multi-statement runner.
export async function applyEmbeddedSchema({ root, exec }) {
  await exec(`
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
  const files = (await fs.readdir(path.join(root, 'supabase/migrations')))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await exec(
      await fs.readFile(path.join(root, 'supabase/migrations', file), 'utf8'),
    );
    console.log('Applied', file);
  }
}
