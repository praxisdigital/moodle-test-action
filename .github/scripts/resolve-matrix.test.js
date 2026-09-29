'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  branchNumber, releaseBranch, phpRange, validateCatalogue, readMetadata, selectTargets, selectRequiredTargets, buildRows,
  legacyRows,
  resolve,
} = require('./resolve-matrix');

const catalogue = validateCatalogue(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'moodle-test-targets.json'), 'utf8')));
const requires = readMetadata('<?php $plugin->requires = 2022112800;');
const releases = targets => targets.map(target => target.release);
const coreBuilds = { '4.0': 2022041900, '4.1': 2022112800, '4.2': 2023042400,
  '4.3': 2023100900, '4.4': 2024042200, '4.5': 2024100700, '5.0': 2025041400,
  '5.1': 2025100600, '5.2': 2026042000 };
const choose = (branches, base, metadata = requires, products = ['moodle']) => {
  const targets = selectTargets(catalogue, branches, base, metadata, products);
  const versions = Object.fromEntries(targets.map(target => [`${target.repository}@${target.ref}`, coreBuilds[target.release]]));
  return selectRequiredTargets(targets, versions, metadata.requires);
};

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
  assert.deepEqual(releases(choose(branches, branches[0])), ['4.1']);
  assert.deepEqual(releases(choose(branches, branches[1])), ['4.5']);
  assert.deepEqual(releases(choose(branches, branches[2])), ['5.0', '5.2']);
});

test('repository B: a 5.2 branch takes ownership of 5.2 and newer', () => {
  const branches = ['MOODLE_41_STABLE', 'MOODLE_500_STABLE', 'MOODLE_502_STABLE'];
  assert.deepEqual(releases(choose(branches, branches[0])), ['4.1', '4.5']);
  assert.deepEqual(releases(choose(branches, branches[1])), ['5.0']);
  assert.deepEqual(releases(choose(branches, branches[2])), ['5.2']);
});

test('Workplace release branches use the same applicable release boundaries', () => {
  const branches = ['WORKPLACE_41_STABLE', 'WORKPLACE_500_STABLE', 'WORKPLACE_502_STABLE'];
  assert.deepEqual(releases(choose(branches, branches[0], requires, ['workplace'])), ['4.1', '4.5']);
  assert.deepEqual(releases(choose(branches, branches[1], requires, ['workplace'])), ['5.0']);
  assert.deepEqual(releases(choose(branches, branches[2], requires, ['workplace'])), ['5.2']);
  assert.ok(choose(branches, branches[0], requires, ['workplace']).every(target => target.ref.startsWith('WORKPLACE_')));
});

test('both products run by default on either branch prefix; explicit products restrict them', () => {
  const branches = ['MOODLE_500_STABLE', 'WORKPLACE_502_STABLE'];
  for (const base of ['MOODLE_500_STABLE', 'WORKPLACE_500_STABLE']) {
    const selected = choose(branches, base, requires, ['moodle', 'workplace']);
    assert.deepEqual(selected.map(target => [target.product, target.release]), [
      ['moodle', '5.0'], ['workplace', '5.0'],
    ]);
    assert.deepEqual(choose(branches, base, requires, ['workplace']).map(target => target.product), ['workplace']);
  }
  assert.deepEqual(choose(branches, 'feature/123', requires, ['moodle', 'workplace']).map(target => target.product),
    ['moodle', 'workplace', 'moodle', 'workplace', 'moodle', 'workplace', 'moodle', 'workplace']);
  assert.throws(() => selectTargets(catalogue, branches, branches[0], requires, ['other']), /products/);
});

test('an optional release runs as the compatible baseline, not between required milestones', () => {
  const branches = ['MOODLE_500_STABLE', 'MOODLE_501_STABLE', 'MOODLE_502_STABLE'];
  assert.deepEqual(releases(choose(branches, branches[1])), ['5.1']);
  assert.deepEqual(releases(choose(branches, branches[0])), ['5.0']);
  const startingAt42 = readMetadata('<?php $plugin->requires = 2023042400;');
  assert.deepEqual(releases(choose(['MOODLE_402_STABLE', 'MOODLE_405_STABLE'], 'MOODLE_402_STABLE', startingAt42)), ['4.2']);
});

test('version.php sets the baseline even when the branch name is older', () => {
  const metadata = readMetadata('<?php $plugin->requires = 2023042400;');
  assert.deepEqual(releases(choose(['MOODLE_400_STABLE', 'MOODLE_405_STABLE'], 'MOODLE_400_STABLE', metadata)), ['4.2']);
  const from40 = readMetadata('<?php $plugin->requires = 2022041900;');
  assert.deepEqual(choose(['MOODLE_400_STABLE', 'MOODLE_402_STABLE'], 'MOODLE_400_STABLE', from40,
    ['moodle', 'workplace']).map(target => `${target.product}:${target.release}`),
  ['moodle:4.0', 'workplace:4.0', 'moodle:4.1', 'workplace:4.1']);
});

