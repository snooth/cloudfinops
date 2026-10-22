// Export/import full system ZIP packs — version history + changelog on disk.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { ZipArchive } = require('archiver');
const AdmZip = require('adm-zip');
const { getSnapshotInfo } = require('./pricingSnapshot');
const { bumpProjectVersion, getProjectVersion } = require('./projectVersion');

const ROOT = path.join(__dirname, '../../..');
const DATA_DIR = path.join(ROOT, 'server/data');
const HISTORY_FILE = path.join(DATA_DIR, 'version-history.json');
const STAGING_DIR = path.join(DATA_DIR, 'staging');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const PACK_PATHS = [
  'server/src',
  'server/data/tenants',
  // legacy single-store files (pre-tenancy) still packed if present
  'server/data/custom-applications.json',
  'server/data/sim-projects.json',
  'server/data/removed-applications.json',
  'server/data/app-display-names.json',
  'server/data/runtime-config.json',
  'server/data/azure-pricing-snapshot.json',
  'server/data/pricing-update-history.json',
  'server/data/app-overrides.json',
  'client/dist',
  'client/src',
  'client/index.html',
  'client/vite.config.js',
  'client/package.json',
  'server/package.json',
  'package.json',
  'package-lock.json',
  'run.sh',
  '.env.example',
  'README.md',
  'CHANGELOG.md',
];

const IMPORTABLE_PREFIXES = [
  'server/src/',
  'server/data/',
  'client/dist/',
  'client/src/',
  'client/index.html',
  'client/vite.config.js',
  'client/package.json',
  'server/package.json',
  'package.json',
  'package-lock.json',
  'run.sh',
  '.env.example',
  'README.md',
  'CHANGELOG.md',
];

const WIPE_BEFORE_IMPORT = [
  'server/src',
  'client/dist',
  'client/src',
];

const BLOCKED_IMPORT = [
  'node_modules/',
  'server/data/backups/',
  'server/data/staging/',
  'server/data/version-history.json',
];

function ensureDirs() {
  [DATA_DIR, STAGING_DIR, BACKUP_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDirs();
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readRootPackage() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = getProjectVersion();
  return pkg;
}

function readChangelog() {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    return { raw: '', sections: [] };
  }
  const raw = fs.readFileSync(changelogPath, 'utf8');
  const sections = [];
  const blocks = raw.split(/^## \[/m).slice(1);
  for (const block of blocks) {
    const nl = block.indexOf('\n');
    const headerLine = nl >= 0 ? block.slice(0, nl) : block;
    const versionMatch = headerLine.match(/^([^\]]+)\]\s*-?\s*(.*)$/);
    if (!versionMatch) continue;
    const body = nl >= 0 ? block.slice(nl + 1).trim() : '';
    sections.push({
      version: versionMatch[1].trim(),
      date: versionMatch[2].trim() || null,
      body,
    });
  }
  return { raw, sections };
}

function loadHistory() {
  return readJson(HISTORY_FILE, { updates: [] });
}

function appendHistory(entry) {
  const history = loadHistory();
  history.updates.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  history.updates = history.updates.slice(0, 50);
  writeJson(HISTORY_FILE, history);
  return history;
}

function pathExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function buildManifest(version, notes) {
  return {
    name: 'cloud-finops',
    version,
    packagedAt: new Date().toISOString(),
    packagedFrom: os.hostname(),
    notes: notes || '',
    paths: PACK_PATHS.filter((p) => pathExists(p)),
  };
}

function addPathToArchive(archive, relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return;

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    archive.directory(abs, relPath);
  } else {
    archive.file(abs, { name: relPath });
  }
}

async function createSystemPackage({ notes, bump = true } = {}) {
  ensureDirs();
  const previousVersion = getProjectVersion();
  const version = bump
    ? bumpProjectVersion('patch').current
    : previousVersion;
  const manifest = buildManifest(version, notes);

  return new Promise((resolve, reject) => {
    const filename = `cloud-finops-v${version}-${Date.now()}.zip`;
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];

    archive.on('error', reject);
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => {
      appendHistory({
        action: 'export',
        version,
        previousVersion,
        filename,
        notes: notes || 'Full system export',
      });
      resolve({
        filename,
        buffer: Buffer.concat(chunks),
        manifest,
        previousVersion,
        version,
      });
    });

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    for (const rel of manifest.paths) {
      addPathToArchive(archive, rel);
    }
    archive.finalize();
  });
}

