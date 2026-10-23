// One-off operator script: fold the records that share one address into the most complete one,
// on one project at a time.
//
// The groups are the ones the application itself reports: the unarchived records whose primary
// addresses carry the same normalised text, compared by `private.address_match_key` - the one
// definition of "the same address" the shared-address group read and the merge guard already
// use - and closed over every primary address a record holds, so two records that share both
// their legacy and their current address are one group rather than two. The surviving record is
// the one the merge feature keeps: `private.property_completeness` descending, then the earliest
// recorded creation, then identity. A group whose members share no single address key, and one
// whose first two members cannot be told apart by that order, is refused and reported instead of
// guessed, because neither fold is one the merge function would make on the members' behalf.
//
// Nothing is written by hand: execute mode performs each group through the application's own
// merge (`POST /api/properties/[id]/duplicates`), so the ready files of a folded record are
// copied to the survivor's key and attested, the manager role is checked, and the database
// archives exactly the folded records in one transaction. The read is the only database access,
// and it is a read: an administrative connection is used because no endpoint lists the groups.
// A second run finds nothing to do, because the folded records are archived and the group a
// merged record belonged to is gone.
//
// Required environment (server-side only, never NEXT_PUBLIC_*):
//   dry run: IMPORT_DATABASE_URL (the administrative connection the import uses),
//            EXPECTED_SUPABASE_PROJECT_REF (the project the run intends to change)
//   execute: also NEXT_PUBLIC_APP_URL, SGN_MANAGER_EMAIL, SGN_MANAGER_PASSWORD - a manager or
//            admin of that project, because only those roles may merge.
//
// Usage:
//   node scripts/merge-duplicate-addresses.mjs             # dry run: print every group
//   node scripts/merge-duplicate-addresses.mjs --execute   # perform the merges, then re-read
//
// Nothing is deleted and no archived record is read or touched: a fold archives the record it
// removes and leaves its files, contacts and history on the survivor. Records held by an
// effective reservation, an active rental agreement or a pending reservation request are not
// merged away, and the run reports them rather than deciding anybody's agreement.
import { pathToFileURL } from 'node:url';
import {
  declaredStage,
  projectRefFromDatabaseUrl,
  PRODUCTION_APP_URL,
} from './legacy-import-write.mjs';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for this script`);
  return value;
}

// Primary addresses of the unarchived records, one row per (address key, record), with the facts
// the survivor order and the merge function's own refusals need. The archive boundary is stated
// here and again by the merge; a blank recorded text normalises to no key and never groups.
const memberRows = `
  select distinct on (private.address_match_key(a.address_text), p.id)
    private.address_match_key(a.address_text) as key,
    p.id, p.property_code, p.created_at, a.address_text,
    private.property_completeness(p.id) as completeness,
    exists (select 1 from public.property_locks l
            where l.property_id = p.id and l.status = 'approved' and l.expires_at > now()) as reserved,
    exists (select 1 from public.rental_agreements r
            where r.property_id = p.id and r.status = 'active') as rented,
    exists (select 1 from public.property_locks l
            where l.property_id = p.id and l.status = 'pending') as pending
  from public.properties p
  join public.property_addresses a on a.property_id = p.id and a.is_primary
  where p.archived_at is null
  order by private.address_match_key(a.address_text), p.id, a.format`;

// The merge feature's surviving-record order: the most complete record, then the one recorded
// first, then identity - the same order `property_address_group` and the merge guard apply.
const survives = (first, second) =>
  second.completeness - first.completeness ||
  (first.created_at < second.created_at
    ? -1
    : first.created_at > second.created_at
      ? 1
      : 0) ||
  (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);

// Pure planning step: the address keys are the edges, so the connected records are the group the
// application shows, and every group names one survivor and the records to fold into it.
export function planGroups(rows) {
  const records = new Map();
  const byKey = new Map();
  for (const row of rows) {
    if (!row.key) continue;
    if (!records.has(row.id))
      records.set(row.id, { ...row, keys: new Set(), texts: new Map() });
    const record = records.get(row.id);
    record.keys.add(row.key);
    if (!record.texts.has(row.key)) record.texts.set(row.key, row.address_text);
    if (!byKey.has(row.key)) byKey.set(row.key, []);
    byKey.get(row.key).push(row.id);
  }

  const parent = new Map();
  for (const id of records.keys()) parent.set(id, id);
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  for (const ids of byKey.values())
    for (const id of ids.slice(1)) {
      const left = find(ids[0]);
      const right = find(id);
      if (left !== right) parent.set(left, right);
    }

  const components = new Map();
  for (const id of records.keys()) {
    const root = find(id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(records.get(id));
  }

  const groups = [];
  const refused = [];
  for (const members of components.values()) {
    if (members.length < 2) continue;
    const codes = members.map((member) => member.property_code).sort();
    const shared = [...members[0].keys].filter((key) =>
      members.every((member) => member.keys.has(key)),
    );
    if (!shared.length) {
      refused.push({ codes, reason: 'no-shared-address-key' });
      continue;
    }
    const ordered = [...members].sort(survives);
    if (survives(ordered[0], ordered[1]) === 0) {
      refused.push({ codes, reason: 'ambiguous-survivor' });
      continue;
    }
    const [keep, ...folded] = ordered;
    groups.push({
      keep: { id: keep.id, code: keep.property_code },
      folded: folded.map((member) => ({
        id: member.id,
        code: member.property_code,
      })),
      key: shared[0],
      addressText: keep.texts.get(shared[0]),
      // Advisory: the merge function decides, and refuses the same groups itself.
      blocked: folded
        .flatMap((member) => [
          member.reserved ? 'reserved' : null,
          member.rented ? 'rented' : null,
          member.pending ? 'pending-request' : null,
        ])
        .filter(Boolean),
    });
  }
  groups.sort((left, right) => (left.keep.code < right.keep.code ? -1 : 1));
  refused.sort((left, right) => (left.codes[0] < right.codes[0] ? -1 : 1));
  return { groups, refused };
}

function report(plan, projectRef, mode) {
  const folded = plan.groups.reduce(
    (total, group) => total + group.folded.length,
    0,
  );
  const blocked = plan.groups.filter((group) => group.blocked.length).length;
  console.log(`mode: ${mode}; project: ${projectRef}`);
  console.log(`duplicate groups: ${plan.groups.length}`);
  console.log(`records to fold: ${folded}`);
  if (blocked)
    console.log(`groups the merge cannot take yet: ${blocked} (listed below)`);
  for (const group of plan.groups)
    console.log(
      `  ${group.keep.code} <- ${group.folded.map((member) => member.code).join(', ')}` +
        ` | ${group.addressText}` +
        (group.blocked.length ? ` | blocked: ${group.blocked.join(', ')}` : ''),
    );
  console.log(`refused groups: ${plan.refused.length}`);
  for (const group of plan.refused)
    console.log(`  ${group.codes.join(', ')} | ${group.reason}`);
}

// The application's own merge for one group: it copies and attests the folded record's ready
// files, re-checks the role, the address and the surviving record, and archives the folded
// records. The manager signs in through the same route the browser uses, so the session is the
// server's and nothing is impersonated from this side.
async function signIn(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, locale: 'vi' }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `sign-in failed: ${response.status} ${body.error ?? 'unknown'}`,
    );
  const cookies = response.headers
    .getSetCookie()
    .map((raw) => raw.split(';')[0])
    .filter((pair) => pair.startsWith('sb-'));
  if (!cookies.length) throw new Error('sign-in returned no session cookie');
  return { cookies: cookies.join('; '), employee: body.employee };
}

export async function mergeGroup(baseUrl, session, group, request = fetch) {
  const response = await request(
    `${baseUrl}/api/properties/${group.keep.id}/duplicates`,
    {
      method: 'POST',
      headers: {
        origin: baseUrl,
        'content-type': 'application/json',
        cookie: session.cookies,
      },
      body: JSON.stringify({
        merge: group.folded.map((member) => member.id),
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (response.ok) return { merged: body };
  // A lost session or a changed role is not one group's problem: stop the run.
  if (response.status === 401 || response.status === 403)
    throw new Error(
      `merge refused for ${group.keep.code}: ${response.status} ${body.error ?? 'unknown'}`,
    );
  return { refusal: `${response.status} ${body.error ?? 'unknown'}` };
}

async function read(db) {
  const rows = (await db.query(memberRows)).rows;
  console.log(`records read: ${new Set(rows.map((row) => row.id)).size}`);
  return planGroups(rows);
}

const main = async () => {
  const execute = process.argv.includes('--execute');
  const databaseUrl = required('IMPORT_DATABASE_URL');
  const expectedRef = required('EXPECTED_SUPABASE_PROJECT_REF');
  const projectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (projectRef !== expectedRef)
    throw new Error(
      `IMPORT_DATABASE_URL names ${projectRef ?? 'no project'}, not the project this run states (${expectedRef})`,
    );
  const appUrl = execute
    ? new URL(required('NEXT_PUBLIC_APP_URL')).origin
    : null;
  if (appUrl && declaredStage() === 'prod' && appUrl !== PRODUCTION_APP_URL)
    throw new Error(
      `NEXT_PUBLIC_APP_URL names ${appUrl}, not the production application ${PRODUCTION_APP_URL}`,
    );

  const { default: pg } = await import('pg');
  const db = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
  });
  await db.connect();
  try {
    const plan = await read(db);
    report(plan, projectRef, execute ? 'execute' : 'dry-run');
    if (!execute) return;

    const email = required('SGN_MANAGER_EMAIL');
    const session = await signIn(
      appUrl,
      email,
      required('SGN_MANAGER_PASSWORD'),
    );
    if (
      session.employee?.role !== 'manager' &&
      session.employee?.role !== 'admin'
    )
      throw new Error(
        `${email} is not a manager or admin (${session.employee?.role ?? 'no employee'})`,
      );
    console.log(`signed in as ${email} (${session.employee.role})`);

    let mergedRecords = 0;
    const failed = [];
    for (const group of plan.groups) {
      if (group.blocked.length) {
        failed.push(
          `${group.keep.code} | blocked: ${group.blocked.join(', ')}`,
        );
        continue;
      }
      const outcome = await mergeGroup(appUrl, session, group);
      if (outcome.refusal) {
        failed.push(`${group.keep.code} | ${outcome.refusal}`);
        continue;
      }
      const merged = outcome.merged.merged ?? [];
      mergedRecords += merged.length;
      console.log(
        `merged ${group.keep.code} <- ${merged.map((member) => member.propertyCode).join(', ')}` +
          ` (files ${outcome.merged.moved.files}, contacts ${outcome.merged.moved.contactLinks}, history ${outcome.merged.moved.history})`,
      );
    }
    console.log(
      `merged records: ${mergedRecords}; groups not merged: ${failed.length}`,
    );
    for (const line of failed) console.log(`  ${line}`);

    const remaining = await read(db);
    console.log(
      `duplicate groups remaining: ${remaining.groups.length}; refused groups: ${remaining.refused.length}`,
    );
    if (remaining.groups.length || failed.length) process.exitCode = 1;
  } finally {
    await db.end();
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
