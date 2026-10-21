'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const YAML = require('yaml');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const action = YAML.parse(fs.readFileSync('coverage-summary/action.yml', 'utf8'));
const script = action.runs.steps.find(step => step.name === 'Commenting combined PR coverage diff').with.script;

async function render(files, existing = [], pluginPath = 'local/mxsdk') {
  const reports = {};
  for (const [name, hits] of Object.entries(files)) {
    reports[`/workspace/coverage-summary/${name}/clover.xml`] =
      typeof hits === 'string' ? hits :
        `<coverage><file name="/runner/moodle/public/local/mxsdk/classes/example.php">${hits.map((count, index) =>
          `<line num="${index + 1}" type="stmt" count="${count}"/>`).join('')}</file></coverage>`;
    reports[`/workspace/coverage-summary/${name}/metadata.json`] = JSON.stringify({ pluginPath });
  }
  const calls = [];
  const mockFs = {
    existsSync: dir => Object.keys(reports).some(file => file === dir || file.startsWith(`${dir}/`)),
    readFileSync: file => reports[file],
    readdirSync: dir => [...new Set(Object.keys(reports).filter(file => file.startsWith(`${dir}/`))
      .map(file => file.slice(dir.length + 1).split('/')[0]))].map(name => ({
      name,
      isDirectory: () => !Object.hasOwn(reports, `${dir}/${name}`),
      isFile: () => Object.hasOwn(reports, `${dir}/${name}`),
    })),
  };
  await vm.runInNewContext(`(async () => {${script}\n})()`, {
    require: name => name === 'fs' ? mockFs : require(name),
    process: { env: { GITHUB_WORKSPACE: '/workspace', BASE_ARTIFACTS_FOUND: 'true', ARTIFACT_PREFIX: 'coverage-' } },
    context: { repo: { owner: 'test', repo: 'plugin' }, payload: { pull_request: { number: 4 } } },
    core: { warning: assert.fail },
    github: {
      paginate: async () => existing,
      rest: { issues: {
        listComments: () => {},
        updateComment: async value => calls.push({ update: true, ...value }),
        createComment: async value => calls.push(value),
      } },
    },
  });
  return calls;
}

