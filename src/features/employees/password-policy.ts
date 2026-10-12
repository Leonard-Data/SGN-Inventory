// Canonical new-password policy for the recovery UI (ticket #51). Pure and
// testable; the backend still owns actual validation (8–128 characters).
export type PasswordRuleKey = 'len' | 'case' | 'digit' | 'symbol';

export type PasswordRule = {
  key: PasswordRuleKey;
  /** i18n key for the rule label. */
  label: 'ruleLength' | 'ruleCase' | 'ruleDigit' | 'ruleSymbol';
};

export const passwordRules: readonly PasswordRule[] = [
  { key: 'len', label: 'ruleLength' },
  { key: 'case', label: 'ruleCase' },
  { key: 'digit', label: 'ruleDigit' },
  { key: 'symbol', label: 'ruleSymbol' },
];

const tests: Record<PasswordRuleKey, (value: string) => boolean> = {
  len: (value) => value.length >= 10,
  case: (value) => /[a-z]/.test(value) && /[A-Z]/.test(value),
  digit: (value) => /\d/.test(value),
  symbol: (value) => /[^A-Za-z0-9]/.test(value),
};

export type PasswordEvaluation = {
  met: Record<PasswordRuleKey, boolean>;
  metCount: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export function evaluatePassword(value: string): PasswordEvaluation {
  const met = {} as Record<PasswordRuleKey, boolean>;
  let metCount = 0;
  for (const rule of passwordRules) {
    const ok = tests[rule.key](value);
    met[rule.key] = ok;
    if (ok) metCount += 1;
  }
  const level: PasswordEvaluation['level'] = !value
    ? 0
    : metCount <= 1
      ? 1
      : metCount === 2
        ? 2
        : metCount === 3
          ? 3
          : 4;
  return { met, metCount, level };
}

/** Strength verdict i18n key for a level (0 has no verdict — the meter is empty). */
export function strengthLabelKey(
  level: 0 | 1 | 2 | 3 | 4,
): 'strengthWeak' | 'strengthFair' | 'strengthGood' | 'strengthStrong' | null {
  return level === 0
    ? null
    : level === 1
      ? 'strengthWeak'
      : level === 2
        ? 'strengthFair'
        : level === 3
          ? 'strengthGood'
          : 'strengthStrong';
}
