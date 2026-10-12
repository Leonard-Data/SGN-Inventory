export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly payload: Record<string, unknown> = {},
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
    const data: Record<string, unknown> = await response
      .json()
      .catch(() => ({}));
    throw new RequestError(
      response.status,
      typeof data.error === 'string' ? data.error : 'unavailable',
      data,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
