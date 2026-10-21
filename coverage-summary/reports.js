'use strict';

const fs = require('node:fs');
const path = require('node:path');

function relativeName(name, pluginPath) {
  if (typeof name !== 'string' || typeof pluginPath !== 'string') return '';
  const plugin = pluginPath.replace(/^\/+|\/+$/g, '').replace(/^public\//, '');
  if (!plugin || plugin.split('/').some(part => !part || part === '.' || part === '..')) return '';
  const index = name.indexOf('/moodle/');
  let relative = (index >= 0 ? name.slice(index + 8) : name).replace(/^public\//, '');
  if (!relative.startsWith(`${plugin}/`)) return '';
  relative = relative.slice(plugin.length + 1);
  return relative.split('/').some(part => !part || part === '.' || part === '..') ? '' : relative;
}

// Used for both archive selection and final merging. An ineligible artifact never
// contributes files or counts, even if another artifact in the run is usable.
function parseReport(metadataText, linesText) {
  const metadata = JSON.parse(metadataText);
  const report = JSON.parse(linesText);
  if (!metadata || !report || report.version !== 1 || !report.files || Array.isArray(report.files)) {
    throw new Error('Unsupported executable-line report');
  }
  const files = {};
  let total = 0;
  for (const [absolute, lines] of Object.entries(report.files)) {
    const name = relativeName(absolute, metadata.pluginPath);
    if (!name) continue;
    if (!lines || typeof lines !== 'object' || Array.isArray(lines)) throw new Error('Invalid line map');
    for (const [number, covered] of Object.entries(lines)) {
      if (!/^[1-9]\d*$/.test(number) || typeof covered !== 'boolean') throw new Error('Invalid executable line');
      files[name] ??= {};
      files[name][number] = (files[name][number] || covered);
      total++;
    }
  }
  if (!total) throw new Error('No executable plugin lines found; check line reports and plugin-path metadata.');
  return files;
}

function findReports(dir) {
  if (!fs.existsSync(dir)) return [];
  return [...new Set(fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? findReports(file)
      : ['lines.json', 'metadata.json', 'clover.xml'].includes(entry.name) ? [path.join(dir, 'lines.json')] : [];
  }))].sort();
}

function mergeReports(reports, warning = () => {}) {
  const lines = {};
  let artifactCount = 0;
  const targets = [];
  const rejected = [];
  for (const file of reports) {
    const target = path.basename(path.dirname(file));
    try {
      if (targets.includes(target)) throw new Error('Duplicate coverage target');
      const files = parseReport(fs.readFileSync(path.join(path.dirname(file), 'metadata.json'), 'utf8'), fs.readFileSync(file, 'utf8'));
      for (const [name, coverage] of Object.entries(files)) {
        lines[name] ??= {};
        for (const [number, covered] of Object.entries(coverage)) lines[name][number] = lines[name][number] || covered;
      }
      artifactCount++;
      targets.push(target);
    } catch (error) {
      rejected.push({target, reason: error.message});
      warning(`Skipping unusable coverage report ${file}: ${error.message}`);
    }
  }
  const result = {files: {}, artifactCount, targets: targets.sort(), rejected, total: 0, covered: 0};
  for (const [name, coverage] of Object.entries(lines)) {
    const total = Object.keys(coverage).length;
    const covered = Object.values(coverage).filter(Boolean).length;
    result.files[name] = {total, covered, percent: covered / total * 100};
    result.total += total;
    result.covered += covered;
  }
  result.percent = result.total ? result.covered / result.total * 100 : null;
  return result;
}

function comparisonIssues(base, pr) {
  const issues = [];
  for (const [label, side, other] of [['PR', pr, base], ['Base', base, pr]]) {
    const missing = other.targets.filter(target => !side.targets.includes(target));
    if (missing.length) issues.push(`${label} missing usable targets: ${missing.join(', ')}`);
    for (const {target, reason} of side.rejected) issues.push(`${label} rejected target ${target}: ${reason}`);
    if (!side.targets.length) issues.push(`${label} has no usable coverage targets.`);
  }
  return issues;
}

module.exports = {parseReport, findReports, mergeReports, relativeName, comparisonIssues};
