'use strict';

const fs = require('node:fs');

const releaseNumber = value => {
  const match = String(value).match(/^(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid Moodle release: ${value}`);
  return Number(match[1]) * 100 + Number(match[2]);
};

// Moodle uses both 41 and 401 for 4.1, and both 50 and 500 for 5.0.
const branchNumber = value => {
  const digits = String(value);
  if (!/^\d{2,3}$/.test(digits)) throw new Error(`Invalid branch version: ${value}`);
  return digits.length === 2 ? Number(digits[0]) * 100 + Number(digits[1]) : Number(digits);
};

const releaseBranch = name => {
  const match = String(name).match(/^([A-Za-z][A-Za-z0-9-]{3,}(?:_[A-Za-z0-9-]+)*)_(\d{2,3})_(STABLE|LATEST)$/i);
  if (!match) return null;
  return {
    release: branchNumber(match[2]),
    product: /^WORKPLACE(?:_|$)/i.test(match[1]) ? 'workplace' : 'moodle',
  };
};

const phpNumber = value => {
  if (!/^\d+\.\d+$/.test(String(value))) throw new Error(`Invalid PHP version: ${value}`);
  const [major, minor] = value.split('.').map(Number);
  return major * 100 + minor;
};

const phpRange = (minimum, maximum) => {
  if (phpNumber(minimum) > phpNumber(maximum)) throw new Error(`PHP minimum ${minimum} exceeds maximum ${maximum}`);
  const [startMajor, startMinor] = minimum.split('.').map(Number);
  const [endMajor, endMinor] = maximum.split('.').map(Number);
  const versions = [];
  for (let major = startMajor; major <= endMajor; major++) {
    const start = major === startMajor ? startMinor : 0;
    const end = major === endMajor ? endMinor : (major === 7 ? 4 : 20);
    // PHP 7.4 is the last PHP 7 minor; avoid generating non-existent minors.
    if (major !== 7 && major !== 8) throw new Error(`Unsupported PHP major in catalogue: ${major}`);
    for (let minor = start; minor <= end; minor++) {
      if (major === 8 && minor > 5) throw new Error('Update the resolver before adding PHP newer than 8.5');
      versions.push(`${major}.${minor}`);
    }
  }
  return versions;
};

const validateCatalogue = data => {
  if (!data || !Array.isArray(data.targets) || !data.targets.length) throw new Error('Catalogue needs a non-empty targets array');
  const keys = new Set();
  return data.targets.map(target => {
    const release = releaseNumber(target.release);
    if (!['moodle', 'workplace'].includes(target.product) ||
        !/^[\w.-]+\/[\w.-]+$/.test(target.repository) ||
        !/^[A-Za-z0-9_.-]+$/.test(target.ref) ||
        (target.version_file && !['version.php', 'public/version.php'].includes(target.version_file))) {
      throw new Error(`Invalid target for release ${target.release}`);
    }
    const key = `${target.product}:${release}`;
    if (keys.has(key)) throw new Error(`Duplicate catalogue target: ${key}`);
    keys.add(key);
    return { ...target, number: release, php: phpRange(target.php_min, target.php_max) };
  });
};

const readMetadata = text => {
  // Parse only literal assignments. Never evaluate code from an untrusted PR.
  const source = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*/g, '');
  const requires = source.match(/\$plugin\s*->\s*requires\s*=\s*(\d+)(?:\.\d+)?\s*;/);
  if (!requires) throw new Error('Cannot read $plugin->requires from the tested version.php (literal number required)');
  const supported = source.match(/\$plugin\s*->\s*supported\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*,?\s*\]\s*;/);
  const incompatible = source.match(/\$plugin\s*->\s*incompatible\s*=\s*(\d+)\s*;/);
  if (!supported && /\$plugin\s*->\s*supported\s*=/.test(source)) throw new Error('Cannot parse literal $plugin->supported range');
  if (!incompatible && /\$plugin\s*->\s*incompatible\s*=/.test(source)) throw new Error('Cannot parse literal $plugin->incompatible version');
  return {
    requires: Number(requires[1]),
    supported: supported ? [branchNumber(supported[1]), branchNumber(supported[2])] : null,
    incompatible: incompatible ? branchNumber(incompatible[1]) : null,
  };
};

const selectTargets = (catalogue, branches, base, metadata) => {
  const parsed = branches.map(releaseBranch).filter(Boolean);
  const current = releaseBranch(base);
  // For non-release branches, use the product of the repo's release branches when
  // unambiguous. Otherwise default to Moodle, never invent a Workplace checkout.
  const products = new Set(parsed.map(branch => branch.product));
  if (!current && products.size > 1) throw new Error(`Cannot infer Moodle product for ${base}; release branches span multiple products`);
  const product = current?.product || (products.has('workplace') ? 'workplace' : 'moodle');
  const candidates = catalogue.filter(target => target.product === product);
  if (!candidates.length) throw new Error(`No applicable ${product} targets in the catalogue`);

  let selected = candidates;
  if (current) {
    if (!candidates.some(target => target.number === current.release)) {
      throw new Error(`Release branch ${base} has no ${product} target in the catalogue`);
    }
    const next = Math.min(Infinity, ...parsed
      .filter(branch => branch.product === product && branch.release > current.release)
      .map(branch => branch.release));
    selected = candidates.filter(target => target.number >= current.release && target.number < next);
  }

  selected = selected.filter(target =>
    (!metadata.supported || (target.number >= metadata.supported[0] && target.number <= metadata.supported[1])) &&
    (!metadata.incompatible || target.number < metadata.incompatible));
  if (current && !selected.some(target => target.number === current.release)) {
    throw new Error(`${base} is excluded by this revision's supported/incompatible version.php range`);
  }
  if (!current && selected.length) {
    // Development branches have no ownership range: test the newest compatible
    // target, not every historical version in the catalogue.
    selected = [selected.reduce((latest, target) => target.number > latest.number ? target : latest)];
  }
  return selected.sort((a, b) => a.number - b.number);
};

const buildRows = (targets, dbTypes, suites, dependencies, coreVersions, phpVersions = []) => {
  if (phpVersions.some(php => typeof php !== 'string' || !/^\d+\.\d+$/.test(php))) {
    throw new Error('PHP version filter must contain strings such as "8.4"');
  }
  const rows = [];
  for (const target of targets) {
    const coreVersion = coreVersions[`${target.repository}@${target.ref}`];
    if (!Number.isFinite(coreVersion)) throw new Error(`Missing core version for ${target.repository}@${target.ref}`);
    const phpForTarget = phpVersions.length ? [...new Set(phpVersions)].filter(php => target.php.includes(php)) : target.php;
    if (!phpForTarget.length) throw new Error(`No requested PHP version supports ${target.repository}@${target.ref} (allowed: ${target.php_min}–${target.php_max})`);
    for (const suite of suites) for (const php of phpForTarget) for (const dbtype of dbTypes) {
      if (suite === 'behat' && !['mysqli', 'pgsql'].includes(dbtype)) continue;
      rows.push({ suite, php, moodle: target.ref, moodle_repository: target.repository,
        os: 'ubuntu-latest', dbtype, experimental: false, dependencies });
    }
  }
  if (rows.length > 256) throw new Error(`Matrix has ${rows.length} rows (GitHub limit: 256); narrow the catalogue or database choices`);
  return rows;
};

// Preserve the existing input/variable Cartesian matrix when automatic is off.
const legacyRows = ({ phpVersions, moodleVersions, repositories, os, dbTypes, experimental, excludes, suites, dependencies }) => {
  const rows = [];
  const normalizedExcludes = excludes.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('MOODLE_EXCLUDE_MATRIX must contain objects');
    const normalized = { ...entry };
    if ('moodle_repos' in normalized && !('moodle_repository' in normalized)) {
      normalized.moodle_repository = normalized.moodle_repos;
      delete normalized.moodle_repos;
    }
    return normalized;
  });
  for (const suite of suites) for (const php of phpVersions) for (const moodle of moodleVersions) {
    for (const moodle_repository of repositories) for (const runner of os) for (const dbtype of dbTypes) {
      if (suite === 'behat' && !['mysqli', 'pgsql'].includes(dbtype)) continue;
      for (const flag of experimental) {
        const row = { suite, php, moodle, moodle_repository, os: runner, dbtype, experimental: flag, dependencies };
        if (!normalizedExcludes.some(exclude => Object.entries(exclude).every(([key, value]) => row[key] === value))) {
          rows.push(row);
        }
      }
    }
  }
  if (rows.length > 256) throw new Error(`Matrix has ${rows.length} rows (GitHub limit: 256)`);
  return { rows, description: `Legacy matrix: ${rows.length} row(s) from workflow inputs and/or org/repository variables` };
};