test('merges complementary matrix coverage without counting lines twice and normalizes plugin paths', async () => {
  const [comment] = await render({ 'pr/php83': [1, 0, 0], 'pr/php84': [0, 1, 0], 'base/php83': [1, 0, 0] });
  assert.match(comment.body, /PR artifacts merged: 2/);
  assert.match(comment.body, /33\.33% \(1\/3\).*66\.67% \(2\/3\).*\+33\.33%/);
  assert.match(comment.body, /`classes\/example.php`/);
  assert.doesNotMatch(comment.body, /`public\/|`local\/mxsdk\//);
});

test('updates the existing coverage bot comment instead of creating another', async () => {
  const calls = await render({ 'pr/php84': [1], 'base/php84': [0] }, [
    { id: 7, user: { type: 'Bot' }, body: '<!-- moodle-test-action-coverage-summary -->' },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].update, true);
  assert.equal(calls[0].comment_id, 7);
});

test('explains missing Clover reports rather than reporting zero coverage', async () => {
  const [comment] = await render({});
  assert.match(comment.body, /did not produce any `clover.xml`/);
});

test('only plugin files contribute even when core, dependencies and traversal paths are in Clover', async () => {
  const xml = `<coverage>${[
    ['public/local/mxsdk/classes/example.php', 1],
    ['public/lib/moodlelib.php', 0],
    ['public/local/dependency/classes/example.php', 0],
    ['public/local/mxsdk_extra/classes/example.php', 0],
    ['public/local/mxsdk/../../lib.php', 0],
  ].map(([name, count]) => `<file name="/runner/moodle/${name}"><line num="1" type="stmt" count="${count}"/></file>`).join('')}</coverage>`;
  const [comment] = await render({ 'pr/php84': xml, 'base/php84': xml });
  assert.match(comment.body, /100\.00% \(1\/1\)/);
  assert.doesNotMatch(comment.body, /moodlelib|dependency|mxsdk_extra|\.\.\//);
});

test('missing and invalid plugin metadata cannot admit unrestricted files', async () => {
  for (const metadata of ['', null, '../local/mxsdk']) {
    const [comment] = await render({ 'pr/php84': [1], 'base/php84': [1] }, [], metadata);
    assert.doesNotMatch(comment.body, /`classes\/example.php`/);
    assert.doesNotMatch(comment.body, /100\.00%/);
  }
});

test('baseline discovery skips newest metadata-only artifact for older Clover report', async () => {
  const baselineScript = action.runs.steps.find(step => step.name === 'Finding base branch coverage run').with.script;
  const downloads = [];
  const removed = [];
  let selected = '';
  let artifactId;
  await vm.runInNewContext(`(async () => {${baselineScript}\n})()`, {
    Buffer,
    require: name => ({
      fs: {
        mkdtempSync: prefix => `${prefix}fixture`,
        writeFileSync: () => {},
        appendFileSync: (file, text) => { selected += text; },
        rmSync: dir => removed.push(dir),
      },
      os, path,
      child_process: { execFileSync: (command, args) => args[0] === '-Z1'
        ? (artifactId === 20 ? 'metadata.json\n' : 'clover.xml\nmetadata.json\n')
        : '<coverage><file name="/runner/moodle/local/mxsdk/classes/example.php"/></coverage>' },
    })[name],
    process: { env: { ARTIFACT_PREFIX: 'coverage-', GITHUB_ENV: '/env' } },
    context: { repo: { owner: 'test', repo: 'plugin' }, payload: { pull_request: { base: { ref: 'main' } } } },
    core: { notice: () => {}, warning: assert.fail },
    github: {
      paginate: async (method, params) => method === 'runs' ? [{ id: 2 }, { id: 1 }]
        : [{ id: params.run_id * 10, name: 'coverage-php84', expired: false }],
      rest: { actions: {
        getWorkflowRun: async () => ({ data: { workflow_id: 7 } }),
        listWorkflowRuns: 'runs', listWorkflowRunArtifacts: 'artifacts',
        downloadArtifact: async params => {
          artifactId = params.artifact_id;
          downloads.push(artifactId);
          return { data: new ArrayBuffer(0) };
        },
      } },
    },
  });
  assert.deepEqual(downloads, [20, 10]);
  assert.match(selected, /base_coverage_run_id=1\n/);
  assert.equal(removed.length, 2);
});

test('producer skips metadata and artifact creation when no nonempty Clover report exists', () => {
  const producer = YAML.parse(fs.readFileSync('phpunit-test/action.yml', 'utf8'));
  const script = producer.runs.steps.find(step => step.name === 'Resolve coverage artifact metadata').run;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-producer-'));
  try {
    fs.mkdirSync(path.join(workspace, 'coverage'));
    const envFile = path.join(workspace, 'env');
    for (const emptyFile of [false, true]) {
      if (emptyFile) fs.writeFileSync(path.join(workspace, 'coverage/clover.xml'), '');
      execFileSync('bash', ['-e', '-c', script], { env: { ...process.env, GITHUB_WORKSPACE: workspace, GITHUB_ENV: envFile } });
      assert.equal(fs.existsSync(path.join(workspace, 'coverage/metadata.json')), false);
      assert.doesNotMatch(fs.readFileSync(envFile, 'utf8'), /coverage_artifact_name=coverage-/);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('fallback config scopes source to plugin while preserving suite and bootstrap across PHPUnit versions', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-config-'));
  try {
    for (const major of [9, 11]) {
      const element = major === 9 ? 'coverage' : 'source';
      const input = path.join(workspace, 'phpunit.xml');
      const output = path.join(workspace, 'scoped.xml');
      fs.writeFileSync(input, `<phpunit bootstrap="lib/bootstrap.php"><testsuites><testsuite name="local_mxsdk_testsuite"/></testsuites><${element}><include><directory>lib</directory><directory>local/dependency</directory></include></${element}></phpunit>`);
      execFileSync('php', ['phpunit-test/prepare-coverage.php', input, output, workspace, String(major)]);
      const xml = fs.readFileSync(output, 'utf8');
      assert.match(xml, /bootstrap="lib\/bootstrap.php"/);
      assert.match(xml, /name="local_mxsdk_testsuite"/);
      assert.ok(xml.includes(`<directory suffix=".php">${workspace}</directory>`));
      assert.doesNotMatch(xml, /<directory>lib<|<directory>local\/dependency</);
      assert.ok(xml.includes(`${workspace}/tests`));
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
