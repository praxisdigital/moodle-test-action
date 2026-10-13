'use strict';

const fs = require('node:fs');
const YAML = require('yaml');

// Only values of the caller job are needed; never evaluate PR-provided Actions expressions.
const parsePrWorkflow = text => {
  const workflow = YAML.parse(text, { uniqueKeys: true, maxAliasCount: 0 });
  if (!workflow || typeof workflow !== 'object' || !workflow.jobs || typeof workflow.jobs !== 'object') {
    throw new Error('PR .github/workflows/ci.yml must define jobs');
  }
  const calls = Object.values(workflow.jobs).filter(job =>
    typeof job?.uses === 'string' &&
    /^praxisdigital\/moodle-test-action\/\.github\/workflows\/ci\.yml@[^\s]+$/i.test(job.uses));
  if (calls.length !== 1) throw new Error(`Expected exactly one moodle-test-action reusable workflow job in PR ci.yml; found ${calls.length}`);
  const values = calls[0].with || {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('PR ci.yml job with: must be a mapping of literal input values');
  }
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || !['string', 'boolean', 'number'].includes(typeof value)) {
      throw new Error(`PR ci.yml with.${key} must be a literal string, boolean or number`);
    }
    if (String(value).includes('${{')) {
      throw new Error(`PR ci.yml with.${key} uses an Actions expression; #behat cannot evaluate PR workflow expressions`);
    }
    result[key] = String(value);
  }
  return result;
};

const readPrWorkflow = file => {
  if (!fs.existsSync(file)) throw new Error(`PR merge commit does not contain ${file}; #behat needs the PR's ci.yml`);
  return parsePrWorkflow(fs.readFileSync(file, 'utf8'));
};

const parseList = (name, raw, fallback) => {
  if (!raw) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`PR ci.yml ${name} must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(parsed) || (!parsed.length && name !== 'exclude_matrix')) {
    throw new Error(`PR ci.yml ${name} must be a ${name === 'exclude_matrix' ? '' : 'non-empty '}JSON array`);
  }
  return parsed;
};

const parseDependencies = raw => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return [...new Set(parsed.map(entry => String(entry).trim()).filter(Boolean))].join(' ');
  } catch (error) {
    const matches = raw.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[^\s"',\]]+/g);
    if (!matches) throw new Error('PR ci.yml dependencies must be a JSON array or org/repo@ref list');
    return [...new Set(matches)].join(' ');
  }
};

const resolvePrConfig = (pr, vars = {}, defaultOrg = '') => {
  if (pr.org && pr.org !== defaultOrg) {
    throw new Error('PR ci.yml with.org differs from the default-branch caller; #behat cannot change the GitHub App owner after setup');
  }
  const value = (name, varName = '') => pr[name] !== undefined ? pr[name] : (vars[varName] || '');
  const automatic = value('automatic') || 'true';
  if (!['true', 'false'].includes(automatic)) throw new Error("PR ci.yml automatic must be 'true' or 'false'");
  const enabled = automatic === 'true';
  const php = enabled ? value('php_versions') : value('php_versions', 'php_versions');
  const config = {
    automatic,
    products: value('products'),
    php_versions: parseList('php_versions', php, enabled ? [] : ['8.4']),
    moodle_versions: enabled ? [] : parseList('moodle_versions', value('moodle_versions', 'moodle_versions'), ['MOODLE_502_STABLE']),
    moodle_repositories: enabled ? [] : parseList('moodle_repositories', value('moodle_repositories', 'moodle_repositories'), ['moodle/moodle']),
    os: enabled ? [] : parseList('os', value('os', 'os'), ['ubuntu-latest']),
    experimental: enabled ? [] : parseList('experimental', value('experimental', 'experimental'), [false]),
    exclude_matrix: enabled ? [] : parseList('exclude_matrix', value('exclude_matrix', 'exclude_matrix'), []),
    db_types: parseList('db_types', value('db_types', 'db_types'), ['mysqli']),
    dependencies: parseDependencies(value('dependencies', 'dependencies')),
    run_behat: value('run_behat') || 'true',
    additional_behat_arguments: value('additional_behat_arguments', 'additional_behat_arguments'),
    behat_increase_timeout: value('behat_increase_timeout') || '2',
    behat_step_timeout_minutes: value('behat_step_timeout_minutes') || '45',
    post_no_tests_comment: value('post_no_tests_comment') || 'true',
  };
  if (!['true', 'false'].includes(config.run_behat) ||
      !['true', 'false'].includes(config.post_no_tests_comment)) {
    throw new Error('PR ci.yml run_behat and post_no_tests_comment must be true or false');
  }
  if (config.db_types.some(db => !['mysqli', 'pgsql', 'sqlsrv'].includes(db))) {
    throw new Error('PR ci.yml db_types must contain only mysqli, pgsql or sqlsrv');
  }
  return config;
};

module.exports = { parsePrWorkflow, readPrWorkflow, resolvePrConfig };
