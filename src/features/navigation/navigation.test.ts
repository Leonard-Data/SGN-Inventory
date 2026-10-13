import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { NAV_GROUPS, visibleNavGroups } from './navigation.ts';

// The rail never links to a page that does not exist: an item is added with the
// route it points at, in the same change (docs/interface-design.md §3.1).
test('every navigation destination has its route', () => {
  for (const group of NAV_GROUPS) {
    assert.ok(group.items.length, `group ${group.label} lists no destination`);
    for (const item of group.items) {
      const page = new URL(
        `../../app/(app)${item.href}/page.tsx`,
        import.meta.url,
      );
      assert.ok(existsSync(page), `${item.href} has no page`);
    }
  }
});

// Creating a property and submitting a correction are open to every role
// (docs/workflows-security.md), so both destinations are listed for each of them.
test('the create-property and correction destinations are offered to every role', () => {
  const roles = ['sales', 'staff', 'manager', 'admin'] as const;
  for (const role of roles) {
    const hrefs = visibleNavGroups(role).flatMap((group) =>
      group.items.map((item) => item.href),
    );
    assert.ok(hrefs.includes('/properties/new'), `${role}: no create`);
    assert.ok(
      hrefs.includes('/reviews/corrections'),
      `${role}: no corrections`,
    );
  }
});
