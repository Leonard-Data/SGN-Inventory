import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthError } from '@supabase/supabase-js';
import { runRoute } from '@/lib/supabase/route';
import { messages } from '@/i18n/messages';
export async function recoveryCallback(
  request: NextRequest,
  mode: 'code' | 'token',
) {
  return runRoute(request, async (context) => {
    const invalid = () =>
      NextResponse.redirect(
        new URL('/recover?error=invalid', context.environment.appUrl),
        303,
      );
    const failure = (error: AuthError) =>
      error.name === 'AuthRetryableFetchError' ||
      (error.status ?? 0) >= 500 ||
      error.status === 429
        ? new NextResponse(
            messages[
              request.cookies.get('sgn-locale')?.value === 'en' ? 'en' : 'vi'
            ].unavailable,
            { status: 503 },
          )
        : invalid();
    const params = request.nextUrl.searchParams;
    if (mode === 'code') {
      const code = params.get('code');
      const flowId = params.get('sb_flow_id');
      if (
        !code ||
        code.length > 2048 ||
        (flowId !== null && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId)) ||
        [...params.keys()].some(
          (key) => !['code', 'sb_flow_id'].includes(key),
        ) ||
        params.getAll('code').length !== 1 ||
        params.getAll('sb_flow_id').length > 1
      )
        return invalid();
      // SDK 2.117 uses sb_flow_id to select the matching PKCE verifier slot.
      const { data, error } = await context.client.auth.exchangeCodeForSession(
        code,
        flowId === null ? undefined : { flowId },
      );
      if (error) return failure(error);
      if (
        !('redirectType' in data) ||
        data.redirectType !== 'recovery' ||
        !data.user
      )
        return invalid();
    } else {
      const hash = params.get('token_hash');
      if (
        !hash ||
        !/^[a-f0-9]{40,64}$/i.test(hash) ||
        params.get('type') !== 'recovery' ||
        [...params.keys()].some((key) => !['token_hash', 'type'].includes(key))
      )
        return invalid();
      const { error } = await context.client.auth.verifyOtp({
        type: 'recovery',
        token_hash: hash,
      });
      if (error) return failure(error);
    }
    const {
      data: { user },
      error,
    } = await context.client.auth.getUser();
    if (error) return failure(error);
    if (!user) return invalid();
    const response = NextResponse.redirect(
      new URL('/reset-password', context.environment.appUrl),
      303,
    );
    // Flow marker only; password authorization still comes from the verified Auth user.
    response.cookies.set('sgn-recovery', user.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: context.environment.appUrl.startsWith('https://'),
      path: '/',
      maxAge: 3600,
    });
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  });
}
