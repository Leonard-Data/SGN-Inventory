export type Stage = 'dev' | 'prod';

export type Environment = Readonly<{
  stage: Stage;
  supabaseUrl: string;
  publishableKey: string;
  appUrl: string;
}>;

// Pure interface shared by runtime and release checks. Never returns secret keys.
export function readEnvironment(
  values: Readonly<Record<string, string | undefined>>,
  expectedProjectRef?: string,
): Environment {
  const stage = values.SGN_ENV;
  if (stage !== 'dev' && stage !== 'prod') {
    throw new Error('SGN_ENV must be dev or prod');
  }

  function required(name: string): string {
    const value = values[name]?.trim();
    if (!value || /YOUR_|REPLACE_|CHANGE_ME/.test(value)) {
      throw new Error(`${name} must be configured`);
    }
    return value;
  }

  function origin(name: string): URL {
    const url = new URL(required(name));
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(stage === 'dev' && local && url.protocol === 'http:'))
    ) {
      throw new Error(
        `${name} must be an HTTPS origin (HTTP loopback allowed in dev)`,
      );
    }
    return url;
  }

  const supabaseUrl = origin('NEXT_PUBLIC_SUPABASE_URL');
  const appUrl = origin('NEXT_PUBLIC_APP_URL');
  if (
    expectedProjectRef &&
    (!/^[a-z]{20}$/.test(expectedProjectRef) ||
      supabaseUrl.origin !== `https://${expectedProjectRef}.supabase.co`)
  ) {
    throw new Error('Supabase URL does not match the expected project');
  }

  for (const [name, value] of Object.entries(values)) {
    if (
      name.startsWith('NEXT_PUBLIC_') &&
      value &&
      /SECRET|SERVICE_ROLE|PASSWORD|TOKEN/.test(name)
    ) {
      throw new Error('Privileged configuration must not be public');
    }
  }

  const publishableKey = required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    // Supabase local development still returns a legacy anon JWT.
    let role: unknown;
    try {
      const payload = publishableKey.split('.')[1];
      if (payload)
        role = JSON.parse(Buffer.from(payload, 'base64url').toString()).role;
    } catch {
      // All invalid key forms share the same safe configuration error.
    }
    if (role !== 'anon' || publishableKey.split('.').length !== 3) {
      throw new Error(
        'Use a Supabase publishable key or legacy anon key, never a secret key',
      );
    }
  }

  return {
    stage,
    supabaseUrl: supabaseUrl.origin,
    publishableKey,
    appUrl: appUrl.origin,
  };
}
