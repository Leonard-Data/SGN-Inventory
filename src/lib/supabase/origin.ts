// The origin guard for state-changing route handlers. This module is pure so the routes and
// the tests share exactly one decision, and a hostname change cannot silently weaken it.

import type { Stage } from '../environment.ts';

type Headers = { get(name: string): string | null };

// The build-time app URL can disagree with the host the page is actually served from when a
// domain or alias changes, so a genuine same-origin POST must not depend on that value alone.
// `Sec-Fetch-Site` is set by the browser itself and cannot be forged by a cross-origin page,
// so `same-origin` is sufficient on its own. Only that exact value is trusted: `same-site`,
// `cross-site` and a missing header place no evidence of a same-origin submission on the table.
export function originAllowed(
  headers: Headers,
  environment: { stage: Stage; appUrl: string },
  requestOrigin: string,
): boolean {
  if (environment.stage !== 'prod') return true;
  const origin = headers.get('origin');
  if (origin === environment.appUrl || origin === requestOrigin) return true;
  if (headers.get('sec-fetch-site') === 'same-origin') return true;
  if (origin) return false;
  const referer = headers.get('referer');
  let refererOrigin = '';
  try {
    refererOrigin = referer ? new URL(referer).origin : '';
  } catch {
    refererOrigin = '';
  }
  return (
    refererOrigin === environment.appUrl || refererOrigin === requestOrigin
  );
}
