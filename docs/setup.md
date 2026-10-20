# Local setup and continuous delivery

This repository contains the Next.js/Supabase foundation and implemented slices, **not a completed inventory application or production acceptance**. This runbook prepares delivery; it does not authorize provisioning, imports, database changes or a production release by itself. Feature acceptance remains in [testing.md](testing.md).

## 1. Tooling first

- Node `24.14.0`, npm `11.13.0`, as recorded in `.nvmrc`, `.node-version` and `package.json`. Vercel uses Node `24.x`, not an exact patch. npm is the only JavaScript package manager.
- Git and a shell for Husky (Git for Windows includes one).
- Python `3.11+` for workbook preparation tests. Docker is needed only for separately authorized real local Supabase checks.
- Agent work requires authenticated official GitHub CLI (`gh`), Chrome, and `gh-axi`, `chrome-devtools-axi`, and compatible `lavish-axi`. The previously exercised versions are `0.1.36`, `0.1.39`, and `0.1.85` respectively. Install missing agent tools globally, not into the application, and consult current help before use. Installation grants no cloud or GitHub write authority.

```bash
npm install --global gh-axi@0.1.36 chrome-devtools-axi@0.1.39 lavish-axi@0.1.85
gh-axi --version
chrome-devtools-axi --version
lavish-axi --version

# After selecting Node 24.14.0:
npm install --global npm@11.13.0
npm ci
npm run check
npm run build
```

`npm ci` installs the pre-commit hook; it formats staged files and runs lint, types and tests. CI sets `HUSKY=0`. Every workflow bootstraps the same npm pin before the locked install. Use `npm run format` for formatting; see [development.md](development.md) for conventions. Vercel CLI `63.1.2` is already pinned in the lockfile: use `npx --no-install vercel`, not an unpinned download.

Python, POSIX:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-import.txt
npm run test:import
```

Windows PowerShell: `py -3.11 -m venv .venv`, then `.\.venv\Scripts\Activate.ps1` and the same pip/npm commands. If activation is unavailable, invoke the virtual environment's Python directly rather than weakening execution policy.

## 2. Local and application environment

Copy `.env.example` to ignored `.env.local` (`cp` on POSIX, `Copy-Item` in PowerShell). Supply local or isolated dev values, never production values. Examples are placeholders, not credentials. No live credentials are required for CI, tests or compilation.

| Variable                               | Required value                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SGN_ENV`                              | `dev` for local/previews/dev, `prod` for production                                                                                                                                        |
| `NEXT_PUBLIC_SUPABASE_URL`             | Selected Supabase HTTPS origin; HTTP loopback is allowed only locally in dev                                                                                                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Matching publishable key (local legacy `anon` JWT accepted); never secret/service-role                                                                                                     |
| `NEXT_PUBLIC_APP_URL`                  | Canonical HTTPS origin of that stage; local example is `http://localhost:3000`                                                                                                             |
| `EXPECTED_SUPABASE_PROJECT_REF`        | Selected 20-letter hosted ref; optional locally, required for release checks                                                                                                               |
| `SGN_FILE_VALIDATION_KEY`              | Server-only 64 lowercase hex characters matching the private DB singleton; the same key is in use for both stages today, and independent per-stage keys are the intended end state         |
| `R2_ACCOUNT_ID`                        | Server-only Cloudflare R2 account id; the S3 endpoint is `https://<id>.r2.cloudflarestorage.com`                                                                                           |
| `R2_BUCKET`                            | Server-only private R2 bucket for property file bytes; presigned URLs are the only access path                                                                                             |
| `R2_ACCESS_KEY_ID`                     | Server-only R2 API token access key id with read/write on that one bucket                                                                                                                  |
| `R2_SECRET_ACCESS_KEY`                 | Server-only R2 API token secret; never `NEXT_PUBLIC_`, never printed or committed                                                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server-only trusted-server capability used only for the employee administration provider steps and the released-upload cleanup pass; never `NEXT_PUBLIC_`, never read by ordinary requests |

```bash
npm run check:env
npm run dev
```

