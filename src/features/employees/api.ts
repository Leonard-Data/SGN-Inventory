export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function isPropertyAccessFailure(failure: unknown) {
  return (
    failure instanceof RequestError &&
    failure.status === 404 &&
    failure.code === 'property-not-found'
  );
}
// Responses come from the application's typed JSON API; never expose raw remote diagnostics.
export async function api<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
    ...(body
      ? {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    const data: { error?: string } = await response.json().catch(() => ({}));
    throw new RequestError(response.status, data.error ?? 'unavailable');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
