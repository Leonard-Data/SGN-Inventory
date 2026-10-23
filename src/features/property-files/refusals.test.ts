// Reproduction of the reported defect: an upload refused by the workspace's own endpoint sent the
// person off the record and onto the access-denied page, with their work gone. The refusal that
// reproduces it is `complete` answering 403 for a file another employee registered (the uploader
// check in `upload-data.ts`), which the panel read as a lost session. Every assertion below is that
// same reproduction: a record-scoped refusal must stay in the panel, a lost session must not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionLost } from './refusals.ts';
import { fileMessages } from './messages.ts';

const problem = (status: number, code: string) => ({ status, code });

test('a file recorded by another employee states its reason instead of ejecting', () => {
  assert.equal(sessionLost(problem(403, 'not-uploader')), false);
});

test('a record that no longer accepts files states its reason instead of ejecting', () => {
  assert.equal(sessionLost(problem(403, 'property-unavailable')), false);
});

test('a permission error on this operation states its reason instead of ejecting', () => {
  assert.equal(sessionLost(problem(403, 'operation-refused')), false);
});

test('the file-shaped refusals already stated in the panel still stay there', () => {
  for (const code of [
    'unsupported-format',
    'file-too-large',
    'document-limit',
    'image-limit',
    'invalid-file',
    'file-mismatch',
    'missing-bytes',
    'file-conflict',
    'not-found',
    'invalid-cover',
    'invalid-category',
    'unavailable',
  ])
    for (const status of [400, 404, 409, 503])
      assert.equal(sessionLost(problem(status, code)), false, code);
});

test('a genuinely lost session leaves the page', () => {
  assert.equal(sessionLost(problem(401, 'unauthenticated')), true);
  // The session guard's own answer: no active employee behind this identity.
  assert.equal(sessionLost(problem(403, 'access-denied')), true);
});

test('every refusal the panel can state has VI and EN wording', () => {
  for (const code of [
    'not-uploader',
    'property-unavailable',
    'operation-refused',
  ])
    for (const locale of ['vi', 'en'] as const) {
      const wording = fileMessages[locale].errors[code] ?? '';
      assert.ok(wording.trim().length > 0, `${locale}.${code} must be stated`);
    }
});
