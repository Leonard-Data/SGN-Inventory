# Local setup and isolated dev/prod delivery

This repository contains a runnable bilingual Next.js readiness page, configuration health, development tooling and the existing database foundation. **It is not a working inventory application.** Sign-in, live membership guards, property workflows and real Supabase/browser acceptance remain unimplemented or unexecuted. This runbook configures delivery; it does not authorize resource provisioning, imports or deployments.

## 1. Prerequisites and installation

- Git with a shell available to Husky (Git for Windows includes it).
- Node `24.14.0`, npm `11.14.1`. `.nvmrc`, `.node-version`, `packageManager` and engine checks record the baseline. Use your version manager; `nvm use` works with compatible nvm installations. Vercel runtime is `24.x`, not a guaranteed exact patch.
- Python `3.11+` for preparation tests; Docker Desktop/Engine only for the optional real local Supabase stack.
- No cloud credentials are needed for formatting, lint, types, tests, build or the readiness page.

```bash
npm ci
npm run check
npm run build
npm run dev
```

Open `http://localhost:3000`; `/?lang=en` exercises English. This language choice is only the readiness page, not persisted employee preference. The first `npm ci` installs `.husky/pre-commit`. It formats staged files and runs lint/types/JavaScript and schema tests. Use `npm run format` before CI if formatting fails. See [development.md](development.md) for structure, pinned stack and conventions.

Python preparation, POSIX:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-import.txt
npm run test:import
```

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-import.txt
npm run test:import
```

If activation is unavailable, invoke `.venv`'s Python directly instead of weakening machine-wide execution policy. CI installs Python 3.11 and the same requirements.

### Agent command-line tools

Install the repository-required CLIs globally, not as application dependencies. These versions were exercised with Node `24.14.0` and npm `11.14.1`:

```bash
npm install --global gh-axi@0.1.36 chrome-devtools-axi@0.1.39 lavish-axi@0.1.85
gh-axi --version
chrome-devtools-axi --version
lavish-axi --version
```

`gh-axi` requires the official GitHub CLI (`gh`) installed and authenticated. `chrome-devtools-axi` requires Chrome and starts its browser bridge on demand; standalone mode obtains `chrome-devtools-mcp` through npm. `lavish-axi` requires Node 22+, satisfied by the project baseline. Ensure npm's global executable directory is on `PATH`; on Windows it is normally `%APPDATA%\npm`.

Use `gh-axi` for GitHub, `chrome-devtools-axi` for browser work, and `lavish-axi` for visual decisions/reports. Read each command's current `--help` before use. Optional agent hooks/plugins are not installed by these commands. CLI installation does not authorize GitHub writes, publication of visual artifacts, cloud provisioning or deployment.

## 2. Local environment

POSIX: `cp .env.example .env.local`. PowerShell: `Copy-Item .env.example .env.local`.

`.env.local` is ignored. Supply values from an authorized local Supabase instance or isolated dev project, never prod. The examples contain deliberately invalid placeholders, not credentials. Only `.env.example`, `.env.dev.example` and `.env.prod.example` may be committed.

| Variable                               | Meaning                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `SGN_ENV`                              | Exactly `dev` or `prod`; local is `dev`                                              |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase origin; HTTPS hosted, HTTP loopback permitted only in dev                   |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key; local legacy `anon` JWT also accepted, secret/service-role rejected |
| `NEXT_PUBLIC_APP_URL`                  | Canonical application origin, HTTPS hosted                                           |
| `EXPECTED_SUPABASE_PROJECT_REF`        | Optional local check, required in releases to match selected hosted ref              |

```bash
npm run check:env
npm run dev
```

`check:env` reads `.env.local` if present, validates configuration without contacting Supabase and never prints keys. `/api/health` returns `200` with `{"status":"ok","stage":"dev"}` for valid configuration, `503` with `{"status":"configuration-error"}` otherwise; responses are `no-store`. It does not verify network connectivity, key validity at Supabase or authorization. The home page runs without environment configuration; health intentionally does not.

Optional **local-only** Supabase, after Docker is installed and you have authorized local database initialization:

```bash
npx --no-install supabase start --help
npx --no-install supabase start
npx --no-install supabase status
npx --no-install supabase db reset --help
# Destructive to local development data only; never omit --local:
npx --no-install supabase db reset --local
npx --no-install supabase test db --help
npx --no-install supabase test db
```

Read current help before using commands. Do not run reset against a linked/cloud database. Use the returned local URL and publishable/anon key; never copy a service-role key into a public variable. Open signup stays disabled; expose only `public`, never `private`. Embedded `npm run test:schema` needs no Docker and does not replace this real stack.