test('version.php supported and incompatible versions narrow branch ranges', () => {
  const metadata = readMetadata(`<?php
    $plugin->requires = 2025041400.00;
    $plugin->supported = [500, 502];
    $plugin->incompatible = 502;
  `);
  assert.deepEqual(releases(choose(['MOODLE_500_STABLE'], 'MOODLE_500_STABLE', metadata)), ['5.0']);
});

test('ordinary branches test the first compatible release and required milestones', () => {
  const branches = ['MOODLE_500_STABLE', 'MOODLE_502_STABLE', 'mma_123_500_STABLE'];
  assert.deepEqual(releases(choose(branches, 'feature/work')), ['4.1', '4.5', '5.0', '5.2']);
});

test('workplace ref and PHP range remain coupled', () => {
  const selected = choose(['WORKPLACE_500_LATEST', 'WORKPLACE_502_LATEST'], 'WORKPLACE_500_LATEST', requires, ['workplace']);
  const key = `${selected[0].repository}@${selected[0].ref}`;
  const rows = buildRows(selected, ['mysqli', 'sqlsrv'], ['phpunit', 'behat'], '', { [key]: 2025041400 });
  assert.deepEqual(selected.map(target => target.release), ['5.0']);
  assert.deepEqual(new Set(rows.map(row => row.php)), new Set(['8.2', '8.3', '8.4']));
  assert.ok(rows.every(row => row.moodle_repository === 'praxisdigital/moodle_workplace_moxis'));
  assert.ok(rows.filter(row => row.suite === 'behat').every(row => row.dbtype === 'mysqli'));
});

test('automatic PHP filter intersects each catalogue range without dropping releases', () => {
  const selected = choose(['MOODLE_500_STABLE'], 'MOODLE_500_STABLE');
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
  assert.throws(() => validateCatalogue({ targets: [{ ...catalogue[0], required: 'false' }] }), /Invalid target/);
  assert.throws(() => validateCatalogue({ targets: [catalogue[0], { ...catalogue[0], product: 'workplace', required: true }] }), /Conflicting required/);
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
    `$version = ${ref === 'MOODLE_500_STABLE' ? 2025041400 : ref === 'MOODLE_501_STABLE' ? 2025100600 : 2026042000}.00;`
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
      products: ['moodle'],
      cataloguePath: path.join(__dirname, '..', 'moodle-test-targets.json'), versionPath,
      overrides: { moodle: ['MOODLE_401_STABLE'], php: ['7.4'] },
    });
    assert.deepEqual(checked, [['MOODLE_500_STABLE', 'version.php'], ['MOODLE_501_STABLE', 'public/version.php'], ['MOODLE_502_STABLE', 'public/version.php']]);
    assert.deepEqual(releases(result.targets), ['5.0', '5.2']);
    fs.writeFileSync(versionPath, '<?php $plugin->requires = 2025100600;');
    const updated = await resolve({ github, context: { repo: { owner: 'example', repo: 'plugin' } },
      branch: 'MOODLE_500_STABLE', dbTypes: ['mysqli'], suites: ['phpunit'], dependencies: '',
      products: ['moodle'],
      cataloguePath: path.join(__dirname, '..', 'moodle-test-targets.json'), versionPath,
    });
    assert.deepEqual(releases(updated.targets), ['5.1', '5.2']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('default resolver reads public Moodle and private Workplace with their respective credentials', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-matrix-'));
  const versionPath = path.join(directory, 'version.php');
  fs.writeFileSync(versionPath, '<?php $plugin->requires = 2025041400;');
  const requested = [];
  try {
    const result = await resolve({
      github: {
        paginate: async () => [{ name: 'WORKPLACE_500_STABLE' }, { name: 'WORKPLACE_502_STABLE' }],
        rest: { repos: { listBranches() {}, getContent: async ({ owner }) => {
          assert.equal(owner, 'moodle');
          return { data: { type: 'file', content: Buffer.from('$version = 2025041400.00;').toString('base64') } };
        } } },
      },
      appToken: 'test-app-token',
      request: async (url, options) => {
        requested.push({ url: String(url), authorization: options.headers.Authorization });
        return { ok: true, json: async () => ({ type: 'file',
          content: Buffer.from('$version = 2025041400.00;').toString('base64') }) };
      },
      context: { repo: { owner: 'example', repo: 'plugin' } },
      branch: 'WORKPLACE_500_STABLE', dbTypes: ['mysqli'], suites: ['phpunit'], dependencies: '',
      cataloguePath: path.join(__dirname, '..', 'moodle-test-targets.json'), versionPath,
    });
    assert.deepEqual(result.targets.map(target => [target.product, target.release]), [['moodle', '5.0'], ['workplace', '5.0']]);
    assert.ok(requested.some(item => /\/repos\/praxisdigital\/moodle_workplace_moxis\/contents\/version\.php\?ref=WORKPLACE_500_LATEST$/.test(item.url)));
    assert.ok(requested.every(item => item.authorization === 'Bearer test-app-token'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
