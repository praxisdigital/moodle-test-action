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
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? findReports(file) : entry.name === 'lines.json' ? [file] : [];
  }).sort();
}

function mergeReports(reports, warning = () => {}) {
  const lines = {};
  let artifactCount = 0;
  for (const file of reports) {
    try {
      const files = parseReport(fs.readFileSync(path.join(path.dirname(file), 'metadata.json'), 'utf8'), fs.readFileSync(file, 'utf8'));
      for (const [name, coverage] of Object.entries(files)) {
        lines[name] ??= {};
        for (const [number, covered] of Object.entries(coverage)) lines[name][number] = lines[name][number] || covered;
      }
      artifactCount++;
    } catch (error) {
      warning(`Skipping unusable coverage report ${file}: ${error.message}`);
    }
  }
  const result = {files: {}, artifactCount, total: 0, covered: 0};
  for (const [name, coverage] of Object.entries(lines)) {
    const total = Object.keys(coverage).length;
    const covered = Object.values(coverage).filter(Boolean).length;
    result.files[name] = {total, covered, percent: covered / total * 100};
    result.total += total;
    result.covered += covered;
  }
  if (!result.total) throw new Error('No executable plugin lines found in usable reports.');
  result.percent = result.covered / result.total * 100;
  return result;
}

module.exports = {parseReport, findReports, mergeReports, relativeName};