## 3. Two stages, isolated resources

| Concern                               | `dev`                                     | `prod`                                          |
| ------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Trusted release branch                | `develop`                                 | `main`                                          |
| GitHub environment                    | `dev`                                     | `prod`                                          |
| Supabase                              | Dedicated dev project, sanitized fixtures | Dedicated prod project, authorized company data |
| Vercel                                | Dedicated dev project                     | Dedicated prod project                          |
| Vercel deployment target              | Its own **Production** environment        | Its own **Production** environment              |
| Canonical origin                      | Dev HTTPS domain                          | Production HTTPS domain                         |
| Local development / optional previews | Dev resources only                        | Never used locally or by previews               |

Two Vercel projects host the **same application**, not separate application architectures. There are exactly two business stages; local and optional preview deployments belong to dev. This requires no paid custom Vercel environment. Even a project's first Vercel deployment uses its own Production environment, so an isolated dev project cannot accidentally select prod credentials. Dev and prod project IDs and Supabase refs must differ; release guards enforce this.

### Authorized operator provisioning checklist

These dashboard actions remain external prerequisites, not actions performed by repository setup:

1. Create/identify two Supabase projects and two Vercel projects with appropriate regions and ownership. Set Vercel framework Next.js, repository root, Node `24.x`, `npm ci` and `npm run build`.
2. Disable Vercel automatic Git deployments; `vercel.json` also sets `git.deploymentEnabled: false`. Do not enable an alternate deployment path that bypasses GitHub reviews. Optional previews must stay on the dev project with dev configuration only.
3. Populate each Vercel project's **Production** variables from its corresponding `.env.dev.example` or `.env.prod.example`, with actual values and matching `SGN_ENV`. Set dev project's optional Preview/Development variables to dev only. Never copy prod variables to dev.
4. Configure each Supabase Auth site URL and exact invitation/recovery/callback allowlist for that stage when implementing auth; no broad prod wildcards. Disable public/anonymous signup, keep documents private, and expose only `public`. No ordinary app secret key is required.
5. Create GitHub environments `dev` and `prod`. Restrict dev to `develop`, prod to `main`. Require a prod reviewer, prevent self-review and disable protection bypass where the account plan permits. Verify required-reviewer support on the repository's visibility/plan **before enabling deployment credentials**. If unavailable, do not activate prod delivery until an equivalent enforceable external approval gate is established.
6. Protect `develop` and `main`: require pull requests, reviews and the CI `quality` status; block force pushes/deletion and restrict bypass. Run CI first to learn the exact status name GitHub presents. No deployment secrets on feature PRs or forks.
7. Create `develop` from the reviewed baseline. Nothing in repository setup creates or pushes this branch automatically.

### GitHub variables and secrets

Repository-level **variables** (nonsecret target allowlist, do not redefine them differently per environment):

- `DEV_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_PROJECT_REF`: actual 20-letter refs.
- `DEV_VERCEL_PROJECT_ID`, `PROD_VERCEL_PROJECT_ID`: distinct `prj_...` IDs.

For **each** GitHub environment:

| Kind                            | Name                                   | Value                                                       |
| ------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Variable                        | `SUPABASE_PROJECT_REF`                 | That stage's ref                                            |
| Variable                        | `VERCEL_ORG_ID`                        | Organization/team ID                                        |
| Variable                        | `VERCEL_PROJECT_ID`                    | That stage's hosting project ID                             |
| Variable                        | `NEXT_PUBLIC_SUPABASE_URL`             | That stage's Supabase HTTPS origin                          |
| Variable                        | `NEXT_PUBLIC_APP_URL`                  | That stage's canonical HTTPS origin                         |
| Secret                          | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Matching public key (not privileged despite secret storage) |
| Secret                          | `VERCEL_TOKEN`                         | Authorized delivery token, scoped as narrowly as available  |
| Secret, if deployment protected | `VERCEL_AUTOMATION_BYPASS_SECRET`      | That project's automation bypass secret for health smoke    |
| Secret, database workflow only  | `SUPABASE_ACCESS_TOKEN`                | Authorized CLI access token                                 |
| Secret, database workflow only  | `SUPABASE_DB_PASSWORD`                 | That stage's database password                              |

`SGN_ENV` and `EXPECTED_SUPABASE_PROJECT_REF` are selected by workflows. Match the GitHub public configuration and Vercel configuration exactly, including trailing-slash spelling. The release guard verifies the downloaded `.vercel/project.json` and `.vercel/.env.production.local` before build. Pulled configuration cannot silently override the selected stage. No tokens, database passwords or server secret keys belong in Vercel browser variables; database credentials are not supplied to the app deployment job.

