// Issue #69: the invitation acceptance boundary. The invitee's own session is the authority;
// the recorded invitation names the exact intended sign-in identity, and only a valid, current,
// correctly matched invitation completed by that identity can link, activate and name the
// retained employee. This module is pure so the guarded routes and the tests share exactly one
// interface, and nothing here claims a delivery, an acceptance or an access outcome.

import {
  isEmployeeRole,
  isUuid,
  normalizeEmail,
  type EmployeeRole,
} from './invitation.ts';

export const EMPLOYEE_NAME_MAX_LENGTH = 200;

export type AcceptedEmployee = {
  id: string;
  displayName: string;
  email: string;
  role: EmployeeRole;
  locale: 'vi' | 'en';
};

export type AcceptanceInput = {
  invitationId: string;
  revision: number;
  name: string;
  password: string;
  confirmPassword: string;
  locale: 'vi' | 'en';
};

export type AcceptanceSessionInput =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'cookie' };

export type AuthFailureClass = 'retryable' | 'definite';

// One classification for every Auth/provider error in this flow: a transient network/provider
// failure or a throttled request is retryable, while every other answer is a definite refusal
// of what was asked. Callers map the class to their own refusal, so the rule lives once.
export function classifyAuthFailure(
  error: { name?: string; status?: number } | null | undefined,
): AuthFailureClass {
  if (
    error &&
    (error.name === 'AuthRetryableFetchError' ||
      (error.status ?? 0) >= 500 ||
      error.status === 429)
  )
    return 'retryable';
  return 'definite';
}

// The required name is preserved exactly as typed, trimmed only: no case folding, no accent
// folding, no invented value, and a bounded safe length.
export function acceptanceName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name.length || [...name].length > EMPLOYEE_NAME_MAX_LENGTH) return null;
  return name;
}

// The backend password bound mirrors the recovery flow (8–128 characters) and requires the
// confirmation to match; the UI additionally shows the existing strength meter.
export function acceptancePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const length = [...value].length;
  if (length < 8 || length > 128) return null;
  return value;
}

// Exactly `{invitationId, revision, name, password, confirmPassword, locale}`. The invitation
// identity and revision come from the current recorded state, never from a retyped address,
// and no other key is accepted.
export function acceptanceBody(
  body: Record<string, unknown>,
): AcceptanceInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (
    keys.length !== 6 ||
    !keys.includes('invitationId') ||
    !keys.includes('revision') ||
    !keys.includes('name') ||
    !keys.includes('password') ||
    !keys.includes('confirmPassword') ||
    !keys.includes('locale')
  )
    return null;
  if (!isUuid(body.invitationId)) return null;
  if (
    typeof body.revision !== 'number' ||
    !Number.isInteger(body.revision) ||
    body.revision < 1
  )
    return null;
  const name = acceptanceName(body.name);
  if (!name) return null;
  const password = acceptancePassword(body.password);
  if (!password) return null;
  if (body.confirmPassword !== password) return null;
  if (body.locale !== 'vi' && body.locale !== 'en') return null;
  return {
    invitationId: body.invitationId,
    revision: body.revision,
    name,
    password,
    confirmPassword: body.confirmPassword,
    locale: body.locale,
  };
}

// The landing read accepts either a signed-in cookie session (`{}`) or the two fragments a
// delivered invite link carries; each token is bounded and nothing else is accepted, so a
// token is never inferred from unrelated query or fragment state.
export function acceptanceSessionBody(
  body: Record<string, unknown>,
): AcceptanceSessionInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length === 0) return { kind: 'cookie' };
  if (
    keys.length !== 2 ||
    !keys.includes('accessToken') ||
    !keys.includes('refreshToken')
  )
    return null;
  if (
    typeof body.accessToken !== 'string' ||
    !body.accessToken.length ||
    body.accessToken.length > 4096 ||
    typeof body.refreshToken !== 'string' ||
    !body.refreshToken.length ||
    body.refreshToken.length > 4096
  )
    return null;
  return {
    kind: 'tokens',
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

// The RPC projection is revalidated at the boundary: a malformed result is never rendered as
// an accepted employee or as a safe access outcome.
export function parseAcceptedEmployee(value: unknown): AcceptedEmployee | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isUuid(row.id)) return null;
  const displayName = acceptanceName(row.displayName);
  if (!displayName) return null;
  const email = normalizeEmail(row.email);
  if (!email || !isEmployeeRole(row.role)) return null;
  const locale = row.locale === 'en' ? 'en' : 'vi';
  return {
    id: row.id,
    displayName,
    email,
    role: row.role,
    locale,
  };
}
