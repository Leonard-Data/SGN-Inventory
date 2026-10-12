# Local setup and isolated dev/prod delivery

This repository contains a runnable bilingual Next.js readiness page, configuration health, development tooling and the existing database foundation. **It is not a working inventory application.** Sign-in, live membership guards, property workflows and real Supabase/browser acceptance remain unimplemented or unexecuted. This runbook configures delivery; it does not authorize resource provisioning, imports or deployments.

## 1. Prerequisites and installation

- Git with a shell available to Husky (Git for Windows includes it).
- Node `24.14.0`, npm `11.14.1`. `.nvmrc`, `.node-version`, `packageManager` and engine checks record the baseline. Use your version manager; `nvm use` works with compatible nvm installations. Vercel runtime is `24.x`, not a guaranteed exact patch.
- Python `3.11+` for preparation tests; Docker Desktop/Engine only for the optional real local Supabase stack.
- Required agent tooling: official GitHub CLI (`gh`), Chrome, and the globally installed `gh-axi`, `chrome-devtools-axi` and compatible `lavish-axi` versions below. Complete this step before agent-assisted project work; optional hooks/plugins are not required.
- No cloud credentials are needed for formatting, lint, types, tests, build or the readiness page.

### Required initial setup: agent command-line tools

Install any missing repository-required CLIs globally, not as application dependencies. Initial agent-assisted setup is incomplete until all three commands are available on `PATH` and their version checks pass. These compatible versions were exercised with Node `24.14.0` and npm `11.14.1`:

```bash
npm install --global gh-axi@0.1.36 chrome-devtools-axi@0.1.39 lavish-axi@0.1.85
gh-axi --version
chrome-devtools-axi --version
lavish-axi --version
```

`gh-axi` requires the official GitHub CLI (`gh`) installed and authenticated. `chrome-devtools-axi` requires Chrome and starts its browser bridge on demand; standalone mode obtains `chrome-devtools-mcp` through npm. `lavish-axi` requires Node 22+, satisfied by the project baseline. Ensure npm's global executable directory is on `PATH`; on Windows it is normally `%APPDATA%\npm`.

Use `gh-axi` for GitHub, `chrome-devtools-axi` for browser work, and `lavish-axi` for visual decisions/reports. Read each command's current `--help` before use. Optional agent hooks/plugins are not installed by these commands. CLI installation does not authorize GitHub writes, publication of visual artifacts, cloud provisioning or deployment.

### Application dependencies and verification

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

## 2. Local environment

POSIX: `cp .env.example .env.local`. PowerShell: `Copy-Item .env.example .env.local`.

`.env.local` is ignored. Supply values from an authorized local Supabase instance or isolated dev project, never prod. The examples contain deliberately invalid placeholders, not credentials. Only `.env.example`, `.env.dev.example` and `.env.prod.example` may be committed.

