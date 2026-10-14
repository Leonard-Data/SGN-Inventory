import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureRoute } from './refusal-rules.ts';

test('contact refusal stays inline while membership and identity denials leave the page', () => {
  assert.equal(failureRoute(403, 'contact-refusal'), 'inline');
  assert.equal(failureRoute(401, 'access-denied'), 'denied');
  assert.equal(failureRoute(403, 'access-denied'), 'denied');
  assert.equal(failureRoute(503, 'unavailable'), 'inline');
});
