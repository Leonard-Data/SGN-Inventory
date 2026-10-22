import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { cdActivation } from './release-guard.mjs';

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

// A merge carrying a migration must apply it, or the release fails on purpose
// while production stays behind. The mode is pinned to both trigger shapes: a
// push applies, a dispatch still chooses, and verify keeps its failing path.
test('a main push applies its reviewed migrations before the release', () => {
  const deploy = workflow('deploy.yml');
  assert.equal(
    gate(deploy.jobs.migrate.with.apply),
    gate("${{ github.event_name == 'push' || inputs.migration == 'apply' }}"),
  );
  assert.equal(deploy.jobs.migrate.with.stage, "${{ inputs.stage || 'prod' }}");

  // The apply flag selects the write path and nothing else: the applying push
  // runs only when apply, the deliberate failure runs only when it does not.
  const steps = workflow('migration.yml').jobs.migrate.steps;
  assert.equal(
    steps.find((step) => step.name === 'Apply the reviewed pending migrations')
      ?.if,
    'inputs.apply',
  );
  assert.equal(
    gate(
      steps.find((step) => step.name === 'Fail while migrations remain pending')
        ?.if,
    ),
    '${{ !inputs.apply }}',
  );
});

// The release-guard step reads its activation switch from the process
// environment, but a repository variable is not exported there on its own. A
// job whose `if:` gate uses a switch yet omits it from `env:` starts, then
// stops before any cloud contact with activation off. These expectations name
// every delivery kind each guarded job can select, and the test resolves the
// parsed job and step environments to prove the switch is wired, not merely
// mentioned.
const ACTIVATION_SWITCH_BY_KIND = {
  preview: 'CD_PREVIEW_ENABLED',
  dev: 'CD_DEV_ENABLED',
  prod: 'CD_PROD_ENABLED',
};

const ACTIVATION_JOBS = [
  { workflow: 'preview.yml', job: 'deploy', kinds: ['preview'] },
  { workflow: 'deploy.yml', job: 'deploy', kinds: ['dev', 'prod'] },
];

const REPOSITORY_VARIABLE = /^\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}$/;

function resolveRepositoryEnv(env, variables) {
  const resolved = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    const reference = REPOSITORY_VARIABLE.exec(String(value).trim());
    resolved[name] = reference ? (variables[reference[1]] ?? '') : value;
  }
  return resolved;
}

test('each activation-guard job exports its own kind switch from repository variables', () => {
  for (const { workflow: name, job: jobName, kinds } of ACTIVATION_JOBS) {
    const job = workflow(name).jobs[jobName];
    const step = activationStep(job);
    assert.ok(step, `${name}.${jobName} must run the activation guard`);
    for (const kind of kinds) {
      const switchName = ACTIVATION_SWITCH_BY_KIND[kind];
      assert.equal(
        String(job.env?.[switchName] ?? '').trim(),
        `\${{ vars.${switchName} }}`,
        `${name}.${jobName} must export ${switchName} from repository variables`,
      );
      // With every repository switch off except this kind's own, the resolved
      // job and step environments must activate exactly this kind.
      const off = Object.fromEntries(
        Object.values(ACTIVATION_SWITCH_BY_KIND).map((key) => [key, 'false']),
      );
      const enabled = { ...off, [switchName]: 'true' };
      assert.equal(
        cdActivation(kind, {
          ...resolveRepositoryEnv(job.env, enabled),
          ...resolveRepositoryEnv(step.env, enabled),
        }),
        true,
        `${name}.${jobName} must activate ${kind} from its environment`,
      );
      assert.equal(
        cdActivation(kind, {
          ...resolveRepositoryEnv(job.env, off),
          ...resolveRepositoryEnv(step.env, off),
        }),
        false,
        `${name}.${jobName} must stay off while ${switchName} is unset`,
      );
    }
  }
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
