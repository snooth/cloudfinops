// One semver across root/server/client package.json — bump script uses this.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');

const VERSION_FILES = [
  'package.json',
  'server/package.json',
  'client/package.json',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseVersion(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

function bumpSemver(version, type = 'patch') {
  const parts = parseVersion(version);
  if (type === 'major') {
    parts.major += 1;
    parts.minor = 0;
    parts.patch = 0;
  } else if (type === 'minor') {
    parts.minor += 1;
    parts.patch = 0;
  } else if (type === 'patch') {
    parts.patch += 1;
  } else {
    throw new Error(`Unknown bump type: ${type}`);
  }
  return formatVersion(parts);
}

function getProjectVersion() {
  const pkg = readJson(path.join(ROOT, 'package.json'));
  return pkg.version;
}

function setProjectVersion(version) {
  parseVersion(version);

  for (const rel of VERSION_FILES) {
    const filePath = path.join(ROOT, rel);
    const pkg = readJson(filePath);
    pkg.version = version;
    writeJson(filePath, pkg);
  }

  const lockPath = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages?.['']) {
      lock.packages[''].version = version;
    }
    writeJson(lockPath, lock);
  }

  return version;
}

function bumpProjectVersion(type = 'patch') {
  const current = getProjectVersion();
  const next = bumpSemver(current, type);
  setProjectVersion(next);
  return { previous: current, current: next };
}

module.exports = {
  bumpSemver,
  bumpProjectVersion,
  getProjectVersion,
  setProjectVersion,
};
