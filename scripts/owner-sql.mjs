import { spawnSync } from 'node:child_process';

// Fixture statements that the employee lifecycle guard reserves for the owner role run
// through the pinned Supabase CLI. The connection URL is passed without its password and the
// password reaches the child through PGPASSWORD, so no credential appears in the process
// argv. The CLI emits a bare rows array to an ordinary operator shell and a
// `{boundary,rows,warning}` envelope in agent mode; both shapes are accepted.
export function createOwnerSql(dbUrl) {
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error(
      'The owner SQL connection must be a valid Postgres connection URL',
    );
  }
  let password = '';
  if (parsed.password) {
    try {
      password = decodeURIComponent(parsed.password);
    } catch {
      throw new Error(
        'The owner SQL connection password must be percent-encoded',
      );
    }
  }
  parsed.password = '';
  const target = parsed.toString();
  const redact = (text) => {
    let clean = text.split(dbUrl).join('[redacted connection string]');
    if (target !== dbUrl)
      clean = clean.split(target).join('[redacted connection string]');
    if (password) clean = clean.split(password).join('[redacted password]');
    return clean;
  };
  return function ownerSql(statement) {
    const result = spawnSync(
      'npx',
      [
        'supabase',
        'db',
        'query',
        '--db-url',
        target,
        '--output-format',
        'json',
        statement,
      ],
      {
        encoding: 'utf8',
        timeout: 180000,
        env: password ? { ...process.env, PGPASSWORD: password } : process.env,
      },
    );
    if (result.status !== 0)
      throw new Error(
        'Owner SQL failed: ' +
          redact(result.stdout || result.stderr).slice(-800),
      );
    try {
      const parsed = JSON.parse(result.stdout);
      return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
    } catch {
      return [];
    }
  };
}
