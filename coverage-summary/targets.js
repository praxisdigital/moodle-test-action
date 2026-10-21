'use strict';

function targetName(row) {
  const keys = ['moodle', 'php', 'dbtype', 'os', 'moodle_repository'];
  for (const key of keys) {
    if (typeof row[key] !== 'string' || !row[key]) throw new Error(`Missing coverage target dimension: ${key}`);
  }
  // Encoding each dimension independently avoids collisions caused by sanitizing slashes.
  const experimental = row.experimental ?? false;
  if (![true, false, 'true', 'false'].includes(experimental)) throw new Error('Invalid experimental coverage dimension');
  return `coverage-target-${keys.map(key => encodeURIComponent(row[key])).join('--')}--experimental-${String(experimental)}`;
}

function expectedTargets(rows) {
  const targets = rows.filter(row => row.suite === 'phpunit').map(targetName);
  if (new Set(targets).size !== targets.length) throw new Error('Duplicate expected PHPUnit coverage target');
  return {version: 1, targets: targets.sort()};
}

module.exports = {targetName, expectedTargets};