| Variable                               | Meaning                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SGN_ENV`                              | Exactly `dev` or `prod`; local is `dev`                                                                                                           |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase origin; HTTPS hosted, HTTP loopback permitted only in dev                                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key; local legacy `anon` JWT also accepted, secret/service-role rejected                                                              |
| `NEXT_PUBLIC_APP_URL`                  | Canonical application origin, HTTPS hosted                                                                                                        |
| `EXPECTED_SUPABASE_PROJECT_REF`        | Optional local check, required in releases to match selected hosted ref                                                                           |
| `SGN_FILE_VALIDATION_KEY`              | Server-only file-completion HMAC key: exactly 64 lowercase hex characters, matching that stage's private database singleton; never `NEXT_PUBLIC_` |

```bash
npm run check:env
npm run dev
```

`check:env` reads `.env.local` if present, validates configuration without contacting Supabase and never prints keys. `/api/health` returns `200` with `{"status":"ok","stage":"dev"}` for valid configuration, `503` with `{"status":"configuration-error"}` otherwise; responses are `no-store`. It does not verify network connectivity, key validity at Supabase or authorization. The home page runs without environment configuration; health intentionally does not.

File completion also requires a separately authorized operator to generate a random 32-byte secret in private tooling, configure its lowercase hex value as `SGN_FILE_VALIDATION_KEY` in that stage's server environment, and install the same value in `private.file_validation_keys` (`id=1`, `key_hex`) through an owner-authorized database connection. Keep the key out of source, logs, browser variables, ordinary clients and service-role requests; the table revokes their access. Development and production use different keys. The migration intentionally does not seed a key. Missing/malformed server configuration fails file completion closed with `503`; the configuration-only health check is not a file-completion or database-key smoke. Provisioning production or rotating an existing key requires separate concrete authorization.

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

| Concern                               | `dev`                                             | `prod`                                                 |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Trusted release branch                | `develop`                                         | `main`                                                 |
| GitHub environment                    | `dev`                                             | `prod`                                                 |
| Supabase                              | Dedicated dev project, sanitized fixtures         | Dedicated prod project, authorized company data        |
| Vercel                                | Dedicated dev project                             | Dedicated prod project                                 |
| Vercel deployment target              | Its own **Production** environment                | Its own **Production** environment                     |
| Canonical origin                      | Dev HTTPS review URL                              | Prod HTTPS production URL                              |
| Vercel Web Analytics                  | Toggle on the dev project; reports the review URL | Toggle on the prod project; reports the production URL |
| Local development / optional previews | Dev resources only                                | Never used locally or by previews                      |

Each stage's canonical origin is that project's stable `vercel.app` production domain and is the `NEXT_PUBLIC_APP_URL` value for the stage. Below, the **review URL** is the dev project's Production domain and the **production URL** is the prod project's Production domain. Neither is created or changed by this repository.

Two Vercel projects host the **same application**, not separate application architectures. There are exactly two business stages; local and optional preview deployments belong to dev. This requires no paid custom Vercel environment. Even a project's first Vercel deployment uses its own Production environment, so an isolated dev project cannot accidentally select prod credentials. Dev and prod project IDs and Supabase refs must differ; release guards enforce this.

### Authorized operator provisioning checklist

These dashboard actions remain external prerequisites, not actions performed by repository setup:

1. Create/identify two Supabase projects and two Vercel projects with appropriate regions and ownership. Set Vercel framework Next.js, repository root, Node `24.x`, `npm ci` and `npm run build`.
2. Enable **Web Analytics** on **each** Vercel project (project → **Analytics** → Web Analytics). The application integration is already committed; the toggle is what starts collection, and it reports to whichever project served the request. See [Vercel Analytics for the review and production URLs](#vercel-analytics-for-the-review-and-production-urls) for the exact scope of each toggle and what remains unverified.
3. Disable Vercel automatic Git deployments; `vercel.json` also sets `git.deploymentEnabled: false`. Do not enable an alternate deployment path that bypasses GitHub reviews. Optional previews must stay on the dev project with dev configuration only.
4. Populate each Vercel project's **Production** variables from its corresponding `.env.dev.example` or `.env.prod.example`, with actual values and matching `SGN_ENV`. Set dev project's optional Preview/Development variables to dev only. Never copy prod variables to dev.
5. Configure each Supabase Auth site URL and exact invitation/recovery/callback allowlist for that stage when implementing auth; no broad prod wildcards. Disable public/anonymous signup, keep documents private and expose only `public`. Ordinary requests never need a Supabase secret/service-role key; file completion requires the separate server-only attestation configuration above.
6. Create GitHub environments `dev` and `prod`. Restrict dev to `develop`, prod to `main`. Require a prod reviewer, prevent self-review and disable protection bypass where the account plan permits. Verify required-reviewer support on the repository's visibility/plan **before enabling deployment credentials**. If unavailable, do not activate prod delivery until an equivalent enforceable external approval gate is established. A workflow that names a nonexistent environment creates an unprotected one, so an unconfigured environment is not a gate.
7. Protect `develop` and `main`: require pull requests, reviews and the CI `quality` status; block force pushes/deletion and restrict bypass. Run CI first to learn the exact status name GitHub presents. No deployment secrets on feature PRs or forks.
8. Create `develop` from the reviewed baseline. Nothing in repository setup creates or pushes this branch automatically.

**External state observed on 12 October 2026, not a repository guarantee:** the repository had no GitHub environments and neither `main` nor `develop` was protected. Until items 6 and 7 exist, the `dev`/`prod` jobs run without an approval gate, so production delivery must stay blocked. Re-check both in repository settings before enabling deployment credentials; the repository cannot verify them.

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

Where each value comes from — dashboard labels move, so confirm the value is the one your own project shows for that stage:

| Name                                   | Source                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DEV_/PROD_VERCEL_PROJECT_ID`          | Vercel project → **Settings → General → Project ID**; the same value appears as `projectId` in `.vercel/project.json` |
| `VERCEL_ORG_ID`                        | Vercel team or account identifier; the same value appears as `orgId` in `.vercel/project.json`                        |
| `VERCEL_TOKEN`                         | Vercel → account **Settings → Tokens**; create one scoped to the team that owns both projects                         |
| `VERCEL_AUTOMATION_BYPASS_SECRET`      | Vercel project → **Settings → Deployment Protection → Protection Bypass for Automation**                              |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project → **Project Settings → API**: the project URL                                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project → **Project Settings → API**: the publishable key, not the secret or service-role key                |
| `DEV_/PROD_SUPABASE_PROJECT_REF`       | The 20-character reference in that project's Supabase URL or project settings                                         |
| `SUPABASE_ACCESS_TOKEN`                | Supabase account → **Access Tokens**                                                                                  |
| `SUPABASE_DB_PASSWORD`                 | The database password set when that Supabase project was created, or reset under **Project Settings → Database**      |
| `NEXT_PUBLIC_APP_URL`                  | Vercel project → **Domains**: that project's stable `vercel.app` production domain                                    |

