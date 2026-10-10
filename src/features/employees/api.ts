export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
// Responses come from the application's typed JSON API; never expose raw remote diagnostics.
export async function api<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
    ...(body
      ? {
          method: 'POST',
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
