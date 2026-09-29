'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  branchNumber, releaseBranch, phpRange, validateCatalogue, readMetadata, selectTargets, buildRows,
  legacyRows,
  resolve,
} = require('./resolve-matrix');

const catalogue = validateCatalogue(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'moodle-test-targets.json'), 'utf8')));
const requires = readMetadata('<?php $plugin->requires = 2022112800;');
const releases = targets => targets.map(target => target.release);

test('normalizes legacy and three-digit branch numbers, excluding short issue prefixes', () => {
  assert.equal(branchNumber('41'), 401);
  assert.equal(branchNumber('401'), 401);
  assert.equal(branchNumber('50'), 500);
  assert.equal(branchNumber('500'), 500);
  assert.deepEqual(releaseBranch('WORKPLACE_500_LATEST'), { release: 500, product: 'workplace' });
  assert.equal(releaseBranch('mma_123_500_STABLE'), null);
  assert.equal(releaseBranch('MOODLE_50_STALBE'), null);
});

test('repository A: each release branch owns targets until its successor', () => {
  const branches = ['MOODLE_41_STABLE', 'MOODLE_45_STABLE', 'MOODLE_50_STABLE'];
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[0], requires)), ['4.1', '4.4']);
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[1], requires)), ['4.5']);
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[2], requires)), ['5.0', '5.2']);
});

test('repository B: a 5.2 branch takes ownership of 5.2 and newer', () => {
  const branches = ['MOODLE_41_STABLE', 'MOODLE_500_STABLE', 'MOODLE_502_STABLE'];
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[0], requires)), ['4.1', '4.4', '4.5']);
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[1], requires)), ['5.0']);
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[2], requires)), ['5.2']);
});

test('Workplace release branches use the same applicable release boundaries', () => {
  const branches = ['WORKPLACE_41_STABLE', 'WORKPLACE_500_STABLE', 'WORKPLACE_502_STABLE'];
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[0], requires)), ['4.1', '4.4', '4.5']);
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[1], requires)), ['5.0']);
  assert.deepEqual(releases(selectTargets(catalogue, branches, branches[2], requires)), ['5.2']);
  assert.ok(selectTargets(catalogue, branches, branches[0], requires).every(target => target.ref.startsWith('WORKPLACE_')));
});

test('version.php supported and incompatible versions narrow branch ranges', () => {
  const metadata = readMetadata(`<?php
    $plugin->requires = 2025041400.00;
    $plugin->supported = [500, 502];
    $plugin->incompatible = 502;
  `);
  assert.deepEqual(releases(selectTargets(catalogue, ['MOODLE_500_STABLE'], 'MOODLE_500_STABLE', metadata)), ['5.0']);
});

test('ordinary branches are tested on latest eligible target without becoming boundaries', () => {
  const branches = ['MOODLE_500_STABLE', 'MOODLE_502_STABLE', 'mma_123_500_STABLE'];
  assert.deepEqual(releases(selectTargets(catalogue, branches, 'feature/work', requires)), ['5.2']);
});

test('workplace ref and PHP range remain coupled', () => {
  const selected = selectTargets(catalogue, ['WORKPLACE_500_LATEST', 'WORKPLACE_502_LATEST'], 'WORKPLACE_500_LATEST', requires);
  const key = `${selected[0].repository}@${selected[0].ref}`;
  const rows = buildRows(selected, ['mysqli', 'sqlsrv'], ['phpunit', 'behat'], '', { [key]: 2025041400 });
  assert.deepEqual(selected.map(target => target.release), ['5.0']);
  assert.deepEqual(new Set(rows.map(row => row.php)), new Set(['8.2', '8.3', '8.4']));
  assert.ok(rows.every(row => row.moodle_repository === 'praxisdigital/moodle_workplace_moxis'));
  assert.ok(rows.filter(row => row.suite === 'behat').every(row => row.dbtype === 'mysqli'));
});

