'use client';
import {
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { messages, type Locale } from '@/i18n/messages';
import {
  passwordRules,
  strengthLabelKey,
  type PasswordEvaluation,
} from './password-policy';

/* Inline 24×24 stroke icons, 1.6–2px, currentColor, decorative. */
export function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </svg>
  );
}

export function buttonClass(
  variant: 'primary' | 'secondary',
  options: { block?: boolean; loading?: boolean } = {},
): string {
  return [
    'sgn-btn',
    variant === 'primary' ? 'sgn-btn-primary' : 'sgn-btn-secondary',
    options.block ? 'sgn-btn-block' : '',
    options.loading ? 'is-loading' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function LanguageSwitch({
  locale,
  onChange,
  disabled = false,
  label,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
  label: string;
}) {
  const text = messages[locale];
  return (
    <div className="sgn-lang-switch" role="group" aria-label={label}>
      <button
        type="button"
        className="sgn-lang-btn"
        lang="vi"
        aria-pressed={locale === 'vi'}
        aria-label={text.switchToVi}
        disabled={disabled}
        onClick={() => onChange('vi')}
      >
        {text.viLanguage}
      </button>
      <button
        type="button"
        className="sgn-lang-btn"
        lang="en"
        aria-pressed={locale === 'en'}
        aria-label={text.switchToEn}
        disabled={disabled}
        onClick={() => onChange('en')}
      >
        {text.enLanguage}
      </button>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p className="sgn-field-error" id={id} hidden={!message}>
      {message ? (
        <>
          <AlertIcon />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}

export function TextField({
  id,
  name,
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  errorId,
  invalid,
  type = 'email',
  autoComplete,
  maxLength,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  error?: string;
  errorId?: string;
  invalid?: boolean;
  type?: 'email' | 'text';
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <div className={'sgn-field' + (invalid ? ' is-invalid' : '')}>
      <label htmlFor={id}>{label}</label>
      <span className="sgn-input-wrap">
        <input
          id={id}
          name={name}
          ref={inputRef}
          className="sgn-input"
          type={type}
          inputMode={type === 'email' ? 'email' : undefined}
          autoComplete={autoComplete}
          spellCheck={false}
          maxLength={maxLength}
          placeholder={placeholder}
          required
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={errorId}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          onBlur={onBlur}
        />
      </span>
      {errorId ? <FieldError id={errorId} message={error ?? ''} /> : null}
    </div>
  );
}

export function PasswordField({
  id,
  name,
  label,
  locale,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  errorId,
  invalid,
  autoComplete,
  maxLength,
  placeholder,
  minLength,
  describedBy,
  children,
}: {
  id: string;
  name: string;
  label: string;
  locale: Locale;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  error?: string;
  errorId?: string;
  invalid?: boolean;
  autoComplete?: string;
  maxLength?: number;
  minLength?: number;
  placeholder?: string;
  describedBy?: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const text = messages[locale];
  const described = [errorId, describedBy].filter(Boolean).join(' ');
  return (
    <div className={'sgn-field' + (invalid ? ' is-invalid' : '')}>
      <div className="sgn-label-row">
        <label htmlFor={id}>{label}</label>
      </div>
      <span className="sgn-input-wrap has-reveal">
        <input
          id={id}
          name={name}
          ref={inputRef}
          className="sgn-input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={maxLength}
          minLength={minLength}
          placeholder={placeholder}
          required
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={described || undefined}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          onBlur={onBlur}
        />
        <button
          type="button"
          className="sgn-reveal"
          aria-pressed={shown}
          aria-label={shown ? text.hidePassword : text.showPassword}
          onClick={() => {
            setShown((current) => !current);
            inputRef?.current?.focus({ preventScroll: true });
          }}
        >
          <EyeIcon />
        </button>
      </span>
      {errorId ? <FieldError id={errorId} message={error ?? ''} /> : null}
      {children}
    </div>
  );
}

export function PasswordStrength({
  locale,
  evaluation,
  rulesId,
}: {
  locale: Locale;
  evaluation: PasswordEvaluation;
  rulesId: string;
}) {
  const text = messages[locale];
  const verdictKey = strengthLabelKey(evaluation.level);
  return (
    <>
      <div
        className="sgn-strength"
        data-level={evaluation.level}
        aria-hidden="true"
      >
        <div className="sgn-strength-head">
          <span>{text.strength}</span>
          <span className="sgn-strength-label">
            {verdictKey ? text[verdictKey] : '—'}
          </span>
        </div>
        <div className="sgn-strength-track">
          <span className="sgn-strength-seg" />
          <span className="sgn-strength-seg" />
          <span className="sgn-strength-seg" />
          <span className="sgn-strength-seg" />
        </div>
      </div>
      <ul className="sgn-rules" id={rulesId}>
        {passwordRules.map((rule) => (
          <li
            key={rule.key}
            className={'sgn-rule' + (evaluation.met[rule.key] ? ' is-met' : '')}
          >
            <span>{text[rule.label]}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Stepper({
  locale,
  current,
}: {
  locale: Locale;
  current: 1 | 2 | 3;
}) {
  const text = messages[locale];
  const steps: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: text.stepVerify },
    { n: 2, label: text.stepPassword },
    { n: 3, label: text.stepDone },
  ];
  return (
    <ol className="sgn-stepper">
      {steps.map((step) => (
        <li
          key={step.n}
          className={
            'sgn-step' +
            (step.n < current ? ' is-done' : '') +
            (step.n === current ? ' is-active' : '')
          }
          aria-current={step.n === current ? 'step' : undefined}
        >
          <b className="sgn-num">{String(step.n).padStart(2, '0')}</b>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function StatusAlert({
  tone,
  id,
  live,
  children,
  innerRef,
}: {
  tone: 'success' | 'error' | 'status';
  id?: string;
  live?: 'polite';
  children: ReactNode;
  innerRef?: RefObject<HTMLParagraphElement | null>;
}) {
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <p
      className={'sgn-status' + (tone === 'error' ? ' sgn-status-error' : '')}
      id={id}
      role={role}
      aria-live={live}
      tabIndex={tone === 'error' ? -1 : undefined}
      ref={innerRef}
    >
      {tone === 'success' || tone === 'status' ? <CheckIcon /> : <AlertIcon />}
      <span>{children}</span>
    </p>
  );
}