## 4. CI and release procedure

### Continuous integration

`.github/workflows/ci.yml` runs on PRs and pushes to `main`/`develop`, and is reused by manual release workflows. Read-only checkout; pinned action revisions; locked npm install; Python preparation, formatting, lint, type checks, configuration/release regression tests, embedded schema tests and Next build. CI configuration uses an inert publishable-key fixture and never calls a cloud database. No credential-bearing artifacts are uploaded.

### Release pipeline: database, then application

`.github/workflows/deploy.yml` (**Release application and database**) is the single gated pipeline that applies reviewed migrations and publishes the application for one stage. It is the only path that both changes a hosted database and publishes an application. It runs on explicit dispatch only — there is no deploy trigger on a push, pull request, tag or merge, so production is never released implicitly — and it serializes per stage through one `release-<stage>` concurrency group shared with the database workflow, with `cancel-in-progress: false`.

| Job       | Purpose                                                                                                                                                                                                                            | Timeout |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `quality` | Reuses `.github/workflows/ci.yml` unchanged: formatting, lint, types, environment/release regressions, schema tests and Next build                                                                                                 | 15 min  |
| `migrate` | Verifies the stage database target, links it, lists pending migrations, and applies them only when asked                                                                                                                           | 15 min  |
| `deploy`  | Verifies the isolated release configuration, pulls the stage project's Production environment, verifies the pulled project and variables, builds, uploads that exact prebuilt output with `--prod`, and smoke-checks `/api/health` | 20 min  |

`deploy` needs `migrate`, so **a failed migration ends the run before anything is published**. Both release jobs carry the same branch guard — `dev` only on `develop`, `prod` only on `main` — and the executable guards repeat the check before any cloud contact.

Dispatch inputs: `stage` (`dev` or `prod`) and `migration` (`verify` lists pending migrations only, the default; `apply` applies the reviewed pending set before the release).

**Order of operations.** Run each step on the stage's own branch, after the [provisioning checklist](#authorized-operator-provisioning-checklist).

1. **Release the dev stage.** Actions → **Release application and database** → _Run workflow_ → branch `develop`, `stage=dev`, `migration=verify`. Expected: `quality` passes; `migrate` prints `Release target check passed` and the pending list from `db push --linked --dry-run --skip-vault`, changing nothing; `deploy` prints `Release configuration check passed` and `Release pulled check passed`, then a `https://…vercel.app` URL from the deploy step and `Release smoke check passed` from `/api/health`. The dev project's Production slot — the **review URL** — now serves that commit.
2. **Read the pending list.** Empty means the database is already current. Non-empty means those migrations were **not** applied and the application was released anyway; review the migration diff, confirm backup/recovery readiness, then repeat step 1 with `migration=apply` on the same commit. Re-running is safe: applied versions are recorded in `supabase_migrations.schema_migrations` and are skipped, and `--skip-vault` leaves Vault secrets untouched.
3. **Fix forward on failure.** A non-zero `migrate` step stops the run and skips `deploy`; nothing is published. Create a new migration — never rewrite deployed SQL — and re-dispatch. The database stays on its last applied version.
4. **Release the prod stage.** After the dev release and the [staging acceptance](testing.md) are recorded, merge to `main` and repeat steps 1–2 with `stage=prod` on `main`. The `prod` environment approval pauses the run **before any cloud contact**; the reviewer must inspect the commit, the dev evidence and the pending list. `prod` deploys only to the prod project's Production slot — the **production URL**.
5. **Keep the order.** Database compatibility first, then the application release, then smoke and business acceptance. Public variables are bundled at build time, so **never promote a dev build into prod** or reuse cross-stage artifacts; each stage builds its own.

