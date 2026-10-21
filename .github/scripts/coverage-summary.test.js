'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const YAML = require('yaml');

const action = YAML.parse(fs.readFileSync('coverage-summary/action.yml', 'utf8'));
const script = action.runs.steps.find(step => step.name === 'Commenting combined PR coverage diff').with.script;

async function render(files, existing = []) {
  const reports = {};
  for (const [name, hits] of Object.entries(files)) {
    reports[`/workspace/coverage-summary/${name}/clover.xml`] =
      `<coverage><file name="/runner/moodle/public/local/mxsdk/classes/example.php">${hits.map((count, index) =>
        `<line num="${index + 1}" type="stmt" count="${count}"/>`).join('')}</file></coverage>`;
    reports[`/workspace/coverage-summary/${name}/metadata.json`] = JSON.stringify({ pluginPath: 'local/mxsdk' });
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