`check:env` validates configuration without printing keys, and contacts Supabase not at all; the only remote read it makes is the R2 bucket's own CORS rule. `/api/health` is private/no-store configuration readiness only: `200` with `{"status":"ok","stage":"dev"}` (or `prod`), otherwise `503`. It proves neither database connectivity, file-key agreement nor user authorization.

Property file bytes live in a private Cloudflare R2 bucket, in both stages, configured only through the four server-only `R2_*` variables above. Uploads and downloads are short-lived presigned URLs minted only after the RLS-checked `property_files` read, so the application server never streams bytes and no bucket is public. An upload is a 60-second presigned `PUT` whose signature covers the object key and the registered byte count and requires a conditional create, so R2 itself refuses any body whose length differs from the registered size (never more than the class cap) and never replaces an existing object. These are ordinary runtime variables, not build-time ones: a missing value fails the file operation closed with an opaque `503`/`unavailable` response rather than falling back to Supabase Storage, the server log names the missing variables for the operator, and `check:env` reports `R2 storage: not configured` (or fails when only part of the set is present). With all four present it also reads the bucket's CORS rule and fails when the rule is absent or does not admit the application origin with the `GET` and `PUT` methods and the `content-type` and `if-none-match` request headers; a credential that cannot read that configuration is reported as unverified, never as a pass. Never put a bucket credential in a `NEXT_PUBLIC_*` variable or in the repository. Provisioning the storage, issuing the API tokens and installing the values is separate authorization. Both stages currently use the same private bucket in the same Cloudflare account; giving production its own bucket is a later, separate decision.

Released uploads whose bytes could not be deleted are retried by a server-side cleanup pass. It needs `SUPABASE_SERVICE_ROLE_KEY` in the stage that runs it (the same server-only secret the employee administration adapters use); a missing or placeholder value leaves the backlog logged and unretried rather than falling back to a client session. Ordinary file-completion traffic drains up to three released registrations per request, and an operator can drain up to twenty at a time by calling `POST /api/maintenance/file-cleanup` with `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`; the response reports `{retried,cleared,remaining}` and nothing is deleted without a confirmed removal.

Each bucket also needs one CORS rule before any browser upload or download works, because the browser itself sends the signed `PUT` and follows the presigned links. Allow every application origin that uses the bucket, the `GET` and `PUT` methods, and the `content-type` and `if-none-match` request headers. A bucket with the four `R2_*` values but no CORS rule fails every browser upload with an opaque CORS error, so install the rule while provisioning the bucket. `check:env` reads that rule, so the omission is caught before the first upload; a token that cannot read it is reported as unverified, so extend the token's permission in that case.

Moving existing objects is a deliberate operator step: `node scripts/copy-property-files-to-r2.mjs` (dry run by default, `--apply` to copy and then verify, `--verify` for the verification pass alone) copies every registered object from the Supabase `property-files` bucket to R2 with identical keys. It needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the four `R2_*` values in its own shell, deletes nothing in Supabase, and has not been run against a hosted project. Retiring the old bucket is a separate decision taken after a verified copy.

For a Vercel **Preview** deployment, `SGN_ENV` must be `dev`. Runtime redirects and password-recovery links use Vercel's server-supplied `VERCEL_URL` hostname, so they remain on the deployment that initiated the request instead of jumping to the stable dev site. Enable Vercel's automatic system environment variables; do not override `VERCEL_ENV` or `VERCEL_URL`. Local/prebuilt compilation has no deployment URL yet and uses the configured dev origin. Production and the stable dev deployment keep their canonical `NEXT_PUBLIC_APP_URL`. This does not trust request Host headers or widen the production redirect allowlist.

File completion requires a separately authorized operator to generate a random 32-byte key privately, configure its hex value as `SGN_FILE_VALIDATION_KEY` in Vercel, and install the identical value in `private.file_validation_keys` (`id=1`, `key_hex`) through an owner-authorized connection. Never print, commit or expose this key through `NEXT_PUBLIC_`; ordinary users and service-role clients have no key-table access. Missing configuration fails file completion closed. Production key provisioning/rotation is separate authorization.