function isImportAllowed(entryName) {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  if (normalized === '.env' || normalized.startsWith('.env/')) return false;
  if (BLOCKED_IMPORT.some((b) => normalized === b || normalized.startsWith(b))) return false;
  if (normalized === 'manifest.json') return false;
  return IMPORTABLE_PREFIXES.some((prefix) => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix));
}

function getImportableZipEntries(zip) {
  return zip.getEntries().filter((e) => !e.isDirectory && isImportAllowed(e.entryName));
}

function getDirectoryRootsToReplace(entryNames) {
  return WIPE_BEFORE_IMPORT.filter((root) =>
    entryNames.some((name) => name === root || name.startsWith(`${root}/`))
  );
}

function applyZipEntries(zip) {
  const entries = getImportableZipEntries(zip);
  const entryNames = entries.map((e) => e.entryName.replace(/\\/g, '/'));

  for (const root of getDirectoryRootsToReplace(entryNames)) {
    removeIfExists(path.join(ROOT, root));
  }

  const applied = [];
  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/');
    const dest = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
    applied.push(rel);
  }

  return applied;
}

async function backupCurrentSystem() {
  ensureDirs();
  const pkg = readRootPackage();
  const backupName = `backup-v${pkg.version}-${Date.now()}.zip`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    const manifest = buildManifest(pkg.version, 'Pre-import automatic backup');
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    for (const rel of manifest.paths) {
      addPathToArchive(archive, rel);
    }
    archive.finalize();
  });

  return { backupName, backupPath };
}

function removeIfExists(absPath) {
  if (!fs.existsSync(absPath)) return;
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    fs.rmSync(absPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(absPath);
  }
}

function tryRebuildClient() {
  try {
    execSync('npm run build -w client', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { rebuilt: true };
  } catch (err) {
    return { rebuilt: false, error: err.stderr || err.message };
  }
}

async function importSystemPackage(buffer, { notes } = {}) {
  ensureDirs();
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty upload');
  }
  if (buffer.length > 150 * 1024 * 1024) {
    throw new Error('Package exceeds 150 MB limit');
  }

  const previousVersion = readRootPackage().version;
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Invalid ZIP file');
  }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    throw new Error('Package must contain manifest.json');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch {
    throw new Error('Invalid manifest.json');
  }

  if (!manifest.version) {
    throw new Error('manifest.json must include version');
  }

  const entries = getImportableZipEntries(zip);
  if (entries.length === 0) {
    throw new Error('No importable files found in package');
  }

  const backup = await backupCurrentSystem();
  const applied = applyZipEntries(zip);

  let rebuild = { rebuilt: false };
  if (applied.some((p) => p.startsWith('client/src') || p.startsWith('client/dist') || p === 'client/vite.config.js')) {
    rebuild = tryRebuildClient();
  }

  const requiresServerRestart = applied.some((p) => p.startsWith('server/src') || p === 'server/package.json');

  const newVersion = getProjectVersion();
  const changelog = readChangelog();

  appendHistory({
    action: 'import',
    version: manifest.version,
    previousVersion,
    newVersion,
    notes: notes || manifest.notes || 'Imported release package',
    appliedPaths: applied.length,
    backupFile: backup.backupName,
    rebuild,
    requiresServerRestart,
    manifest: {
      version: manifest.version,
      packagedAt: manifest.packagedAt,
    },
  });

  return {
    ok: true,
    previousVersion,
    version: manifest.version,
    installedVersion: newVersion,
    appliedCount: applied.length,
    applied,
    backupFile: backup.backupName,
    rebuild,
    requiresServerRestart,
    changelogSection: changelog.sections.find((s) => s.version === manifest.version) || null,
  };
}

function getVersionInfo() {
  const pkg = readRootPackage();
  const history = loadHistory();
  const changelog = readChangelog();
  const lastImport = history.updates.find((u) => u.action === 'import');
  const lastExport = history.updates.find((u) => u.action === 'export');

  return {
    current: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
    },
    changelog,
    history: history.updates,
    lastImport,
    lastExport,
    pricing: getSnapshotInfo(),
    backups: fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.zip')).sort().reverse().slice(0, 10)
      : [],
  };
}

module.exports = {
  getVersionInfo,
  createSystemPackage,
  importSystemPackage,
  readChangelog,
};
