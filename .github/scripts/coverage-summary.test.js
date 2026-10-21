'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const YAML = require('yaml');
const reports = require('../../coverage-summary/reports');
const action = YAML.parse(fs.readFileSync('coverage-summary/action.yml', 'utf8'));
const metadata = JSON.stringify({pluginPath: 'local/mxsdk'});
const report = lines => JSON.stringify({version: 1, files: {'/runner/moodle/public/local/mxsdk/classes/example.php': lines}});
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));

function artifact(dir, lines, meta = metadata) {
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'metadata.json'), meta);
  fs.writeFileSync(path.join(dir, 'lines.json'), lines);
}

test('merges complementary coverage exactly once per executable line', () => {
  const dir = scratch();
  try {
    artifact(path.join(dir, 'a'), report({1: true, 2: false, 3: false}));
    artifact(path.join(dir, 'b'), report({1: false, 2: true, 3: false}));
    const result = reports.mergeReports(reports.findReports(dir));
    assert.equal(result.total, 3);
    assert.equal(result.covered, 2);
    assert.equal(result.artifactCount, 2);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('rejects invalid metadata, empty maps and non-plugin paths using the same parser', () => {
  for (const meta of ['{}', 'null', '{', JSON.stringify({pluginPath: '../local/mxsdk'}), JSON.stringify({pluginPath: 5})]) {
    assert.throws(() => reports.parseReport(meta, report({1: true})));
  }
  for (const lines of [report({}), JSON.stringify({version: 1, files: {'/runner/moodle/lib/core.php': {1: true}}})]) {
    assert.throws(() => reports.parseReport(metadata, lines));
  }
  const files = reports.parseReport(metadata, JSON.stringify({version: 1, files: {
    '/runner/moodle/public/local/mxsdk/classes/example.php': {1: true},
    '/runner/moodle/public/local/dependency/foo.php': {1: false},
    '/runner/moodle/public/local/mxsdk_extra/foo.php': {1: false},
    '/runner/moodle/public/local/mxsdk/../../core.php': {1: false},
  }}));
  assert.deepEqual(files, {'classes/example.php': {1: true}});
});

test('baseline discovery skips missing/invalid metadata, empty and out-of-plugin reports before a usable run', async () => {
  const dir = scratch();
  const downloads = [];
  let selected = '';
  try {
    const candidates = [
      {'clover.xml': '<coverage><file/></coverage>'},
      {'lines.json': report({1: true})},
      {'metadata.json': '{', 'lines.json': report({1: true})},
      {'metadata.json': metadata, 'lines.json': report({})},
      {'metadata.json': metadata, 'lines.json': JSON.stringify({version: 1, files: {'/runner/moodle/lib/core.php': {1: true}}})},
      {'metadata.json': metadata, 'lines.json': report({1: false})},
    ];
    for (const [index, files] of candidates.entries()) {
      const folder = path.join(dir, String(index));
      fs.mkdirSync(folder);
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), content);
      execFileSync('zip', ['-q', path.join(dir, `${index}.zip`), ...Object.keys(files)], {cwd: folder});
    }
    await vm.runInNewContext(`(async () => {${action.runs.steps.find(s => s.name === 'Finding base branch coverage run').with.script}\n})()`, {
      Buffer,
      require: name => name === 'fs' ? {...fs, appendFileSync: (file, value) => { selected += value; }} : require(name),
      process: {env: {REPORTS_MODULE: path.resolve('coverage-summary/reports.js'), ARTIFACT_PREFIX: 'coverage-', GITHUB_ENV: '/env'}},
      context: {repo: {owner: 'test', repo: 'plugin'}, payload: {pull_request: {base: {ref: 'main'}}}},
      core: {notice: () => {}, warning: () => {}},
      github: {
        paginate: async (method, params) => method === 'runs' ? candidates.map((_, id) => ({id}))
          : [{id: params.run_id, name: 'coverage-test', expired: false}],
        rest: {actions: {
          getWorkflowRun: async () => ({data: {workflow_id: 7}}),
          listWorkflowRuns: 'runs', listWorkflowRunArtifacts: 'artifacts',
          downloadArtifact: async ({artifact_id}) => { downloads.push(artifact_id); return {data: fs.readFileSync(path.join(dir, `${artifact_id}.zip`))}; },
        }},
      },
    });
    assert.deepEqual(downloads, [0, 1, 2, 3, 4, 5]);
    assert.match(selected, /base_coverage_run_id=5\n/);
    // The same run selected by discovery is actually consumable by the merger.
    assert.equal(reports.mergeReports(reports.findReports(path.join(dir, '5'))).total, 1);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('summary updates the existing bot comment using exact line reports', async () => {
  const dir = scratch();
  let comment;
  try {
    artifact(path.join(dir, 'coverage-summary/pr/a'), report({1: true, 2: true}));
    artifact(path.join(dir, 'coverage-summary/base/a'), report({1: true, 2: false}));
    await vm.runInNewContext(`(async () => {${action.runs.steps.find(s => s.name === 'Commenting combined PR coverage diff').with.script}\n})()`, {
      require, process: {env: {GITHUB_WORKSPACE: dir, REPORTS_MODULE: path.resolve('coverage-summary/reports.js'), BASE_ARTIFACTS_FOUND: 'true'}},
      context: {repo: {owner: 'test', repo: 'plugin'}, payload: {pull_request: {number: 4}}},
      core: {warning: assert.fail},
      github: {paginate: async () => [{id: 7, user: {type: 'Bot'}, body: '<!-- moodle-test-action-coverage-summary -->'}], rest: {issues: {
        listComments: () => {}, createComment: assert.fail, updateComment: async value => { comment = value; },
      }}},
    });
    assert.equal(comment.comment_id, 7);
    assert.match(comment.body, /50\.00% \(1\/2\).*100\.00% \(2\/2\).*\+50\.00%/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('producer skips artifacts with missing or empty exact line reports', () => {
  const producer = YAML.parse(fs.readFileSync('phpunit-test/action.yml', 'utf8'));
  const script = producer.runs.steps.find(s => s.name === 'Resolve coverage artifact metadata').run;
  const dir = scratch();
  try {
    fs.mkdirSync(path.join(dir, 'coverage'));
    fs.writeFileSync(path.join(dir, 'coverage/clover.xml'), '<coverage/>');
    for (const empty of [false, true]) {
      if (empty) fs.writeFileSync(path.join(dir, 'coverage/lines.json'), '');
      execFileSync('bash', ['-e', '-c', script], {env: {...process.env, GITHUB_WORKSPACE: dir, GITHUB_ENV: path.join(dir, 'env')}});
      assert.equal(fs.existsSync(path.join(dir, 'coverage/metadata.json')), false);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('incomplete or rejected target sets never produce numeric deltas or removed-file rows', async () => {
  const cases = [
    {base: {a: report({1: true, 2: false}), b: report({1: false, 2: true})}, pr: {a: report({1: true, 2: false})}, expected: /PR missing usable targets: b/},
    {base: {a: report({1: true})}, pr: {b: report({1: true})}, expected: /Base missing usable targets: b/},
    {base: {a: report({1: true}), b: '{'}, pr: {a: report({1: true})}, expected: /Base rejected target b/},
    {base: {a: report({1: true})}, pr: {a: report({1: true}), b: '{'}, expected: /PR rejected target b/},
    {base: {a: report({1: true})}, pr: {a: '{'}, expected: /PR has no usable coverage targets/},
    {base: {a: report({1: true})}, pr: {}, expected: /did not produce any coverage artifacts/},
  ];
  for (const fixture of cases) {
    const dir = scratch();
    let body;
    try {
      for (const side of ['base', 'pr']) {
        for (const [target, lines] of Object.entries(fixture[side])) artifact(path.join(dir, 'coverage-summary', side, target), lines);
      }
      await vm.runInNewContext(`(async () => {${action.runs.steps.find(s => s.name === 'Commenting combined PR coverage diff').with.script}\n})()`, {
        require, process: {env: {GITHUB_WORKSPACE: dir, REPORTS_MODULE: path.resolve('coverage-summary/reports.js'), BASE_ARTIFACTS_FOUND: 'true'}},
        context: {repo: {owner: 'test', repo: 'plugin'}, payload: {pull_request: {number: 4}}},
        core: {warning: () => {}},
        github: {paginate: async () => [], rest: {issues: {
          listComments: () => {}, createComment: async value => { body = value.body; },
        }}},
      });
      assert.match(body, /Coverage incomplete \/ not comparable/);
      assert.match(body, fixture.expected);
      assert.doesNotMatch(body, /\| Statements \||\| File \||\d+\.\d+%|\| removed \|/);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  }
});

test('discovers metadata-only artifacts as rejected targets instead of silently losing them', () => {
  const dir = scratch();
  try {
    artifact(path.join(dir, 'a'), report({1: true}));
    fs.mkdirSync(path.join(dir, 'b'));
    fs.writeFileSync(path.join(dir, 'b/metadata.json'), metadata);
    const merged = reports.mergeReports(reports.findReports(dir));
    assert.deepEqual(merged.targets, ['a']);
    assert.equal(merged.rejected[0].target, 'b');
    assert.equal(reports.comparisonIssues(merged, merged).length, 2);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('fallback config scopes plugin source for PHPUnit 9 and 11', () => {
  const dir = scratch();
  try {
    for (const major of [9, 11]) {
      const tag = major === 9 ? 'coverage' : 'source';
      fs.writeFileSync(path.join(dir, 'input.xml'), `<phpunit bootstrap="lib/bootstrap.php"><testsuites><testsuite name="plugin"/></testsuites><${tag}><include><directory>lib</directory></include></${tag}></phpunit>`);
      execFileSync('php', ['phpunit-test/prepare-coverage.php', path.join(dir, 'input.xml'), path.join(dir, 'output.xml'), dir, String(major)]);
      const xml = fs.readFileSync(path.join(dir, 'output.xml'), 'utf8');
      assert.ok(xml.includes(`<directory suffix=".php">${dir}</directory>`));
      assert.match(xml, /bootstrap="lib\/bootstrap.php"/);
      assert.doesNotMatch(xml, /<directory>lib</);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('PHPUnit-generated one-line method fixture matches native statement metrics', () => {
  const root = '.github/scripts/fixtures/coverage-methods';
  const clover = fs.readFileSync(`${root}/clover.xml`, 'utf8');
  assert.match(clover, /type="method" name="covered"/);
  assert.match(clover, /type="method" name="uncovered"/);
  const dir = scratch();
  try {
    artifact(dir, fs.readFileSync(`${root}/lines.json`, 'utf8'));
    const merged = reports.mergeReports(reports.findReports(dir));
    const metrics = [...clover.matchAll(/<metrics\b[^>]*statements="(\d+)" coveredstatements="(\d+)"/g)].pop();
    assert.equal(merged.total, Number(metrics[1]));
    assert.equal(merged.covered, Number(metrics[2]));
    const lines = reports.parseReport(metadata, fs.readFileSync(`${root}/lines.json`, 'utf8'))['classes/Methods.php'];
    assert.equal(lines['4'], true);
    assert.equal(lines['5'], false);
    assert.equal(Object.hasOwn(lines, '6'), false); // Multiline declaration is not executable.
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
