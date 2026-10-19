// The employee profile edit: the fields an admin may change on a colleague, and the narrower
// pair every active employee may change on themselves. The rule lives here once so the two
// guarded routes, both panels and the tests agree, and it mirrors what the database refuses:
// trimmed text, a bounded length, and plain text only (no markup, no link). Nothing here can
// address the email that identifies the account, and the self path has no employee at all.
import { EMPLOYEE_ROLES } from './invitation.ts';

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_NAME_MAX_LENGTH = 120;
export const EMPLOYEE_PHONE_MAX_LENGTH = 40;
// Documented limit for the bio, shown in both interfaces and enforced by the column check.
export const EMPLOYEE_BIO_MAX_LENGTH = 280;

export type ProfileField = 'displayName' | 'phone' | 'role' | 'bio';
export const PROFILE_FIELDS: readonly ProfileField[] = [
  'displayName',
  'phone',
  'role',
  'bio',
];

// An admin edits all four recorded fields; a person edits their own name and bio only.
export type EmployeeProfileValues = {
  displayName: string;
  phone: string;
  role: EmployeeRole;
  bio: string;
};
export type MyProfileValues = { displayName: string; bio: string };

export type ProfileProblem = {
  field: 'displayName' | 'phone' | 'bio';
  code: 'required' | 'too-long' | 'plain-text';
};

const linkPattern = /(https?:\/\/|www\.)/i;

// The same normalization the guarded functions apply: surrounding whitespace is trimmed and a
// blank value means "not written", never an empty recorded value.
export function profileText(value: string): string | null {
  const text = value.trim();
  return text.length ? text : null;
}

export function textProblem(
  field: ProfileProblem['field'],
  value: string,
): ProfileProblem | null {
  const text = value.trim();
  if (!text)
    return field === 'displayName' ? { field, code: 'required' } : null;
  const max =
    field === 'displayName'
      ? EMPLOYEE_NAME_MAX_LENGTH
      : field === 'phone'
        ? EMPLOYEE_PHONE_MAX_LENGTH
        : EMPLOYEE_BIO_MAX_LENGTH;
  if (text.length > max) return { field, code: 'too-long' };
  if (text.includes('<') || text.includes('>') || linkPattern.test(text))
    return { field, code: 'plain-text' };
  return null;
}

export function profileProblems(
  values: { displayName: string; phone?: string; bio: string },
  fields: readonly ProfileProblem['field'][],
): ProfileProblem[] {
  const problems: ProfileProblem[] = [];
  for (const field of fields) {
    const problem = textProblem(field, values[field] ?? '');
    if (problem) problems.push(problem);
  }
  return problems;
}

function roleValue(value: unknown): EmployeeRole | null {
  return EMPLOYEE_ROLES.includes(value as EmployeeRole)
    ? (value as EmployeeRole)
    : null;
}

// Exactly the four editable fields, each a string (phone and bio may be empty), and the role
// one of the recorded roles. Anything else is refused rather than dropped, and the email is
// not a field of this payload at all.
export function profileBody(
  body: Record<string, unknown>,
): EmployeeProfileValues | null {
  const keys = Object.keys(body);
  if (keys.length !== PROFILE_FIELDS.length) return null;
  if (!PROFILE_FIELDS.every((field) => keys.includes(field))) return null;
  const role = roleValue(body.role);
  if (
    typeof body.displayName !== 'string' ||
    typeof body.phone !== 'string' ||
    typeof body.bio !== 'string' ||
    !role
  )
    return null;
  if (
    profileProblems(
      { displayName: body.displayName, phone: body.phone, bio: body.bio },
      ['displayName', 'phone', 'bio'],
    ).length
  )
    return null;
  return {
    displayName: body.displayName,
    phone: body.phone,
    role,
    bio: body.bio,
  };
}

// The self path accepts its own two fields and nothing else: a payload naming a role, a phone,
// an email or an employee is refused by shape, before any query runs.
export function myProfileBody(
  body: Record<string, unknown>,
): MyProfileValues | null {
  const keys = Object.keys(body);
  if (
    keys.length !== 2 ||
    !keys.includes('displayName') ||
    !keys.includes('bio')
  )
    return null;
  if (typeof body.displayName !== 'string' || typeof body.bio !== 'string')
    return null;
  if (
    profileProblems({ displayName: body.displayName, bio: body.bio }, [
      'displayName',
      'bio',
    ]).length
  )
    return null;
  return { displayName: body.displayName, bio: body.bio };
}

// The recorded reply is revalidated at the boundary, so a malformed one is never rendered as a
// saved profile.
export function parseProfileUpdate(value: unknown): {
  changed: ProfileField[];
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.changed)) return null;
  const changed: ProfileField[] = [];
  for (const item of row.changed) {
    if (
      !PROFILE_FIELDS.includes(item as ProfileField) ||
      changed.includes(item as ProfileField)
    )
      return null;
    changed.push(item as ProfileField);
  }
  return { changed };
}

export function parseMyProfile(value: unknown): {
  displayName: string;
  bio: string | null;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.displayName !== 'string' || !row.displayName.trim())
    return null;
  if (row.bio !== null && typeof row.bio !== 'string') return null;
  return { displayName: row.displayName, bio: row.bio };
}

// A deactivated or deleted account keeps its record but is no longer editable: the panel shows
// the reason instead of a form that the database would refuse.
export function profileEditable(access: string): boolean {
  return access === 'active' || access === 'unlinked';
}
