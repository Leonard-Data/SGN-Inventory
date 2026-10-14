// A membership or identity denial ends the session; an object-level contact refusal keeps the page.
export type FailureRoute = 'denied' | 'inline';
export function failureRoute(
  status: number,
  code: string | null | undefined,
): FailureRoute {
  if (status === 401) return 'denied';
  if (status !== 403) return 'inline';
  return code === 'contact-refusal' ? 'inline' : 'denied';
}
