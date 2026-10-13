import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

// `.github/workflows` is delivery configuration, so the regression these tests
// guard is silent activation: a run that starts for the wrong stage, or a
// production trigger that another stage's switch can satisfy. The gates are
// pinned as whole expressions instead of substrings, because a stage condition
// dropped from one half of an expression is exactly the failure being tested.
const WORKFLOWS = [
  'ci.yml',
  'deploy.yml',
  'migrate.yml',
  'migration.yml',
  'preview.yml',
];

function workflowText(name) {
  return readFileSync(
    new URL(`../.github/workflows/${name}`, import.meta.url),
    'utf8',
  );
}

function workflow(name) {
  return parse(workflowText(name));
}

// GitHub folds a multi-line `if:` scalar into one line; compare gates the same
// way so the condition, not its layout, is what the test pins.
function gate(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function activationStep(job) {
  return (job?.steps ?? []).find(
    (step) => step.run === 'node scripts/release-guard.mjs activation',
  );
}

test('the shared repository-wide switch is retired', () => {
  for (const name of WORKFLOWS) {
    assert.ok(
      !/(^|[^A-Z_])CD_ENABLED([^A-Z_]|$)/.test(workflowText(name)),
      `${name} must use a stage-scoped activation switch`,
    );
  }
});

test('preview activation is preview-scoped and needs the same-repository fork guard', () => {
  const preview = workflow('preview.yml');
  assert.equal(
    gate(preview.jobs.quality.if),
    gate(`vars.CD_PREVIEW_ENABLED == 'true' &&
      github.event.pull_request.head.repo.full_name == github.repository`),
  );
  assert.equal(
    gate(preview.jobs.deploy.if),
    "vars.CD_PREVIEW_ENABLED == 'true'",
  );
  assert.equal(preview.jobs.deploy.environment.name, 'preview');
  assert.deepEqual(preview.jobs.deploy.needs, 'quality');
  assert.equal(
    activationStep(preview.jobs.deploy)?.env?.SGN_CD_KIND,
    'preview',
  );
  const text = workflowText('preview.yml');
  assert.ok(
    !/CD_DEV_ENABLED|CD_PROD_ENABLED/.test(text),
    'preview must not read another stage activation switch',
  );
});

test('release activation is stage-scoped and production keeps its own switch', () => {
  const deploy = workflow('deploy.yml');
  assert.equal(
    gate(deploy.jobs.quality.if),
    gate(`(inputs.stage == 'dev' && vars.CD_DEV_ENABLED == 'true') ||
      ((inputs.stage == 'prod' || github.event_name == 'push') &&
        vars.CD_PROD_ENABLED == 'true')`),
  );
  assert.equal(
    gate(deploy.jobs.deploy.if),
    gate(`(inputs.stage == 'dev' && github.ref == 'refs/heads/develop' &&
        vars.CD_DEV_ENABLED == 'true') ||
      ((inputs.stage == 'prod' || github.event_name == 'push') &&
        github.ref == 'refs/heads/main' && vars.CD_PROD_ENABLED == 'true')`),
  );
  // The database change still lands before the application it belongs to, and
  // a skipped quality gate still skips the migration and the release.
  assert.deepEqual(deploy.jobs.migrate.needs, 'quality');
  assert.equal(deploy.jobs.migrate.if, undefined);
  assert.deepEqual(deploy.jobs.deploy.needs, 'migrate');
  assert.equal(
    activationStep(deploy.jobs.deploy)?.env?.SGN_CD_KIND,
    "${{ inputs.stage || 'prod' }}",
  );
});

test('the database-only migration workflows stay separately authorized', () => {
  // They are manual, environment-gated and default to a read-only dry run;
  // application release switches must not silently become their gate.
  for (const name of ['migrate.yml', 'migration.yml']) {
    assert.ok(
      !/CD_(PREVIEW|DEV|PROD)_ENABLED/.test(workflowText(name)),
      `${name} must keep its own authorization`,
    );
  }
  // The database-only dispatch keeps its stage branch guard and its own
  // apply flag instead of borrowing an application release switch.
  assert.match(gate(workflow('migration.yml').jobs.migrate.if), /refs\/heads/);
  assert.equal(workflow('migrate.yml').jobs.migrate.if, undefined);
});
