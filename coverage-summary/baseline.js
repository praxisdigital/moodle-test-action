'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {parseReport, readExpectedTargets, comparisonIssues} = require('./reports');

async function readArchive(github, repo, artifact, names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-baseline-'));
  try {
    const response = await github.rest.actions.downloadArtifact({...repo, artifact_id: artifact.id, archive_format: 'zip'});
    const archive = path.join(dir, 'artifact.zip');
    fs.writeFileSync(archive, Buffer.from(response.data));
    const entries = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8'}).trim().split('\n');
    return names.map(name => {
      if (!entries.includes(name)) throw new Error(`Missing ${name}`);
      return execFileSync('unzip', ['-p', archive, name], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    });
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

const sameTargets = (a, b) => a.length === b.length && a.every((target, index) => target === b[index]);

async function selectBaseline({github, context, prTargets, prefix = 'coverage-', waitMinutes = '15',
  notice = () => {}, warning = () => {}, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), read = readArchive}) {
  const minutes = Number(waitMinutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 || String(waitMinutes).trim() === '') {
    throw new Error('baseline-wait-minutes must be a number from 0 to 60');
  }
  const deadline = now() + minutes * 60000;
  const repo = context.repo;
  const branch = context.payload.pull_request.base.ref;
  const current = await github.rest.actions.getWorkflowRun({...repo, run_id: context.runId});
  const completed = new Map();
  const url = run => `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${run.id}`;

  async function inspect(run, pending) {
    const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {...repo, run_id: run.id, per_page: 100});
    const manifest = artifacts.find(artifact => artifact.name === 'coverage-expected-targets' && !artifact.expired);
    // Setup may not have published the manifest yet. Only pending runs can be unknown.
    if (!manifest) return pending ? 'unknown' : 'missing';
    const [text] = await read(github, repo, manifest, ['expected-targets.json']);
    const expectedTargets = readExpectedTargets(text);
    if (!sameTargets(expectedTargets, prTargets)) return 'different';
    if (pending) return 'matching';
    const candidate = {expectedTargets, targets: [], rejected: []};
    for (const artifact of artifacts.filter(a => a.name.startsWith(prefix) && a.name !== 'coverage-expected-targets' && !a.expired)) {
      try {
        const [metadata, lines] = await read(github, repo, artifact, ['metadata.json', 'lines.json']);
        parseReport(metadata, lines);
        candidate.targets.push(artifact.name);
      } catch (error) {
        candidate.rejected.push({target: artifact.name, reason: error.message});
        warning(`Skipping unusable coverage artifact ${artifact.name}: ${error.message}`);
      }
    }
    return comparisonIssues(candidate, candidate).length ? 'incomplete' : 'complete';
  }

  for (;;) {
    // Include pending/failed runs, rather than considering only already-successful pushes.
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      ...repo, workflow_id: current.data.workflow_id, branch, event: 'push', per_page: 20,
    });
    const pending = [];
    let unavailable;
    for (const run of runs) {
      const active = ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run.status);
      if (!active && run.conclusion !== 'success') {
        unavailable ??= run;
        continue;
      }
      let state;
      try {
        state = !active && completed.has(run.id) ? completed.get(run.id) : await inspect(run, active);
        if (!active) completed.set(run.id, state);
      } catch (error) {
        warning(`Could not inspect baseline run ${run.id}: ${error.message}`);
        // A pending manifest/artifact can be temporarily unavailable while being published.
        state = active ? 'unknown' : 'unusable';
      }
      if (state === 'complete') {
        notice(`Found complete matching baseline in run ${run.id} on ${branch}.`);
        return {runId: run.id};
      }
      if (active && ['matching', 'unknown'].includes(state)) pending.push(run);
      if (['incomplete', 'unusable', 'missing'].includes(state)) unavailable ??= run;
    }
    if (!pending.length) {
      return {reason: `Coverage comparison unavailable: no complete successful baseline with matching expected targets exists on ${branch}.`
        + (unavailable ? ` Base run: ${url(unavailable)}.` : '')
        + ' Run the base-branch workflow with the same matrix, then rerun the coverage summary.'};
    }
    if (now() >= deadline) {
      return {reason: `Coverage comparison pending: the matching base-branch workflow has not finished within the ${minutes}-minute wait. Base run: ${url(pending[0])}. Rerun the coverage summary after it completes.`};
    }
    notice(`Waiting for base coverage: ${url(pending[0])}`);
    await sleep(Math.min(30000, Math.max(0, deadline - now())));
  }
}

module.exports = {selectBaseline};
