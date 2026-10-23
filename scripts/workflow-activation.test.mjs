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
// while production stays behind. These cases resolve the workflow's own
// conditions for each trigger shape, so a rewrite that keeps the meaning passes
// and a condition that changes it fails.
const EXPRESSION_TOKEN =
  /\s*(\|\||&&|==|!=|!|\(|\)|'[^']*'|[A-Za-z_][\w.]*|\d+)/g;

function tokenizeCondition(expression) {
  const source = String(expression)
    .replace(/^\s*\$\{\{/, '')
    .replace(/\}\}\s*$/, '');
  return [...source.matchAll(EXPRESSION_TOKEN)].map(([, token]) => {
    if (/^'/.test(token)) return { literal: token.slice(1, -1) };
    if (/^\d/.test(token)) return { literal: Number(token) };
    if (/^[A-Za-z_]/.test(token)) return { reference: token };
    return { operator: token };
  });
}

// The subset these workflow conditions use: references, literals, `!`, `==`,
// `!=`, `&&`, `||` and parentheses.
function resolveCondition(expression, context) {
  const tokens = tokenizeCondition(expression);
  let position = 0;
  const take = () => tokens[position++];
  const peek = (operator) => tokens[position]?.operator === operator;

  function primary() {
    if (peek('!')) {
      take();
      return !primary();
    }
    if (peek('(')) {
      take();
      const value = disjunction();
      assert.equal(take()?.operator, ')', `unclosed group in ${expression}`);
      return value;
    }
    const token = take();
    if (!token || token.operator) {
      throw new Error(`unexpected token in ${expression}`);
    }
    if ('literal' in token) return token.literal;
    if (token.reference === 'true') return true;
    if (token.reference === 'false') return false;
    return token.reference
      .split('.')
      .reduce((value, key) => value?.[key], context);
  }

  function comparison() {
    const left = primary();
    if (peek('==')) {
      take();
      // Loose comparison keeps an absent trigger input unequal to a literal.
      return left == comparison();
    }
    if (peek('!=')) {
      take();
      return left != comparison();
    }
    return left;
  }

  function conjunction() {
    let value = comparison();
    while (peek('&&')) {
      take();
      const right = comparison();
      value = value && right;
    }
    return value;
  }

  function disjunction() {
    let value = conjunction();
    while (peek('||')) {
      take();
      const right = conjunction();
      value = value || right;
    }
    return value;
  }

  const value = disjunction();
  assert.equal(position, tokens.length, `unparsed tokens in ${expression}`);
  return value;
}

test('a main push applies its reviewed migrations before the release', () => {
  const deploy = workflow('deploy.yml');
  const applyFor = (event, inputs) =>
    resolveCondition(deploy.jobs.migrate.with.apply, {
      github: { event_name: event },
      inputs,
    });

  // A push reaches this pipeline only on the default branch, which is what
  // keeps apply-on-push from reaching another stage.
  assert.deepEqual(deploy.on.push.branches, ['main']);
  assert.equal(deploy.on.workflow_dispatch.inputs.migration.default, 'apply');
  assert.equal(applyFor('push', {}), true);
  assert.equal(applyFor('workflow_dispatch', { migration: 'apply' }), true);
  assert.equal(applyFor('workflow_dispatch', { migration: 'verify' }), false);
  assert.equal(
    resolveCondition(deploy.jobs.migrate.with.stage, { inputs: {} }),
    'prod',
  );
  assert.equal(
    resolveCondition(deploy.jobs.migrate.with.stage, {
      inputs: { stage: 'dev' },
    }),
    'dev',
  );

  // The apply flag selects the write path and nothing else: the applying step
  // runs only when apply, the deliberate failure runs only when it does not.
  const steps = workflow('migration.yml').jobs.migrate.steps;
  const conditionOf = (name) => {
    const step = steps.find((candidate) => candidate.name === name);
    assert.ok(step, `migration.yml must keep the step "${name}"`);
    return step.if;
  };
  for (const apply of [true, false]) {
    assert.equal(
      resolveCondition(conditionOf('Apply the reviewed pending migrations'), {
        inputs: { apply },
      }),
      apply,
    );
    assert.equal(
      resolveCondition(conditionOf('Fail while migrations remain pending'), {
        inputs: { apply },
      }),
      !apply,
    );
  }
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
