import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const HOOK = source('./use-windows.ts');
const CHUNK = source('./stream-table-chunk.tsx');
const EMPLOYEES = source('../employees/employee-directory.tsx');
const CONTACTS = source('../contacts/directory-view.tsx');
const INVENTORY = source('../properties/inventory.tsx');

// A streamed list is the shared hook and the shared geometry, with its own row shape and its own
// read around them; a list that keeps its own copy of either is the drift this groundwork exists
// to prevent.
test('every streamed list reads the shared hook and the shared geometry', () => {
  for (const list of [EMPLOYEES, CONTACTS]) {
    assert.match(list, /useWindowStream[<(]/);
    assert.match(list, /useStreamLayout[<(]/);
    assert.match(list, /useCursorWindow[<(]/);
    assert.match(list, /<StreamTableChunk/);
    assert.match(list, /<StreamGap /);
    assert.match(list, /streamChunkRows\(/);
    assert.match(
      list,
      /streamKnownRows\(stream\.loaded, stream\.more === true\)/,
    );
    // Only the rows near the viewport are mounted, and the two gaps stand in for the rest.
    assert.match(list, /layout\.mounted\.map\(/);
    assert.match(list, /height=\{layout\.band\.top\}/);
    assert.match(list, /height=\{layout\.band\.bottom\}/);
  }
  // The properties list is untouched by the extraction: it still reads the stream its own way.
  assert.match(INVENTORY, /useInventoryStream\(\{/);
  assert.match(
    INVENTORY,
    /streamChunkRows\(windows, index \* chunkRows, chunkRows\)/,
  );
});

// The address names the one read, so a new search or filter is a new stream: the hook drops every
// window of the old result set and reads the first window of the new one.
test('a new search, filter or session starts the stream at its first window', () => {
  const reset = HOOK.indexOf('generation.current++');
  assert.ok(reset > 0);
  const branch = HOOK.slice(
    reset,
    HOOK.indexOf('}, [source, identity, read]);'),
  );
  assert.match(branch, /setWindows\(NO_WINDOWS\)/);
  assert.match(branch, /setLoaded\(0\)/);
  assert.match(branch, /setMore\(null\)/);
  assert.match(
    branch,
    /void read\(0, controller\.signal, generation\.current\)/,
  );
  // The search and the recorded view travel with every window: they build the one read the
  // stream is a window of, and a different one is a different source.
  assert.match(CONTACTS, /if \(query\) parameters\.set\('query', query\)/);
  assert.match(CONTACTS, /if \(view\) parameters\.set\('view', view\)/);
  assert.match(CONTACTS, /const source = employee \? endpoint : null/);
  assert.match(CONTACTS, /page: contactWindow/);
  // Every later window carries the same search and view with its own cursor.
  assert.match(
    source('./use-cursor-read.ts'),
    /cursorWindowUrl\(source, cursor\)/,
  );
});

// The skeleton is the chunk's own reservation: a chunk whose window has not arrived draws it,
// sized to the rows about to land, and a chunk whose rows are here draws them and no skeleton.
test('a fetching window is a skeleton and a resolved one is its rows', () => {
  const fetching = CHUNK.indexOf('if (rows === null)');
  const resolved = CHUNK.indexOf(
    'return <tbody ref={element}>{children}</tbody>',
  );
  assert.ok(fetching > 0 && resolved > fetching);
  assert.match(CHUNK.slice(fetching, resolved), /<LoadingSkeleton/);
  assert.match(CHUNK.slice(fetching, resolved), /shape="table"/);
  assert.match(CHUNK.slice(fetching, resolved), /rows=\{count\}/);
  assert.match(
    CHUNK.slice(fetching, resolved),
    /chunkReservation\(geometry\.heights, index\)/,
  );
  assert.doesNotMatch(CHUNK.slice(resolved), /LoadingSkeleton/);
  // The rows about to arrive are the chunk's own count, so the reservation is their size.
  for (const list of [EMPLOYEES, CONTACTS])
    assert.match(list, /Math\.max\(0, rows - index \* STREAM_CHUNK_ROWS\)/);
});

// Nothing that already worked may move: the directory stays admin-only, the contact row keeps the
// phone it recorded, and the row actions stay keyboard-reachable.
test('the lists keep the behaviour they had', () => {
  // Admin-only: the page is guarded by the live role and the read re-checks it.
  assert.match(source('../../app/api/employees/route.ts'), /mayReadDirectory/);
  assert.match(source('../../proxy.ts'), /mayReadDirectory/);
  // The contact row still states the recorded phone through the same projection.
  assert.match(CONTACTS, /\{phoneText\(record\)\}/);
  assert.match(CONTACTS, /function phoneText\(record: ContactSummary\)/);
  // The employee row's menu keeps its keyboard contract.
  assert.match(EMPLOYEES, /aria-haspopup="menu"/);
  assert.match(
    EMPLOYEES,
    /menuIndex\(event\.key, at >= 0 \? at : index, items\.length\)/,
  );
  // Both lists still fetch their windows through the same API routes as before.
  assert.match(EMPLOYEES, /DIRECTORY_ENDPOINT/);
  assert.match(CONTACTS, /'\/api\/contacts'/);
});
