#!/usr/bin/env node
// Bump semver everywhere in the monorepo — snoothdogg: run before you tag a release.
// Usage: node scripts/bump-version.js [patch|minor|major]

const path = require('path');
const { bumpProjectVersion, getProjectVersion } = require('../server/src/services/projectVersion');

const type = (process.argv[2] || 'patch').toLowerCase();

if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: node scripts/bump-version.js [patch|minor|major]');
  process.exit(1);
}

const before = getProjectVersion();
const { previous, current } = bumpProjectVersion(type);

console.log(`Cloud FinOps version: ${before} -> ${current} (${type})`);
console.log('Touched: package.json, server/package.json, client/package.json, package-lock.json');