const resolve = async ({ github, appGithub, context, branch, dbTypes, suites, dependencies, phpVersions = [], cataloguePath, versionPath }) => {
  const catalogue = validateCatalogue(JSON.parse(fs.readFileSync(cataloguePath, 'utf8')));
  const metadata = readMetadata(fs.readFileSync(versionPath, 'utf8'));
  const { owner, repo } = context.repo;
  const branches = await github.paginate(github.rest.repos.listBranches, { owner, repo, per_page: 100 });
  const targets = selectTargets(catalogue, branches.map(item => item.name), branch, metadata);
  if (!targets.length) throw new Error(`No catalogue targets match ${branch} and plugin version.php`);
  const coreVersions = {};
  for (const target of targets) {
    const client = target.product === 'workplace' && appGithub ? appGithub : github;
    const [targetOwner, targetRepo] = target.repository.split('/');
    let response;
    try {
      response = await client.rest.repos.getContent({ owner: targetOwner, repo: targetRepo,
        path: target.version_file || 'version.php', ref: target.ref });
    } catch (error) {
      throw new Error(`Cannot read ${target.repository}@${target.ref}/${target.version_file || 'version.php'} (HTTP ${error.status || 'unknown'}). Check catalogue ref, version_file and private GitHub App Contents: Read access.`);
    }
    if (response.data.type !== 'file' || !response.data.content) throw new Error(`Invalid core version.php at ${target.repository}@${target.ref}`);
    const coreText = Buffer.from(response.data.content, 'base64').toString('utf8');
    const version = coreText.match(/\$version\s*=\s*(\d+)(?:\.\d+)?\s*;/);
    if (!version) throw new Error(`Cannot read core $version at ${target.repository}@${target.ref}`);
    coreVersions[`${target.repository}@${target.ref}`] = Number(version[1]);
  }
  const compatible = targets.filter(target => coreVersions[`${target.repository}@${target.ref}`] >= metadata.requires);
  if (!compatible.length) throw new Error(`No ${branch} catalogue targets meet plugin requires ${metadata.requires}`);
  if (releaseBranch(branch) && compatible.length !== targets.length) {
    throw new Error(`${branch} owns targets whose core version is below plugin requires ${metadata.requires}; update version.php or the catalogue`);
  }
  const rows = buildRows(compatible, dbTypes, suites, dependencies, coreVersions, phpVersions);
  return { targets: compatible, rows, metadata,
    description: compatible.map(t => `${t.product} ${t.release}: ${t.repository}@${t.ref} (PHP ${phpVersions.length ? phpVersions.filter(php => t.php.includes(php)).join(', ') : `${t.php_min}–${t.php_max}`})`).join('\n') };
};

module.exports = { releaseNumber, branchNumber, releaseBranch, phpRange, validateCatalogue, readMetadata, selectTargets, buildRows, legacyRows, resolve };
