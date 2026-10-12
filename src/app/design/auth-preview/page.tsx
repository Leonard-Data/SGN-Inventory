'use client';
import { useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { AuthShell } from '@/features/employees/auth-shell';
import {
  LanguageSwitch,
  PasswordField,
  PasswordStrength,
  StatusAlert,
  Stepper,
  TextField,
  buttonClass,
} from '@/features/employees/auth-ui';
import {
  evaluatePassword,
  type PasswordEvaluation,
} from '@/features/employees/password-policy';
import styles from './preview.module.css';

const noop = () => {};

// Review fixtures are assembled at runtime rather than written as literals, so
// the repository never contains a credential-shaped string.
function sample(counts: {
  lower?: number;
  upper?: number;
  digit?: number;
  symbol?: number;
}): string {
  return (
    'a'.repeat(counts.lower ?? 0) +
    'A'.repeat(counts.upper ?? 0) +
    '0'.repeat(counts.digit ?? 0) +
    '!'.repeat(counts.symbol ?? 0)
  );
}

const strongPassword = sample({ lower: 9, upper: 1, digit: 1, symbol: 1 });

const previewStrengths: { name: string; evaluation: PasswordEvaluation }[] = [
  { name: 'weak', evaluation: evaluatePassword(sample({ lower: 3 })) },
  {
    name: 'fair',
    evaluation: evaluatePassword(sample({ lower: 10, digit: 1 })),
  },
  {
    name: 'good',
    evaluation: evaluatePassword(sample({ lower: 9, upper: 1, digit: 1 })),
  },
  { name: 'strong', evaluation: evaluatePassword(strongPassword) },
];

/**
 * Isolated, review-only preview of the canonical authentication foundation
 * (ticket #50). It renders shared component states in VI/default and EN,
 * performs no authentication, collects no credentials and simulates no reset
 * link — every fixture below is static review data.
 */
export default function AuthPreviewPage() {
  const [locale, setLocale] = useState<Locale>('vi');
  const text = messages[locale];
  const strong = previewStrengths[3]!.evaluation;

  return (
    <div className={`sgn-auth ${styles.root}`}>
      <div className={styles.banner} role="note">
        <span className={styles.badge}>Review only</span>
        <span>
          Canonical SGN authentication design foundation preview. No
          authentication is performed and no credentials are collected.
        </span>
      </div>

      <div className={styles.toolbar}>
        <strong>{text.title}</strong>
        <LanguageSwitch
          locale={locale}
          onChange={setLocale}
          label={text.languageName}
        />
      </div>

      <h2 className={styles.heading}>Shell composition · sign in</h2>
      <AuthShell locale={locale} onLocaleChange={setLocale}>
        <section className="sgn-card" aria-labelledby="preview-signin">
          <p className="sgn-eyebrow">{text.brandMeta}</p>
          <h1 id="preview-signin">{text.login}</h1>
          <p className="sgn-lead">{text.signInHelp}</p>
          <form className="sgn-form" onSubmit={(e) => e.preventDefault()}>
            <TextField
              id="preview-email"
              name="preview-email"
              label={text.email}
              value=""
              onChange={noop}
              autoComplete="off"
              maxLength={254}
              placeholder={text.emailPlaceholder}
            />
            <PasswordField
              id="preview-password"
              name="preview-password"
              label={text.password}
              locale={locale}
              value="fixture-password"
              onChange={noop}
              autoComplete="off"
              placeholder="••••••••"
            />
            <div className="sgn-row">
              <label className="sgn-check" htmlFor="preview-remember">
                <input type="checkbox" id="preview-remember" defaultChecked />
                <span>{text.remember}</span>
              </label>
              <a
                className="sgn-link"
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                {text.recovery}
              </a>
            </div>
            <button
              type="button"
              className={buttonClass('primary', { block: true })}
            >
              <span className="sgn-btn-label">{text.login}</span>
            </button>
          </form>
          <p className="sgn-note">{text.accountNote}</p>
        </section>
      </AuthShell>

      <h2 className={styles.heading}>Recovery composition · new password</h2>
      <section className="sgn-card" aria-labelledby="preview-recovery">
        <Stepper locale={locale} current={2} />
        <p className="sgn-eyebrow">{text.recoveryEyebrow}</p>
        <h1 id="preview-recovery">{text.resetTitle}</h1>
        <p className="sgn-lead">{text.resetInstructions}</p>
        <form className="sgn-form" onSubmit={(e) => e.preventDefault()}>
          <PasswordField
            id="preview-new-password"
            name="preview-new-password"
            label={text.newPassword}
            locale={locale}
            value={strongPassword}
            onChange={noop}
            autoComplete="off"
            describedBy="preview-rules"
            placeholder="••••••••••"
          >
            <PasswordStrength
              locale={locale}
              evaluation={strong}
              rulesId="preview-rules"
            />
          </PasswordField>
          <PasswordField
            id="preview-confirm-password"
            name="preview-confirm-password"
            label={text.confirmPassword}
            locale={locale}
            value={strongPassword}
            onChange={noop}
            autoComplete="off"
            placeholder="••••••••••"
          />
          <button
            type="button"
            className={buttonClass('primary', { block: true })}
          >
            <span className="sgn-btn-label">{text.updatePassword}</span>
          </button>
          <button
            type="button"
            className={buttonClass('secondary', { block: true })}
          >
            <span className="sgn-btn-label">{text.stepBack}</span>
          </button>
        </form>
      </section>

      <h2 className={styles.heading}>Shared control states</h2>
      <div className={styles.gallery}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>Fields — default · invalid</p>
          <div className={styles.stack}>
            <TextField
              id="state-field-default"
              name="state-field-default"
              label={text.email}
              value=""
              onChange={noop}
              autoComplete="off"
              placeholder={text.emailPlaceholder}
            />
            <TextField
              id="state-field-invalid"
              name="state-field-invalid"
              label={text.email}
              value="not-an-email"
              onChange={noop}
              error={text.emailInvalid}
              errorId="state-field-invalid-error"
              invalid
              autoComplete="off"
            />
          </div>
        </div>

        <div className={styles.card}>
          <p className={styles.cardTitle}>Buttons & links</p>
          <div className={styles.stack}>
            <button
              type="button"
              className={buttonClass('primary', { block: true })}
            >
              <span className="sgn-btn-label">{text.login}</span>
            </button>
            <button
              type="button"
              className={buttonClass('primary', { block: true, loading: true })}
              aria-busy="true"
              aria-disabled="true"
            >
              <span className="sgn-btn-label">{text.signingIn}</span>
            </button>
            <button
              type="button"
              className={buttonClass('secondary', { block: true })}
            >
              <span className="sgn-btn-label">{text.stepBack}</span>
            </button>
            <button
              type="button"
              className={buttonClass('secondary', { block: true })}
              aria-disabled="true"
            >
              <span className="sgn-btn-label">{text.stepBack}</span>
            </button>
            <a
              className="sgn-link"
              href="#"
              onClick={(e) => e.preventDefault()}
            >
              {text.recovery}
            </a>
          </div>
        </div>

        <div className={styles.card}>
          <p className={styles.cardTitle}>Feedback</p>
          <div className={styles.stack}>
            <StatusAlert tone="success">{text.recoverySent}</StatusAlert>
            <StatusAlert tone="error">{text.recoveryInvalid}</StatusAlert>
          </div>
        </div>

        <div className={styles.card}>
          <p className={styles.cardTitle}>Stepper</p>
          <Stepper locale={locale} current={1} />
          <Stepper locale={locale} current={2} />
        </div>

        <div className={`${styles.card} ${styles.full}`}>
          <p className={styles.cardTitle}>Strength meter & rules — level 1→4</p>
          <div className={styles.gallery}>
            {previewStrengths.map(({ name, evaluation }) => (
              <div className={styles.stack} key={name}>
                <PasswordStrength
                  locale={locale}
                  evaluation={evaluation}
                  rulesId={`preview-rules-${name}`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card}>
          <p className={styles.cardTitle}>Completion panel</p>
          <div className={styles.stack}>
            <span className="sgn-done-mark">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m5 12.5 4.5 4.5L19 7" />
              </svg>
            </span>
            <div className="sgn-actions">
              <a
                className={buttonClass('primary', { block: true })}
                href="#"
                onClick={(e) => e.preventDefault()}
              >
                <span className="sgn-btn-label">{text.login}</span>
              </a>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <p className={styles.cardTitle}>Password reveal — pressed state</p>
          <PasswordField
            id="state-reveal"
            name="state-reveal"
            label={text.password}
            locale={locale}
            value="fixture-password"
            onChange={noop}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
