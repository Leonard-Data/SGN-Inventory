import assert from 'node:assert/strict';
import test from 'node:test';
import { maintenanceError } from './messages.ts';

test('each conversion refusal states its own cause in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const missing = maintenanceError(locale, 'crosswalk-missing');
    const ambiguous = maintenanceError(locale, 'crosswalk-ambiguous');
    const superseded = maintenanceError(locale, 'address-superseded');
    const levelChange = maintenanceError(locale, 'crosswalk-level-change');
    const causes = [missing, ambiguous, superseded, levelChange];
    // A cause with its own code states its own reason instead of falling back to the generic one,
    // and no two causes read the same.
    for (const message of causes)
      assert.notEqual(message, maintenanceError(locale, 'unavailable'));
    assert.equal(new Set(causes).size, causes.length);
    // Reconciling and correcting the address is the remedy only when the crosswalk genuinely names
    // several units or a partial transfer; a ward with no conversion row yet, a row a correction
    // replaced and a unit the crosswalk states at another level all say no such remedy applies.
    const remedy =
      locale === 'vi'
        ? /Hãy đối chiếu và đính chính địa chỉ/
        : /Reconcile the address and correct it/;
    assert.match(ambiguous, remedy);
    assert.doesNotMatch(missing, remedy);
    assert.doesNotMatch(superseded, remedy);
    assert.doesNotMatch(levelChange, remedy);
    assert.match(
      missing,
      locale === 'vi'
        ? /chưa có dòng nào trong bảng chuyển đổi/
        : /no row in the official crosswalk/,
    );
    assert.match(
      superseded,
      locale === 'vi'
        ? /đã được đính chính bởi một bản mới hơn/
        : /later correction replaced this address/,
    );
    assert.match(
      levelChange,
      locale === 'vi'
        ? /cấp hành chính khác/
        : /different administrative level/,
    );
  }
});