Smoke runs after the upload. A failed smoke or health check does not roll back the domain or the database automatically; use [Recovery and troubleshooting](#5-recovery-and-troubleshooting). Neither workflow seeds, imports, resets, restores a backup, changes Vercel projects, domains, deployment protection or Auth settings, or rolls the application back.

**What a failed run looks like:** a wrong branch for the selected stage skips both release jobs; shared, swapped or missing project IDs and a mismatched pulled configuration print only `Release check failed: verify branch, stage, project IDs, configuration and deployment health.` and upload nothing; a missing variable or secret fails at the release guard, `link` or `pull`; a protection login page, wrong stage, non-`200` response or timeout fails the smoke instead of being accepted as health.

**Unverified external prerequisites:** the environment gate and its reviewer, both projects and their Production variables, the Analytics toggle, and the reachability of a real deployment or migration are all outside this repository. Until they exist, this pipeline has never been dispatched here, and a workflow is never dispatched merely to demonstrate that it exists.

### Database review without releasing the application

**Review database migrations** (`.github/workflows/migrate.yml`) remains the database-only path for reviewing or applying migrations without publishing the application. It shares the stage concurrency group and the same target guard.

1. Review the migration diff and backwards compatibility. Run CI and local/staging tests. The existing migrations target a fresh database; review any existing remote schema/history before linking. This workflow is **not** an import, reset, seed or destructive recovery tool.
2. Dispatch it with the stage's branch selected and `apply=false` (default). Both stages require their configured environment gate, and wrong-branch dispatches do not run a release job.
3. Inspect the pending list, target and compatibility. CLI `link` contacts the selected project; `db push --linked --dry-run --skip-vault` lists pending migrations without application or Vault updates. No seed/roles/reset flags are used.
4. Only after separate migration authorization, dispatch the reviewed commit with `apply=true`. The workflow repeats the dry run, then `db push --linked --skip-vault --yes`. Environment approval must cover that exact commit and operation; do not approve pending unreviewed or destructive SQL merely because tests pass.
5. Execute real dev/staging acceptance in [testing.md](testing.md). Dry run and PGlite are not proof of real Auth/RLS/Storage or multi-session concurrency.

### Vercel Analytics for the review and production URLs

The application mounts `@vercel/analytics` (`2.0.1`, pinned) in the root layout (`src/app/layout.tsx`), so every page reports to whichever Vercel project served it. That is all the repository can do: **collection starts only when the dashboard toggle is on**, and the Analytics view stays empty until then.

| URL            | Vercel project                                            | Environment scope of the toggle       | What it reports                                                                            |
| -------------- | --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Review URL     | The project whose ID is `DEV_VERCEL_PROJECT_ID` (`dev`)   | Web Analytics enabled on that project | Its Production deployment, which is the dev review URL, and any of its Preview deployments |
| Production URL | The project whose ID is `PROD_VERCEL_PROJECT_ID` (`prod`) | Web Analytics enabled on that project | Its Production deployment, which is the production URL                                     |

To enable, in the Vercel dashboard: select the project → **Analytics** → **Web Analytics** → **Enable**. Then release each stage through the pipeline above and open **Analytics → Web Analytics** on that project to read page views, visitors, top pages and referrers. Nothing is collected from local `next dev`, which never reaches Vercel.

**Unverified external prerequisites:** neither toggle, project, plan quota nor region has been set or observed from this repository, and no deployed request has been measured. Confirm the toggle, the quota your plan includes, and — after the first release — that the Analytics view shows traffic before relying on it. Because `git.deploymentEnabled` is `false` and releases are explicit, there is no traffic to measure before the first successful release.

## 5. Recovery and troubleshooting

- **App rollback:** restore a previously verified deployment from the **same Vercel project/stage**, after checking compatibility with current database schema and authorization behavior. Re-run stage health and actual affected browser workflows. Do not use a dev deployment as prod rollback.
- **Database recovery:** prefer reviewed forward fixes. Do not blindly reverse migrations or reset production. Restore from backup only under separate authorization with a plan for post-backup writes, identities, Storage and reconciliation; rehearse recovery before release.
- **`check:env` fails:** placeholders are intentionally rejected. Verify origin-only URLs, stage and publishable/anon key; inspect errors without printing secrets. A secret/service-role key is never an acceptable replacement.
- **Hooks missing:** rerun `npm run prepare`, check Git and Node on the hook shell PATH. `HUSKY=0` is for CI, not the normal local workflow. Windows hooks use Git's shell and LF line endings.
- **CI formatting:** run `npm run format`. Historical contract files and migrations are intentionally excluded rather than mass-restyled.
- **Release guard fails:** verify branch, distinct repository allowlists, stage environment variables and the Vercel pulled configuration. CLI reports only a safe summary because assertion payloads can contain keys. Do not bypass the guard.
- **The Analytics view is empty:** confirm **Web Analytics** is enabled on the project that served the request, and that the visit came from a deployed URL rather than `next dev`. The repository-side component is inert until that toggle is on, and nothing here configures it.
- **Local real-stack checks unavailable:** install Docker and rerun local Supabase checks; do not report embedded tests as equivalent. No real cloud provisioning or deployment is required to run repository quality gates.

## Sources

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Vercel environments and first-deployment behavior](https://vercel.com/docs/deployments/environments)
- [Vercel CLI prebuilt deployment](https://vercel.com/docs/cli/deploying-from-cli)
- [Vercel Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart)
- [GitHub deployment environments and protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
