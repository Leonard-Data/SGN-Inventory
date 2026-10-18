import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityGroups } from './company-report-groups.ts';
import type { CompanyActivityRow } from './company-report-data.ts';

function row(patch: Partial<CompanyActivityRow>): CompanyActivityRow {
  return {
    employeeId: '10000000-0000-4000-8000-000000000001',
    employeeName: 'Fixture One',
    employeeEmail: 'one@example.test',
    businessDay: '2026-10-03',
    pageViewEvents: 0,
    distinctPropertiesViewed: 0,
    ownerContactProperties: 0,
    ...patch,
  };
}

test('each activity sits under the employee that recorded it', () => {
  const groups = activityGroups([
    row({ businessDay: '2026-10-03' }),
    row({
      employeeId: '10000000-0000-4000-8000-000000000002',
      employeeName: 'Fixture Two',
      employeeEmail: 'two@example.test',
      businessDay: '2026-10-03',
      pageViewEvents: 2,
    }),
    row({ businessDay: '2026-10-02', pageViewEvents: 1 }),
  ]);
  // Group order follows the report: the first appearance of an employee in the row order.
  assert.deepEqual(
    groups.map((group) => group.employeeEmail),
    ['one@example.test', 'two@example.test'],
  );
  const [first, second] = groups;
  assert.ok(first && second);
  assert.deepEqual(
    first.rows.map((value) => value.businessDay),
    ['2026-10-03', '2026-10-02'],
  );
  assert.equal(second.rows.length, 1);
});

test('the label count is the group rows that recorded activity', () => {
  const groups = activityGroups([
    row({ businessDay: '2026-10-03', pageViewEvents: 3 }),
    row({ businessDay: '2026-10-02' }),
    row({ businessDay: '2026-10-01', ownerContactProperties: 1 }),
  ]);
  const [group] = groups;
  assert.ok(group);
  // The explicit zero day stays in the group but is not counted as recorded activity.
  assert.equal(group.rows.length, 3);
  assert.equal(group.count, 2);
});

test('an employee with no activity in the range keeps a zero-count group', () => {
  const groups = activityGroups([row({ businessDay: '2026-10-03' })]);
  const [group] = groups;
  assert.ok(group);
  assert.equal(group.count, 0);
  assert.equal(group.employeeEmail, 'one@example.test');
  // No employees active in the range is the report's own empty state, not a group.
  assert.deepEqual(activityGroups([]), []);
});