test('automatic PHP filter intersects each catalogue range without dropping releases', () => {
  const selected = selectTargets(catalogue, ['MOODLE_500_STABLE'], 'MOODLE_500_STABLE', requires);
  const versions = Object.fromEntries(selected.map(target => [`${target.repository}@${target.ref}`, 2026042000]));
  const rows = buildRows(selected, ['mysqli'], ['phpunit'], '', versions, ['8.3', '8.4', '7.4']);
  assert.deepEqual([...new Set(rows.map(row => row.moodle))], ['MOODLE_500_STABLE', 'MOODLE_502_STABLE']);
  assert.deepEqual([...new Set(rows.map(row => row.php))], ['8.3', '8.4']);
  assert.throws(() => buildRows(selected, ['mysqli'], ['phpunit'], '', versions, ['8.2']), /No requested PHP version supports.*MOODLE_502_STABLE/);
});

test('invalid catalogue entries and incompatible ranges fail rather than falling back', () => {
  assert.deepEqual(phpRange('7.4', '8.1'), ['7.4', '8.0', '8.1']);
  assert.throws(() => phpRange('8.4', '8.2'));
  assert.throws(() => validateCatalogue({ targets: [catalogue[0], catalogue[0]] }), /Duplicate/);
  assert.throws(() => selectTargets(catalogue, [], 'MOODLE_403_STABLE', requires), /no moodle target/);
  assert.throws(() => readMetadata('<?php $plugin->version = 1;'), /requires/);
  assert.throws(() => readMetadata('<?php $plugin->requires = 1; $plugin->supported = get_versions();'), /supported/);
});

test('legacy mode preserves one-off refs, repositories, PHP, runners and exclusions', () => {
  const options = {
    moodleVersions: ['MOODLE_501_STABLE'], phpVersions: ['8.3'], repositories: ['other/core'],
    os: ['ubuntu-24.04'], experimental: [true], excludes: [],
    dbTypes: ['mysqli'], suites: ['phpunit'], dependencies: '',
  };
  const { rows } = legacyRows(options);
  assert.deepEqual(rows, [{ suite: 'phpunit', php: '8.3', moodle: 'MOODLE_501_STABLE',
    moodle_repository: 'other/core', os: 'ubuntu-24.04', dbtype: 'mysqli', experimental: true, dependencies: '' }]);
  assert.deepEqual(legacyRows({ ...options, excludes: [{ moodle_repos: 'other/core' }] }).rows, []);
  assert.equal(legacyRows({ ...options, repositories: ['other/core', 'moodle/moodle'] }).rows.length, 2);
});

test('resolver reads matching core version.php before building automatic rows', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moodle-matrix-'));
  const versionPath = path.join(directory, 'version.php');
  fs.writeFileSync(versionPath, '<?php $plugin->requires = 2025041400;');
  const checked = [];
  const lookup = async ({ ref }) => ({ data: { type: 'file', content: Buffer.from(
    `$version = ${ref === 'MOODLE_500_STABLE' ? 2025041400 : 2026042000}.00;`
  ).toString('base64') } });
  const github = {
    paginate: async () => [{ name: 'MOODLE_500_STABLE' }],
    rest: { repos: { listBranches() {}, getContent: async params => {
      checked.push([params.ref, params.path]);
      return lookup(params);
    } } },
  };
  try {
    const result = await resolve({ github, context: { repo: { owner: 'example', repo: 'plugin' } },
      branch: 'MOODLE_500_STABLE', dbTypes: ['mysqli'], suites: ['phpunit'], dependencies: '',
      cataloguePath: path.join(__dirname, '..', 'moodle-test-targets.json'), versionPath,
      overrides: { moodle: ['MOODLE_401_STABLE'], php: ['7.4'] },
    });
    assert.deepEqual(checked, [['MOODLE_500_STABLE', 'version.php'], ['MOODLE_502_STABLE', 'public/version.php']]);
    assert.deepEqual(releases(result.targets), ['5.0', '5.2']);
    fs.writeFileSync(versionPath, '<?php $plugin->requires = 2026042000;');
    await assert.rejects(() => resolve({ github, context: { repo: { owner: 'example', repo: 'plugin' } },
      branch: 'MOODLE_500_STABLE', dbTypes: ['mysqli'], suites: ['phpunit'], dependencies: '',
      cataloguePath: path.join(__dirname, '..', 'moodle-test-targets.json'), versionPath,
    }), /owns targets whose core version is below/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
