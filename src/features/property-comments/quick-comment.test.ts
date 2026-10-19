// The quick view's comment composer: the rules it refuses on, and the key discipline that makes a
// retry converge on one comment. The transport is a stub, so what is sent and what is sent again
// is asserted rather than inferred.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quickComment,
  quickCommentRefusal,
  type QuickComment,
  type QuickCommentTransport,
} from './quick-comment.ts';
import { COMMENT_MAX_LENGTH } from './types.ts';

const saved = (body: string): QuickComment => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  authorName: 'Nguyễn Thu Hà',
  body,
  createdAt: '2026-10-18T09:00:00+07:00',
  removedAt: null,
});

// A composer whose transport answers with the queued responses, recording every send: the body the
// path would post, under the key a retry would replay.
function posting(responses: (() => Promise<QuickComment>)[]) {
  const sent: { body: string; key: string }[] = [];
  let keys = 0;
  const composer = quickComment({
    uuid: () => `key-${++keys}`,
    transport: {
      post: (body, key) => {
        sent.push({ body, key });
        return (responses.shift() ?? (() => Promise.resolve(saved(body))))();
      },
    },
  });
  return { composer, sent, keysUsed: () => keys };
}

test('a comment is refused before any request when it is empty or too long', () => {
  assert.equal(quickCommentRefusal(''), 'comment-required');
  assert.equal(quickCommentRefusal('   '), 'comment-required');
  assert.equal(quickCommentRefusal('\n\t '), 'comment-required');
  assert.equal(quickCommentRefusal('ok'), null);
  const atLimit = 'a'.repeat(COMMENT_MAX_LENGTH);
  assert.equal(quickCommentRefusal(atLimit), null);
  assert.equal(quickCommentRefusal(atLimit + 'a'), 'comment-too-long');
  // Length is counted in characters, not UTF-16 units: an astral character is one character.
  const emoji = '👍'.repeat(COMMENT_MAX_LENGTH);
  assert.equal(emoji.length, COMMENT_MAX_LENGTH * 2);
  assert.equal(quickCommentRefusal(emoji), null);
  assert.equal(quickCommentRefusal(emoji + '👍'), 'comment-too-long');
});

test('one key per draft: retries replay it, success and conflict retire it', async () => {
  const { composer, sent, keysUsed } = posting([
    () => Promise.resolve(saved('first')),
    () => Promise.reject({ code: 'unavailable', status: 503 }),
    () => Promise.resolve(saved('second')),
    () => Promise.reject({ code: 'comment-conflict', status: 409 }),
    () => Promise.resolve(saved('third')),
  ]);
  // A refusal never reaches the transport and never spends a key.
  assert.deepEqual(await composer.submit('   '), {
    ok: false,
    code: 'comment-required',
    status: null,
  });
  assert.deepEqual(sent, []);
  // The sent body is the trimmed text; the key is the draft's own.
  const first = await composer.submit('  first  ');
  assert.equal(first.ok, true);
  assert.deepEqual(sent.at(-1), { body: 'first', key: 'key-1' });
  // An ambiguous failure keeps the draft's key, so the retry converges on one comment...
  const failed = await composer.submit('second');
  assert.deepEqual(failed, { ok: false, code: 'unavailable', status: 503 });
  assert.deepEqual(sent.at(-1), { body: 'second', key: 'key-2' });
  const retried = await composer.submit('second');
  assert.equal(retried.ok, true);
  assert.deepEqual(sent.at(-1), { body: 'second', key: 'key-2' });
  // ...while a conflict proves the key can never succeed and retires it.
  const conflicted = await composer.submit('third');
  assert.deepEqual(conflicted, {
    ok: false,
    code: 'comment-conflict',
    status: 409,
  });
  assert.deepEqual(sent.at(-1), { body: 'third', key: 'key-3' });
  const after = await composer.submit('third');
  assert.equal(after.ok, true);
  assert.deepEqual(sent.at(-1), { body: 'third', key: 'key-4' });
  assert.equal(keysUsed(), 4);
});

test('a failure keeps its code and status, and a bare failure states unavailable', async () => {
  const { composer } = posting([
    () => Promise.reject({ code: 'access-denied', status: 403 }),
    () => Promise.reject({ code: '', status: 401 }),
    () => Promise.reject(new Error('network down')),
    () => Promise.reject(null),
  ]);
  assert.deepEqual(await composer.submit('one'), {
    ok: false,
    code: 'access-denied',
    status: 403,
  });
  // An empty code is no code; the status still travels so the caller can clear a protected surface.
  assert.deepEqual(await composer.submit('two'), {
    ok: false,
    code: 'unavailable',
    status: 401,
  });
  assert.deepEqual(await composer.submit('three'), {
    ok: false,
    code: 'unavailable',
    status: null,
  });
  assert.deepEqual(await composer.submit('four'), {
    ok: false,
    code: 'unavailable',
    status: null,
  });
  // The composer's own refusal vocabulary is the module's, so no caller invents a second one.
  assert.equal(composer.refusal, quickCommentRefusal);
});

test('the success answer carries the recorded comment back to the list', async () => {
  const recorded = saved('xin chào');
  const transport: QuickCommentTransport = {
    post: () => Promise.resolve(recorded),
  };
  const composer = quickComment({ transport, uuid: () => 'fixed-key' });
  const outcome = await composer.submit('xin chào');
  assert.deepEqual(outcome, { ok: true, comment: recorded });
});
