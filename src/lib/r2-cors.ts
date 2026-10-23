// The bucket's CORS rule is part of the storage configuration, not an optional extra: the
// browser itself sends the signed upload PUT and follows the presigned download link, so a
// bucket with credentials but no usable rule fails every real upload with an opaque CORS
// error. This module is pure so the environment check and its tests share one decision.

export type CorsRule = {
  AllowedOrigins?: string[];
  AllowedMethods?: string[];
  AllowedHeaders?: string[];
};

export type CorsVerdict = { ok: true } | { ok: false; detail: string };

// R2 answers NoSuchCORSConfiguration when the bucket has no CORS policy at all: a definite
// answer, and a failure, rather than a configuration that could not be read.
export function noCorsConfiguration(error: unknown): boolean {
  const { name, Code, $metadata } = (error ?? {}) as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = `${name ?? ''} ${Code ?? ''}`;
  return (
    code.includes('NoSuchCORSConfiguration') ||
    ($metadata?.httpStatusCode === 404 && !code.includes('NoSuchBucket'))
  );
}

// The signed PUT carries exactly these request headers: the declared content type and the
// conditional create. A presigned download sends none of its own.
const uploadHeaders = ['content-type', 'if-none-match'];

function escape(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A rule's origin entry is either an exact origin or one `*` wildcard, matching the S3 shape
// R2 accepts. Comparison ignores case, as an origin does.
function originAllows(pattern: string, origin: string): boolean {
  const rule = pattern.trim().toLowerCase();
  const wanted = origin.trim().toLowerCase();
  if (rule === '*') return true;
  if (!rule.includes('*')) return rule === wanted;
  return new RegExp(`^${rule.split('*').map(escape).join('.*')}$`).test(wanted);
}

// One request is admitted only by one single rule that matches its origin, its method and
// every header it sends, so each of those is judged against the same rule.
function allows(
  rule: CorsRule,
  origin: string,
  method: string,
  headers: string[],
): boolean {
  const methods = (rule.AllowedMethods ?? []).map((value) =>
    value.toUpperCase(),
  );
  const allowedHeaders = (rule.AllowedHeaders ?? []).map((value) =>
    value.toLowerCase(),
  );
  return (
    (rule.AllowedOrigins ?? []).some((pattern) =>
      originAllows(pattern, origin),
    ) &&
    (methods.includes('*') || methods.includes(method)) &&
    headers.every(
      (header) =>
        allowedHeaders.includes('*') || allowedHeaders.includes(header),
    )
  );
}

function anyRule(
  rules: CorsRule[],
  origin: string,
  method: string,
  headers: string[],
): boolean {
  return rules.some((rule) => allows(rule, origin, method, headers));
}

// `undefined` means R2 answered that the bucket has no CORS policy at all. Each message names
// the part of the rule that is missing, so the operator knows what to install rather than
// only that something failed.
export function corsVerdict(
  rules: CorsRule[] | undefined,
  appUrl: string,
): CorsVerdict {
  const configured = rules ?? [];
  if (!configured.length)
    return {
      ok: false,
      detail:
        'has no CORS rule, so the browser refuses every upload and every presigned open',
    };
  if (!anyRule(configured, appUrl, 'PUT', uploadHeaders))
    return {
      ok: false,
      detail: `has no CORS rule allowing a PUT from ${appUrl} with the content-type and if-none-match request headers, so a browser upload is refused`,
    };
  if (!anyRule(configured, appUrl, 'GET', []))
    return {
      ok: false,
      detail: `has no CORS rule allowing a GET from ${appUrl}, so a browser open of a presigned file link is refused`,
    };
  return { ok: true };
}
