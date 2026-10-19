import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

// A window that has not arrived yet stands in as the shared skeleton, and the window that has
// arrived draws its own rows and no skeleton at all. Both fill the same reserved box, so the rows
// that replace the skeleton do not move the rest of the list.
test('a fetching table window is a skeleton; a resolved one is its rows', () => {
  const table = source('./property-table.tsx');
  assert.match(
    table,
    /import \{ LoadingSkeleton \} from '@\/features\/skeleton'/,
  );
  const fetching = table.indexOf('if (rows === null)');
  const resolved = table.indexOf('{rows.map');
  assert.ok(fetching > 0 && resolved > fetching, 'the two branches are found');
  const placeholder = table.slice(fetching, resolved);
  assert.match(placeholder, /<LoadingSkeleton/);
  assert.match(placeholder, /shape="table"/);
  // The skeleton fills the height the chunk already reserved for the incoming rows.
  assert.match(placeholder, /style=\{\{ height: reserved \}\}/);
  assert.doesNotMatch(table.slice(resolved), /LoadingSkeleton/);
});

test('a fetching card window is a skeleton; a resolved one is its cards', () => {
  const cards = source('./property-cards.tsx');
  assert.match(
    cards,
    /import \{ SkeletonCards \} from '@\/features\/skeleton'/,
  );
  const fetching = cards.indexOf('{rows === null ? (');
  const resolved = cards.indexOf('<PropertyCard');
  assert.ok(fetching > 0 && resolved > fetching, 'the two branches are found');
  assert.match(cards.slice(fetching, resolved), /<SkeletonCards/);
  assert.doesNotMatch(cards.slice(resolved), /SkeletonCards/);
  // The chunk box keeps the reserved height whether or not the rows are here.
  assert.match(
    cards,
    /style=\{\{ height: rows === null \? reserved : undefined \}\}/,
  );
});

// The placeholder is the shared skeleton, so it keeps the one polite announcement and the flash
// guard that keeps a window resolving inside it from painting anything.
test('the incoming window reuses the guarded skeleton region', () => {
  const primitive = source('../skeleton.tsx');
  assert.match(primitive, /SKELETON_REGION/);
  assert.match(primitive, /setTimeout\(\(\) => setShown\(true\),/);
  assert.match(
    source('./property-table.tsx'),
    /label=\{messages\[locale\]\.loading\}/,
  );
  assert.match(
    source('./property-cards.tsx'),
    /label=\{messages\[locale\]\.loading\}/,
  );
});
