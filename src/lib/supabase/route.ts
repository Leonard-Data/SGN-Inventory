import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Environment } from '@/lib/environment';
import type { Database } from '@/types/database';
import { readEnvironment } from '@/lib/environment';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
};
export interface RouteContext {
  client: SupabaseClient<Database>;
  environment: Environment;
  finish: (response: NextResponse) => NextResponse;
  setLocale: (locale: 'vi' | 'en') => void;
  setSessionPersistence: (persist: boolean) => void;
}
export function createRouteContext(request: NextRequest): RouteContext {
  const environment = readEnvironment(
    process.env,
    process.env.EXPECTED_SUPABASE_PROJECT_REF,
  );
  const pending = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const cacheHeaders = new Headers(privateHeaders);
  const client = createServerClient<Database>(
    environment.supabaseUrl,
    environment.publishableKey,
    {
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values, headers) => {
          for (const value of values) {
            request.cookies.set(value.name, value.value);
            pending.set(value.name, value);
          }
          for (const [name, value] of Object.entries(headers))
            cacheHeaders.set(name, value);
        },
      },
    },
  );
  function finish(response: NextResponse) {
    for (const cookie of pending.values())
      response.cookies.set(cookie.name, cookie.value, {
        ...cookie.options,
        httpOnly: true,
        secure: environment.appUrl.startsWith('https://'),
      });
    cacheHeaders.forEach((value, name) => response.headers.set(name, value));
    response.headers.set('Cache-Control', privateHeaders['Cache-Control']);
    return response;
  }
  // Presentation only: authorization and saved employee preference never come from this cookie.
  function setLocale(locale: 'vi' | 'en') {
    request.cookies.set('sgn-locale', locale);
    pending.set('sgn-locale', {
      name: 'sgn-locale',
      value: locale,
      options: {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: environment.appUrl.startsWith('https://'),
        maxAge: 31536000,
      },
    });
  }
  // Remembered-session control (ticket #52): unchecked sign-in keeps Supabase
  // auth cookies for this browser session only. The presentation-only locale
  // cookie is not affected, and the default (checked) behavior is unchanged.
  function setSessionPersistence(persist: boolean) {
    if (persist) return;
    for (const [name, cookie] of pending) {
      if (!name.startsWith('sb-')) continue;
      const options: CookieOptions = { ...cookie.options };
      delete options.maxAge;
      delete options.expires;
      pending.set(name, { ...cookie, options });
    }
  }
  return { client, environment, finish, setLocale, setSessionPersistence };
}
export async function runRoute(
  request: NextRequest,
  handler: (context: RouteContext) => Promise<NextResponse>,
) {
  let context: RouteContext | undefined;
  try {
    context = createRouteContext(request);
    return context.finish(await handler(context));
  } catch (error) {
    const response = NextResponse.json(
      { error: error instanceof ApiError ? error.code : 'unavailable' },
      {
        status: error instanceof ApiError ? error.status : 503,
        headers: privateHeaders,
      },
    );
    return context ? context.finish(response) : response;
  }
}
export async function objectBody(
  request: NextRequest,
  context: RouteContext,
  maxBytes = 8192,
): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  const requestOrigin = request.nextUrl.origin;
  const referer = request.headers.get('referer');
  let refererOrigin = '';
  try {
    refererOrigin = referer ? new URL(referer).origin : '';
  } catch {
    refererOrigin = '';
  }
  const sameOriginRequest =
    origin === context.environment.appUrl ||
    origin === requestOrigin ||
    (!origin &&
      (refererOrigin === context.environment.appUrl ||
        refererOrigin === requestOrigin ||
        request.headers.get('sec-fetch-site') === 'same-origin'));
  if (context.environment.stage === 'prod' && !sameOriginRequest)
    throw new ApiError(403, 'invalid-origin');
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(400, 'invalid-input');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid-input');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(400, 'invalid-input');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid-input');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'invalid-input');
  return body as Record<string, unknown>;
}
export function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function credentials(body: Record<string, unknown>): {
  email: string;
  password: string;
  locale: 'vi' | 'en';
  remember: boolean;
} {
  if (
    typeof body.email !== 'string' ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    typeof body.password !== 'string' ||
    body.password.length < 1 ||
    body.password.length > 1024 ||
    (body.locale !== 'vi' && body.locale !== 'en') ||
    (body.remember !== undefined && typeof body.remember !== 'boolean') ||
    Object.keys(body).some(
      (key) => !['email', 'password', 'locale', 'remember'].includes(key),
    )
  )
    throw new ApiError(400, 'invalid-input');
  return {
    email: body.email.trim(),
    password: body.password,
    locale: body.locale,
    remember: body.remember !== false,
  };
}
