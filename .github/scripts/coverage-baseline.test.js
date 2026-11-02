'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectBaseline} = require('../../coverage-summary/baseline');

const a = 'coverage-target-a';
const b = 'coverage-target-b';
const metadata = JSON.stringify({pluginPath: 'local/mxsdk'});
const lines = JSON.stringify({version: 1, files: {'/runner/moodle/local/mxsdk/classes/example.php': {1: true}}});

function fixture(rounds, extra = {}) {
  let round = 0;
  let clock = 0;
  const sleeps = [];
  const manifests = extra.manifests || {};
  const options = {
    prTargets: [a], waitMinutes: '1',
    context: {repo: {owner: 'test', repo: 'plugin'}, runId: 99, payload: {pull_request: {base: {ref: 'main'}}}},
    now: () => clock,
    sleep: async ms => { clock += ms; round++; sleeps.push(ms); },
    read: async (github, repo, artifact, names) => names[0] === 'expected-targets.json'
      ? [JSON.stringify({version: 1, targets: manifests[artifact.run] || [a]})] : [metadata, lines],
    github: {
      paginate: async (method, params) => {
        if (method === 'runs') {
          assert.equal(params.branch, 'main');
          assert.equal(params.event, 'push');
          assert.equal(params.status, undefined);
          return rounds[Math.min(round, rounds.length - 1)];
        }
        const run = rounds[Math.min(round, rounds.length - 1)].find(run => run.id === params.run_id);
        if (run.noManifest) return [];
        return [{name: 'coverage-expected-targets', run: run.id}, ...[a].map(name => ({name, run: run.id}))];
      },
      rest: {actions: {getWorkflowRun: async () => ({data: {workflow_id: 7}}), listWorkflowRuns: 'runs', listWorkflowRunArtifacts: 'artifacts'}},
    },
  };
  return {options, sleeps};
}

test('race: ignores old incompatible baseline and waits for matching running push to succeed', async () => {
  const old = {id: 1, status: 'completed', conclusion: 'success'};
  const {options, sleeps} = fixture([
    [{id: 2, status: 'in_progress'}, old],
    [{id: 2, status: 'completed', conclusion: 'success'}, old],
  ], {manifests: {1: [a, b]}});
  assert.deepEqual(await selectBaseline(options), {runId: 2});
  assert.deepEqual(sleeps, [30000]);
});

test('waits for queued run whose setup manifest is not yet published', async () => {
  const {options, sleeps} = fixture([
    [{id: 2, status: 'queued', noManifest: true}],
    [{id: 2, status: 'completed', conclusion: 'success'}],
  ]);
  assert.equal((await selectBaseline(options)).runId, 2);
  assert.equal(sleeps.length, 1);
});

test('timeout yields pending message with link rather than incompatible comparison', async () => {
  const {options, sleeps} = fixture([[{id: 2, status: 'in_progress'}]]);
  const result = await selectBaseline(options);
  assert.equal(result.runId, undefined);
  assert.match(result.reason, /comparison pending/);
  assert.match(result.reason, /https:\/\/github.com\/test\/plugin\/actions\/runs\/2/);
  assert.deepEqual(sleeps, [30000, 30000]);
});

test('failed pending baseline stops waiting and reports unavailable with run link', async () => {
  const {options, sleeps} = fixture([
    [{id: 2, status: 'in_progress'}],
    [{id: 2, status: 'completed', conclusion: 'failure'}],
  ]);
  const result = await selectBaseline(options);
  assert.match(result.reason, /comparison unavailable/);
  assert.match(result.reason, /actions\/runs\/2/);
  assert.equal(sleeps.length, 1);
});

test('existing complete matching baseline is used immediately despite another pending run', async () => {
  const {options, sleeps} = fixture([[{id: 2, status: 'in_progress'}, {id: 1, status: 'completed', conclusion: 'success'}]]);
  assert.equal((await selectBaseline(options)).runId, 1);
  assert.equal(sleeps.length, 0);
});

test('no baseline or only incompatible pending matrices never sleeps', async () => {
  for (const rounds of [[[]], [[{id: 2, status: 'in_progress'}]]]) {
    const {options, sleeps} = fixture(rounds, {manifests: {2: [b]}});
    assert.match((await selectBaseline(options)).reason, /comparison unavailable/);
    assert.equal(sleeps.length, 0);
  }
});

test('zero wait disables polling and invalid limits are rejected', async () => {
  const {options, sleeps} = fixture([[{id: 2, status: 'in_progress'}]]);
  assert.match((await selectBaseline({...options, waitMinutes: '0'})).reason, /comparison pending/);
  assert.equal(sleeps.length, 0);
  for (const waitMinutes of ['', '-1', '61', 'NaN']) await assert.rejects(selectBaseline({...options, waitMinutes}), /baseline-wait-minutes/);
});
