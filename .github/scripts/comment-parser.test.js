'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const YAML = require('yaml');

const action = YAML.parse(fs.readFileSync('comment-parser/action.yml', 'utf8'));
const script = action.runs.steps[0].with.script;
const runScript = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', 'process', script);

const parse = async ({ token = true, state = 'active', role = 'member', error, username = 'requester', eventName = 'issue_comment' } = {}) => {
  const outputs = {};
  const requests = [];
  const context = {
    eventName,
    repo: { owner: 'my-org', repo: 'plugin' },
    payload: {
      issue: { number: 12, pull_request: {} },
      comment: { body: '#behat @javascript', user: username ? { login: username } : undefined },
      pull_request: eventName === 'issue_comment' ? undefined : { number: 12, head: { sha: 'abc123' } },
      review: { body: '#behat @javascript', user: username ? { login: username } : undefined },
    },
  };
  const github = {
    rest: {
      orgs: { getMembershipForUser: async request => {
        requests.push(request);
        if (error) throw error;
        return { data: { state, role } };
      } },
      pulls: { get: async () => ({ data: { head: { sha: 'abc123' } } }) },
    },
  };
  const core = {
    setOutput: (name, value) => { outputs[name] = value; },
    warning: () => {},
    notice: () => {},
  };
  await runScript(github, context, core, { env: { HAS_ORG_MEMBERS_TOKEN: String(token) } });
  return { outputs, requests };
};

test('active organization members can request Behat', async () => {
  const { outputs, requests } = await parse();
  assert.equal(outputs.is_behat_comment, 'true');
  assert.equal(outputs.behat_tag_arguments, '--tags=@javascript');
  assert.deepEqual(requests, [{ org: 'my-org', username: 'requester' }]);
  assert.equal((await parse({ role: 'admin' })).outputs.is_behat_comment, 'true');
});

test('outside users, pending members, and failed lookups cannot request Behat', async () => {
  for (const options of [
    { error: { status: 404 } },
    { error: { status: 403 } },
    { state: 'pending' },
    { role: 'billing_manager' },
    { token: false },
    { username: '' },
  ]) {
    const { outputs } = await parse(options);
    assert.equal(outputs.is_behat_comment, 'false');
    assert.equal(outputs.behat_tag_arguments, '');
  }
});

test('review bodies authorize the review author', async () => {
  const { outputs, requests } = await parse({ eventName: 'pull_request_review' });
  assert.equal(outputs.is_behat_comment, 'true');
  assert.deepEqual(requests, [{ org: 'my-org', username: 'requester' }]);
});
