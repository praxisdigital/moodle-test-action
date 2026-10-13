'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrWorkflow, resolvePrConfig } = require('./pr-workflow-config');
const { legacyRows } = require('./resolve-matrix');

const caller = withBlock => `name: Moodle CI
on: [pull_request, issue_comment]
jobs:
  unrelated:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  ci:
    uses: praxisdigital/moodle-test-action/.github/workflows/ci.yml@master
    secrets: inherit
${withBlock}`;

test('reads folded JSON dependencies and literal matrix overrides from the PR workflow', () => {
  const values = parsePrWorkflow(caller(`    with:
      dependencies: >-
        [
          "praxisdigital/local_praxislib@MOODLE_44_STABLE",
          "praxisdigital/local_pxllogger@MOODLE_50_STABLE"
        ]
      db_types: '["mysqli", "pgsql"]'
      automatic: 'true'
      products: '["moodle", "workplace"]'
      run_behat: 'true'
`));
  assert.deepEqual(JSON.parse(values.dependencies), [
    'praxisdigital/local_praxislib@MOODLE_44_STABLE',
    'praxisdigital/local_pxllogger@MOODLE_50_STABLE',
  ]);
  assert.equal(values.db_types, '["mysqli", "pgsql"]');
  assert.equal(values.products, '["moodle", "workplace"]');
});

test('supports whitespace-separated dependencies and absent with block', () => {
  assert.equal(parsePrWorkflow(caller('    with:\n      dependencies: org/one@main org/two@main\n')).dependencies,
    'org/one@main org/two@main');
  assert.deepEqual(parsePrWorkflow(caller('')), {});
});

test('rejects ambiguous, dynamic or malformed PR workflow configuration', () => {
  assert.throws(() => parsePrWorkflow('jobs: {}'), /exactly one/);
  assert.throws(() => parsePrWorkflow(caller('    with:\n      dependencies: ${{ vars.PLUGIN_DEPENDENCIES }}\n')), /cannot evaluate/);
  assert.throws(() => parsePrWorkflow(caller('    with:\n      dependencies:\n        - org/one@main\n')), /literal/);
  assert.throws(() => parsePrWorkflow(caller('    with:\n      dependencies: a\n      dependencies: b\n')), /keys must be unique/i);
});

test('comment uses PR inputs ahead of org variables and ignores default-branch caller inputs', () => {
  const pr = parsePrWorkflow(caller(`    with:
      dependencies: '["org/first@MOODLE_500_STABLE", "org/second@master"]'
      db_types: '["pgsql"]'
      products: '["workplace"]'
      php_versions: '["8.3", "8.4"]'
      additional_behat_arguments: '--dry-run'
`));
  const config = resolvePrConfig(pr, {
    dependencies: 'org/default@master', db_types: '["mysqli"]', php_versions: '["7.4"]',
    additional_behat_arguments: '--verbose',
  }, 'org');
  assert.equal(config.dependencies, 'org/first@MOODLE_500_STABLE org/second@master');
  assert.deepEqual(config.db_types, ['pgsql']);
  assert.deepEqual(config.php_versions, ['8.3', '8.4']);
  assert.equal(config.products, '["workplace"]');
  assert.equal(config.additional_behat_arguments, '--dry-run');
  assert.equal(config.run_behat, 'true');
});

test('missing PR inputs use variable or reusable-workflow defaults, never old caller with', () => {
  const config = resolvePrConfig({}, { dependencies: 'org/variable@main', db_types: '["pgsql"]',
    php_versions: '["7.4"]' }, 'org');
  assert.equal(config.automatic, 'true');
  assert.deepEqual(config.php_versions, []);
  assert.equal(config.dependencies, 'org/variable@main');
  assert.deepEqual(config.db_types, ['pgsql']);
  assert.equal(resolvePrConfig({}, {}, 'org').dependencies, '');
});

test('legacy PR matrix and disabled Behat stay explicit', () => {
  const config = resolvePrConfig({ automatic: 'false', run_behat: 'false', moodle_versions: '["MOODLE_405_STABLE"]',
    php_versions: '["8.2"]' }, {}, 'org');
  assert.deepEqual(config.moodle_versions, ['MOODLE_405_STABLE']);
  assert.deepEqual(config.php_versions, ['8.2']);
  assert.equal(config.run_behat, 'false');
  assert.throws(() => resolvePrConfig({ org: 'other' }, {}, 'org'), /with.org differs/);
});

test('PR dependencies and database choice reach the Behat matrix row', () => {
  const pr = parsePrWorkflow(caller(`    with:
      automatic: 'false'
      dependencies: '["org/one@MOODLE_44_STABLE", "org/two@master"]'
      db_types: '["pgsql"]'
      moodle_versions: '["MOODLE_404_STABLE"]'
      moodle_repositories: '["moodle/moodle"]'
      php_versions: '["8.3"]'
`));
  const config = resolvePrConfig(pr, { dependencies: 'org/default@main' }, 'org');
  const result = legacyRows({
    phpVersions: config.php_versions, moodleVersions: config.moodle_versions,
    repositories: config.moodle_repositories, os: config.os, dbTypes: config.db_types,
    experimental: config.experimental, excludes: config.exclude_matrix,
    suites: ['behat'], dependencies: config.dependencies,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].dbtype, 'pgsql');
  assert.equal(result.rows[0].dependencies, 'org/one@MOODLE_44_STABLE org/two@master');
});
