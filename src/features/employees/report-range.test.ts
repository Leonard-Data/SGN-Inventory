import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultRange,
  ReportRangeError,
  reportRange,
  vietnamToday,
} from './report-range.ts';

function rejected(
  requested: { from: string | null; to: string | null },
  code: 'invalid-input' | 'invalid-range',
) {
  assert.throws(
    () => reportRange(requested, '2026-10-13'),
    (error) => error instanceof ReportRangeError && error.code === code,
  );
}

test('the default report period is today and the preceding 29 Vietnam days', () => {
  assert.deepEqual(defaultRange('2026-10-13'), {
    from: '2026-09-14',
    to: '2026-10-13',
  });
  // Inclusive boundaries: the default period covers exactly 30 Vietnam days.
  assert.deepEqual(reportRange({ from: null, to: null }, '2026-10-13'), {
    from: '2026-09-14',
    to: '2026-10-13',
  });
});

test('a selected period is accepted inclusively and an invalid one is rejected', () => {
  assert.deepEqual(
    reportRange({ from: '2026-10-01', to: '2026-10-13' }, '2026-10-13'),
    { from: '2026-10-01', to: '2026-10-13' },
  );
  // 365 days of difference is accepted; one more is rejected.
  assert.deepEqual(
    reportRange({ from: '2025-01-01', to: '2026-01-01' }, '2026-10-13'),
    { from: '2025-01-01', to: '2026-01-01' },
  );
  rejected({ from: '2025-01-01', to: '2026-01-02' }, 'invalid-range');
  rejected({ from: '2026-10-14', to: '2026-10-13' }, 'invalid-range');
  rejected({ from: '2026-02-30', to: '2026-03-01' }, 'invalid-input');
  rejected({ from: '2026-2-1', to: '2026-03-01' }, 'invalid-input');
  rejected({ from: 'not-a-date', to: '2026-03-01' }, 'invalid-input');
  rejected({ from: '', to: '2026-03-01' }, 'invalid-input');
  rejected({ from: '2026-03-01', to: null }, 'invalid-input');
  rejected({ from: null, to: '2026-03-01' }, 'invalid-input');
});

test('the Vietnam business day does not follow the server or browser timezone', () => {
  assert.equal(vietnamToday(new Date('2026-10-12T16:59:00Z')), '2026-10-12');
  assert.equal(vietnamToday(new Date('2026-10-12T17:00:00Z')), '2026-10-13');
  assert.equal(
    vietnamToday(new Date('2026-10-13T00:00:00+07:00')),
    '2026-10-13',
  );
});