## 4. CI and release procedure

### Continuous integration

`.github/workflows/ci.yml` runs on PRs and pushes to `main`/`develop`, and is reused by manual release workflows. Read-only checkout; pinned action revisions; locked npm install; Python preparation, formatting, lint, type checks, configuration/release regression tests, embedded schema tests and Next build. CI configuration uses an inert publishable-key fixture and never calls a cloud database. No credential-bearing artifacts are uploaded.

### Database review and promotion

The existing migrations target a fresh database; review any existing remote schema/history before linking. The migration workflow is **not** an import, reset, seed or destructive recovery tool.

1. Review the migration diff and backwards compatibility. Run CI and local/staging tests. Create new migrations, never rewrite deployed SQL. Confirm backup/recovery readiness before production schema changes.
2. In Actions, dispatch **Review database migrations** with the stage's branch selected and `apply=false` (default). Both stages require their configured environment gate. Wrong branch dispatches do not run a release job; the executable guard also rejects wrong branches/refs.
3. Inspect the pending list, target and compatibility. CLI `link` contacts the selected project; `db push --linked --dry-run --skip-vault` lists pending migrations without application or Vault updates. No seed/roles/reset flags are used.
4. Only after separate migration authorization, dispatch the reviewed commit with `apply=true`. The workflow repeats dry run then `db push --linked --skip-vault --yes`. Environment approval must cover that exact commit and operation. Do not approve pending unreviewed/destructive SQL merely because tests pass.
5. Execute real dev/staging acceptance in [testing.md](testing.md). Dry run and PGlite are not proof of real Auth/RLS/Storage or multi-session concurrency.

### Application deployment

1. Dispatch **Deploy application**, `stage=dev`, on `develop`. CI must pass before the environment job. Release guard checks branch and both resource allowlists before Vercel contact.
2. The workflow pulls the selected isolated project's Production configuration, verifies downloaded identities and variables, builds with pinned Vercel CLI and uploads that exact prebuilt output using explicit `--prod`. For dev this means the **dev project's** Production slot, never the prod project.
3. `/api/health` must report the selected stage. A protected deployment requires the bypass secret; missing protection access fails honestly instead of accepting a login page as health. Perform the actual browser/business acceptance separately and record the tested commit/results.
4. Review/merge the validated changes into `main`. Dispatch `stage=prod` on `main` only after production release authorization and staging acceptance. The prod reviewer must inspect the commit, dev evidence, migrations and configuration. The workflow checks structural health, not the inventory release criteria.
5. Production public variables are bundled during the new prod build. **Never promote a dev build into prod** or reuse cross-stage build artifacts. Keep database compatibility first, then app deployment, smoke/acceptance and monitoring.

Deployment smoke runs after deployment completes. A failed health check does not automatically roll back domains or database changes; the operator must use the recovery procedure. Releases are serialized per stage across both migration and app workflows; running jobs are not canceled midway.

## 5. Recovery and troubleshooting

- **App rollback:** restore a previously verified deployment from the **same Vercel project/stage**, after checking compatibility with current database schema and authorization behavior. Re-run stage health and actual affected browser workflows. Do not use a dev deployment as prod rollback.
- **Database recovery:** prefer reviewed forward fixes. Do not blindly reverse migrations or reset production. Restore from backup only under separate authorization with a plan for post-backup writes, identities, Storage and reconciliation; rehearse recovery before release.
- **`check:env` fails:** placeholders are intentionally rejected. Verify origin-only URLs, stage and publishable/anon key; inspect errors without printing secrets. A secret/service-role key is never an acceptable replacement.
- **Hooks missing:** rerun `npm run prepare`, check Git and Node on the hook shell PATH. `HUSKY=0` is for CI, not the normal local workflow. Windows hooks use Git's shell and LF line endings.
- **CI formatting:** run `npm run format`. Historical contract files and migrations are intentionally excluded rather than mass-restyled.
- **Release guard fails:** verify branch, distinct repository allowlists, stage environment variables and the Vercel pulled configuration. CLI reports only a safe summary because assertion payloads can contain keys. Do not bypass the guard.
- **Local real-stack checks unavailable:** install Docker and rerun local Supabase checks; do not report embedded tests as equivalent. No real cloud provisioning or deployment is required to run repository quality gates.

## Sources

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Vercel environments and first-deployment behavior](https://vercel.com/docs/deployments/environments)
- [Vercel CLI prebuilt deployment](https://vercel.com/docs/cli/deploying-from-cli)
- [GitHub deployment environments and protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