Employee deactivation's and employee invitation's provider steps require `SUPABASE_SERVICE_ROLE_KEY` as a server-only environment variable in the stage that runs the trusted adapter. It is used only to call the exact employee's Auth admin API, to send one provider invitation to the recorded address, to call the server-only `record_employee_deactivation_result`/`record_employee_invitation_result` RPCs, and to read the caller's own recorded invitation, employee and account-deletion state on the invitation-acceptance journey (issue #69) — whose session, credential and linking all run through the caller's publishable-key client; ordinary requests keep using the request-scoped publishable-key session, and the employee administration and invitation tables grant that client no write. Never prefix it with `NEXT_PUBLIC_`, print it, commit it or return it in a response. Missing or placeholder configuration fails the provider step closed: membership is disabled first and the operation stays a recorded `provider_pending` reconciliation state, and an invitation stays recorded as `provider_pending`, so no browser can claim provider success. Configuring or rotating this key is a separate authorization.

Optional local Supabase: inspect the pinned CLI help before `supabase start`, `supabase status`, `supabase test db`, or an explicitly authorized **local-only** `supabase db reset --local`. Never reset a linked hosted database. Embedded `npm run test:schema` does not replace real Auth/Data API/RLS/Storage verification.

## 3. Resource isolation and activation checklist

Keep the existing two logical stages and two isolated hosting/database pairs. Previews belong to dev; they are not a third business stage or a paid custom Vercel environment.

| Delivery               | Trigger                                                           | GitHub environment | Vercel project / target       | Database                     | Activation switch    |
| ---------------------- | ----------------------------------------------------------------- | ------------------ | ----------------------------- | ---------------------------- | -------------------- |
| Pull request preview   | Same-repository PR opened, updated or reopened                    | `preview`          | Dev project / **Preview**     | Dev, sanitized fixtures only | `CD_PREVIEW_ENABLED` |
| Stable dev review site | Manual dispatch on `develop`, `stage=dev`                         | `dev`              | Dev project / **Production**  | Dev                          | `CD_DEV_ENABLED`     |
| Production             | Push/merge to default branch `main`, or manual dispatch on `main` | `prod`             | Prod project / **Production** | Prod                         | `CD_PROD_ENABLED`    |

Each delivery kind has its own repository-variable switch and is enabled only by that switch. All three are off by default, and setting one never starts another kind's run, so previews and the stable dev release can be active while every production trigger stays skipped. The same Next.js application is built separately for each target. Never promote a dev build to prod: public values are baked at build time. `vercel.json` deliberately retains `git.deploymentEnabled: false`; GitHub Actions owns delivery so native Git integration cannot bypass quality, database or environment gates. Do not enable a second deployment path.

### Observed external state (13 October 2026, read-only)

Read-only inspection found default branch `main`; `main` and `develop` protected with `quality` required as a strict status check; GitHub environments `preview`, `dev` and `prod` with required-reviewer protection and custom branch policies; and the four isolation variables plus environment-scoped variables/secrets for the dev project (`prj_lMBsG1sEDirNqUcZ9uCDE4xp0vyS`, Supabase `tneucwzcrzteeixvttpu`, `https://sgn-inventory-dev.vercel.app`) and the prod project (`prj_AiubrTA5b64d3GeVKAozTT6gSeSZ`, Supabase `zckhbxpatjmdqpnqphgy`, `https://sgnewhouse.online`). The earlier unconfirmed dev/prod project assignment is therefore resolved by the configured variables. Environment-scoped secrets are installed for all three environments; the Supabase access token and database password are held in `dev` and `prod` only and never in `preview`. **No activation switch is set**, so every CD job is skipped today and production delivery stays disabled. Local Vercel CLI authentication exists, but this worktree has no `.vercel/project.json` or `.vercel/repo.json`. No resource was linked, created, deployed or dispatched, and no workflow was run. These identifiers are not credentials; a local login is not a GitHub Actions `VERCEL_TOKEN`.

### Before enabling credentials or CD

1. Confirm/create the authorized isolated Vercel and Supabase projects. Record both exact Vercel links, project IDs, organization ID, canonical domains and Supabase refs. Select repository root, Next.js, Node `24.x`, `npm ci`, and `npm run build` in both Vercel projects.
2. Keep native Git deployments disabled. Enable automatic system environment variables. Configure the dev project's **Preview and Production** variables using `.env.dev.example`; configure the prod project's **Production** variables using `.env.prod.example`. Never store prod values in Preview/Development. The dev Preview `NEXT_PUBLIC_APP_URL` remains the stable dev origin; runtime preview URL handling is automatic as above. Branch-specific Preview overrides must still match the guarded dev values.
3. Create GitHub environments `preview`, `dev`, `prod` **before** enabling workflows. Restrict `dev` to `develop`, `prod` to `main`; allow only intended same-repository PR merge refs for `preview` (GitHub evaluates `refs/pull/<number>/merge`, not just the head branch). Require reviewers, prevent self-review and disable protection bypass where available. A named-but-missing environment is auto-created unprotected: that is not a gate. Verify plan support before storing credentials; if unavailable, establish an equivalent enforceable approval gate first.
4. Protect `main` and `develop`: require PR review and CI's `quality` check, block force pushes/deletion and restrict bypass. Preserve existing stronger rules. The workflows change none of these settings. Read the actual CI check name from a completed run. Do not require the optional preview check for forks, since fork previews deliberately do not deploy.
5. Keep deployment secrets **environment-scoped**, not repository/organization secrets exposed to PRs. A same-repository PR executes its code during install/build: the `preview` reviewer must trust the exact commit before releasing secrets. Use the narrowest available Vercel token/team access; a token authorized for both projects can publish both, irrespective of these code-level guards. No production or database-admin secrets belong in `preview`. Forks receive secret-free CI only; never switch this workflow to `pull_request_target` to enable them.
6. Configure Supabase as described below and apply reviewed compatible migrations through separately authorized database work. Previews never migrate. Automatic production delivery **verifies** that no migrations are pending and stops otherwise.
7. Activate delivery one stage at a time. Once step 3's `preview` environment and the dev project credentials exist, set repository variable **`CD_PREVIEW_ENABLED=true`**; once dev releases are wanted, set **`CD_DEV_ENABLED=true`**. Leave **`CD_PROD_ENABLED`** unset and complete staging acceptance from [testing.md](testing.md) first: a separate production release decision sets it later. Each switch is the literal `true`, each is off when unset, and no stage's switch can start another stage's run. Until the matching switch is set, that run's jobs are skipped; CI still runs. Skipped CD is not a successful deployment. The switches gate preview and application releases only; the separately authorized database-only workflow is unchanged.

### Exact GitHub variables and secrets

Repository variables (target allowlists; do not shadow them with different environment values):

- `CD_PREVIEW_ENABLED`, `CD_DEV_ENABLED`, `CD_PROD_ENABLED`: stage-scoped activation for preview, dev and production delivery, each the literal `true` only after its own checklist. All are unset by default; setting the preview or development switch can never enable a production run, and production stays skipped until `CD_PROD_ENABLED` is deliberately set.
- `DEV_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_PROJECT_REF`: distinct 20-letter refs.
- `DEV_VERCEL_PROJECT_ID`, `PROD_VERCEL_PROJECT_ID`: distinct `prj_...` IDs.

For **each** GitHub environment (`preview` uses the dev values):

| Kind                      | Name                                   | Source/value                                                                      |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| Variable                  | `SUPABASE_PROJECT_REF`                 | Selected stage's Supabase ref                                                     |
| Variable                  | `VERCEL_ORG_ID`                        | Vercel organization/team ID (`orgId` from authorized linking)                     |
| Variable                  | `VERCEL_PROJECT_ID`                    | Selected project Settings → General → Project ID                                  |
| Variable                  | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project Settings → API → project URL                                     |
| Variable                  | `NEXT_PUBLIC_APP_URL`                  | Selected stage's stable HTTPS origin from Vercel Domains                          |
| Secret                    | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Matching Supabase publishable key, not secret/service-role                        |
| Secret                    | `VERCEL_TOKEN`                         | Authorized Vercel account Settings → Tokens token, narrowly scoped                |
| Secret, if protected      | `VERCEL_AUTOMATION_BYPASS_SECRET`      | That Vercel project's Deployment Protection → Protection Bypass for Automation    |
| Secret, `dev`/`prod` only | `SUPABASE_ACCESS_TOKEN`                | Authorized Supabase account CLI access token for migration inspection/application |
| Secret, `dev`/`prod` only | `SUPABASE_DB_PASSWORD`                 | Selected stage's database password                                                |

`SGN_ENV`, `EXPECTED_SUPABASE_PROJECT_REF` and `VERCEL_TARGET` are selected by workflows, not user secrets. Match GitHub and pulled Vercel values exactly, including trailing-slash spelling. `SGN_FILE_VALIDATION_KEY` belongs only in Vercel's server environment and the matching private database singleton; it need not be duplicated as a GitHub secret. Pulled environment files and build outputs remain ephemeral on the runner, never uploaded as artifacts. Vercel CLI reads `VERCEL_TOKEN` from the environment, not command-line arguments.

### Exact Supabase settings

- One dev and one prod project with distinct refs and keys. Expose only `public` in the Data API, never `private`. Preserve grants/RLS and the private file buckets (the legacy Supabase one and R2). Use the user's publishable-key session for ordinary requests; no service-role fallback.
- Disable open signup/anonymous sign-in; employee invitation and live employee linkage remain separate. Supply an authorized linked active test employee for preview acceptance, never real production customer fixtures.
- Auth **Site URL**: stable dev origin on dev; canonical production origin on prod.
- Auth **Redirect URLs**: permit `<stage-origin>/auth/callback` for the PKCE recovery flow and `<stage-origin>/auth/invite` for the invitation destination (issue #68), so a delivered invitation returns to the fixed application path instead of the Site URL. Email templates using the token-hash flow must target the same stage's `/auth/confirm` with `type=recovery`; never point dev mail at prod. Configure real SMTP/delivered recovery separately.
- Dev only: allow each emitted preview origin's `/auth/callback` before testing recovery. Exact URLs are safest; if opting into automation, use a reviewed project-and-team-scoped Vercel preview glob, never `https://*.vercel.app/**`, and never add preview wildcards to prod. Confirm the generated URL pattern from a real deployment rather than guessing a slug. Deployment Protection must still allow the authorized recipient to return through the same preview/browser PKCE flow.
- Apply the reviewed migration set and configure the matching file attestation key before relying on features. Compile/configuration health is not proof of schema, recovery, RLS or Storage acceptance.

## 4. CI and delivery operation

### CI

`.github/workflows/ci.yml` runs on every PR and pushes to `main`/`develop`, and is reused by delivery. It installs pinned npm dependencies and Python requirements, then runs formatting, lint, types, unit/configuration/release tests, embedded schema checks, import tests, environment validation and the Next build. Its publishable key is an inert fixture; no database/network acceptance is claimed.

### Pull request previews

`.github/workflows/preview.yml` is gated by `CD_PREVIEW_ENABLED`, reuses CI, then enters the protected `preview` environment for same-repository PRs only. With the switch unset its jobs are skipped and the PR still gets CI. It checks the merge ref and dev-only project/database mapping, pulls that dev project's Preview configuration, verifies it, builds with `--target=preview`, and deploys the exact prebuilt output with `--target=preview` (never `--prod`). It writes the URL to the GitHub environment deployment and Actions step summary, then checks configuration health. A newer update cancels the older run for that PR. A failed build never uploads; a post-upload smoke failure does not undo an already-created deployment.

The preview builds the tested PR merge ref. It has no Supabase migration credentials and never applies SQL. If the PR needs a schema change, separately review/apply a compatible change on dev before using that feature. Closed previews are not deleted automatically; cleanup is a separately authorized operation. Vercel credentials in this workflow require the exact-commit trust/approval boundary above.

### Production from the default branch

`.github/workflows/deploy.yml` is triggered by pushes to **`main` (the current default branch)** or by manual dispatch, and starts a run only while its stage switch is set: `CD_PROD_ENABLED` for a `main` push or a `stage=prod` dispatch, `CD_DEV_ENABLED` for a `stage=dev` dispatch on `develop`. With the switch unset, the quality, migration and deploy jobs are all skipped while CI still runs on the push. Once started, CI must pass, then the protected stage environment gates a **verify-only** database check. Any pending migration fails the run before application upload. Once current, it checks the isolated stage configuration, pulls that stage's Production values, builds with `--prod`, deploys the exact prebuilt artifact with `--prod`, and records the deployment URL, then checks `/api/health` (status and stage) on that stage's canonical origin rather than on the ephemeral deployment address, which deployment protection answers with its SSO page. A non-200, non-JSON or mismatched response prints the URL, status and body prefix. Branch protections remain the merge authority; this workflow never pushes or merges.

If the default branch is renamed, update the trigger, branch guards, environment restrictions and tests together. Application/database releases serialize through `release-dev` or `release-prod` with `cancel-in-progress: false`, shared with the database-only workflow; do not cancel a running migration to rush a release.

Manual **Release application and database** remains available on `develop`/`dev` or `main`/`prod`, each requiring its own stage switch. `migration=apply` explicitly applies reviewed pending migrations before deploying (existing manual default); `migration=verify` never writes and fails if any remain. A main push always selects verify, never inherits that manual default. Do not dispatch `apply` without concrete migration authorization. After separately applying a reviewed migration, re-run the failed automatic release for the same commit or dispatch `migration=verify`. Never bypass the guard or rewrite deployed migrations.

**Review database migrations** (`migrate.yml`, shared `migration.yml`) remains the database-only operation. Default `apply=false` lists pending migrations and fails if any remain. With separate authorization, `apply=true` repeats the guarded dry run and applies through the pinned Supabase CLI. Both the dry run and the push pass `--include-all` deliberately: a branch ticket migration can be versioned before migrations already applied on the stage, and the reviewed path must list and apply it instead of refusing or silently omitting it. Recorded migration versions are never renamed or repaired. Neither flow imports, seeds, resets, restores, changes Auth/Storage settings or provisions resources.

### Activation evidence still required

After inputs and approvals exist, activate and verify one stage at a time. Set `CD_PREVIEW_ENABLED`, open/update a same-repository PR and confirm its dev-only preview URL, exercise login/recovery and private workflows against sanitized dev data, and confirm forks get CI but no preview secrets. Then set `CD_DEV_ENABLED` and dispatch a `stage=dev` release on `develop`, confirming the dev project, URL and reported stage. Only after staging acceptance and a separate production release decision, set `CD_PROD_ENABLED` and confirm the prod URL/stage and affected real workflows on a `main` release. Retain evidence without keys, signed links or customer data. **No hosted deployment, migration or live Supabase acceptance was performed by this CD configuration task.**

## 5. Operations and limits

- Enable Web Analytics separately on each Vercel project (Analytics → Web Analytics). The already-pinned application integration reports to the serving project, not across projects. No dashboard toggle, quota or collection is established by repository configuration.
- Failed configuration/migration/build checks publish nothing. A failed post-deployment smoke does **not** automatically roll back a domain or database. `/api/health` proves only stage/configuration shape.
- Rollback requires separate authorization: use a compatible previously verified deployment from the **same** project/stage, then rerun health and affected user acceptance. Prefer reviewed database forward fixes; never reset production or blindly reverse migrations.
- Missing inputs fail closed; do not replace publishable keys with privileged keys, loosen guards, disable environment reviewers or enable native Git deploys to make a run green.
- If CD is skipped, check the stage switch (`CD_PREVIEW_ENABLED`, `CD_DEV_ENABLED` or `CD_PROD_ENABLED`), fork origin and event/branch selection. Until `CD_PROD_ENABLED` is deliberately set, production triggers skip by design. If a job awaits approval, inspect its exact commit and target. If a verify run fails, inspect pending migrations, authorize/apply them separately and retry the same reviewed release.

## Sources

- [Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)
- [Vercel prebuilt delivery](https://vercel.com/docs/cli/deploying-from-cli)
- [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [GitHub environments and protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
