// One login = one tenant folder under server/data/tenants/<user>/.
// Portfolio stuff (overrides, customs, sim saves) stays in there — shared pricing/auth/built-ins stay global.
// Boot: legacy shared JSON → admin snapshot → one-time clone to every existing user; after that, no cross-tenant sharing.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const TENANTS_ROOT = path.join(DATA_DIR, 'tenants');
const LEGACY_MARKER = path.join(TENANTS_ROOT, '.legacy-migrated');
const SEED_ALL_MARKER = path.join(TENANTS_ROOT, '.portfolio-seeded-all-users');

const TENANT_FILES = {
  overrides: 'app-overrides.json',
  customApps: 'custom-applications.json',
  removed: 'removed-applications.json',
  displayNames: 'app-display-names.json',
  simProjects: 'sim-projects.json',
};

const LEGACY_FILES = {
  overrides: path.join(DATA_DIR, 'app-overrides.json'),
  customApps: path.join(DATA_DIR, 'custom-applications.json'),
  removed: path.join(DATA_DIR, 'removed-applications.json'),
  displayNames: path.join(DATA_DIR, 'app-display-names.json'),
  simProjects: path.join(DATA_DIR, 'sim-projects.json'),
};

const EMPTY_DEFAULTS = {
  overrides: {},
  customApps: { applications: [] },
  removed: { ids: [] },
  displayNames: { overrides: {} },
  simProjects: { projects: [] },
};

function normalizeTenantId(username) {
  const id = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 48);
  if (!id || id === '.' || id === '..') {
    throw new Error('Invalid tenant id');
  }
  return id;
}

function tenantDir(username) {
  return path.join(TENANTS_ROOT, normalizeTenantId(username));
}

function tenantFile(username, fileKey) {
  const name = TENANT_FILES[fileKey];
  if (!name) throw new Error(`Unknown tenant file key: ${fileKey}`);
  return path.join(tenantDir(username), name);
}

function ensureTenant(username) {
  const dir = tenantDir(username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // New tenant dir — empty defaults unless they got the one-time seed clone.
  return dir;
}

function deleteTenantData(username) {
  const dir = tenantDir(username);
  if (!fs.existsSync(dir)) return { ok: true, deleted: false };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, deleted: true, tenantId: normalizeTenantId(username) };
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  const parent = path.dirname(dest);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function writeJson(file, data) {
  const parent = path.dirname(file);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function listAuthUsernames() {
  const authFile = path.join(DATA_DIR, 'admin-auth.json');
  try {
    if (!fs.existsSync(authFile)) return [];
    const raw = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const users = Array.isArray(raw.users) ? raw.users : raw.username ? [raw] : [];
    return users
      .map((u) => (u && u.username ? String(u.username).trim() : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Where to copy portfolio seed from: admin tenant dir, then legacy server/data, then *.pre-tenancy.bak
function resolveSnapshotSources(preferredTenant = 'admin') {
  const sources = {};
  const preferred = normalizeTenantId(preferredTenant);

  for (const key of Object.keys(TENANT_FILES)) {
    const fromPreferred = tenantFile(preferred, key);
    const fromLegacy = LEGACY_FILES[key];
    const fromBak = `${LEGACY_FILES[key]}.pre-tenancy.bak`;

    if (fs.existsSync(fromPreferred)) {
      sources[key] = fromPreferred;
    } else if (fs.existsSync(fromLegacy)) {
      sources[key] = fromLegacy;
    } else if (fs.existsSync(fromBak)) {
      sources[key] = fromBak;
    }
  }
  return sources;
}

// Chuck a full copy of portfolio JSON into a tenant — empty files if source missing.
function clonePortfolioIntoTenant(username, sources = {}) {
  const id = normalizeTenantId(username);
  ensureTenant(id);
  const written = [];

  for (const key of Object.keys(TENANT_FILES)) {
    const dest = tenantFile(id, key);
    const src = sources[key];
    if (src && fs.existsSync(src)) {
      copyIfExists(src, dest);
      written.push(key);
    } else {
      writeJson(dest, EMPTY_DEFAULTS[key] ?? {});
      written.push(`${key}:empty`);
    }
  }
  return { tenantId: id, written };
}

// One-time: shared pre-tenant JSON → admin folder; rename originals to *.pre-tenancy.bak
function migrateLegacySharedData(preferredTenant = 'admin') {
  if (fs.existsSync(LEGACY_MARKER)) return { migrated: false, reason: 'already-done' };
  if (!fs.existsSync(TENANTS_ROOT)) fs.mkdirSync(TENANTS_ROOT, { recursive: true });

  const hasLegacy = Object.values(LEGACY_FILES).some((f) => fs.existsSync(f));
  if (!hasLegacy) {
    writeJson(LEGACY_MARKER, {
      migratedAt: new Date().toISOString(),
      migrated: false,
      reason: 'no-legacy-files',
    });
    return { migrated: false, reason: 'no-legacy-files' };
  }

  const tenant = normalizeTenantId(preferredTenant);
  const sources = {};
  const copied = [];
  for (const [key, legacyPath] of Object.entries(LEGACY_FILES)) {
    if (!fs.existsSync(legacyPath)) continue;
    sources[key] = legacyPath;
    const dest = tenantFile(tenant, key);
    ensureTenant(tenant);
    fs.copyFileSync(legacyPath, dest);
    copied.push(key);
    try {
      fs.renameSync(legacyPath, `${legacyPath}.pre-tenancy.bak`);
    } catch {
      /* keep original if rename fails */
    }
  }

  writeJson(LEGACY_MARKER, {
    migratedAt: new Date().toISOString(),
    tenant,
    copied,
  });
  return { migrated: true, tenant, copied };
}

// One-time: same portfolio snapshot into every user already in auth — then marker so new users start fresh.
function seedSnapshotToAllExistingUsers(preferredTenant = 'admin') {
  if (fs.existsSync(SEED_ALL_MARKER)) {
    return { seeded: false, reason: 'already-done' };
  }
  if (!fs.existsSync(TENANTS_ROOT)) fs.mkdirSync(TENANTS_ROOT, { recursive: true });

  // Admin (or preferred) gets legacy files first
  migrateLegacySharedData(preferredTenant);

  const sources = resolveSnapshotSources(preferredTenant);
  const usernames = listAuthUsernames();
  if (!usernames.length) {
    usernames.push(preferredTenant);
  }

  const cloned = [];
  for (const name of usernames) {
    const result = clonePortfolioIntoTenant(name, sources);
    cloned.push(result.tenantId);
  }

  writeJson(SEED_ALL_MARKER, {
    seededAt: new Date().toISOString(),
    templateTenant: normalizeTenantId(preferredTenant),
    sourceKeys: Object.keys(sources),
    users: cloned,
    note: 'One-time portfolio + sim-project clone. All further changes are per-user only.',
  });

  return { seeded: true, users: cloned, sourceKeys: Object.keys(sources) };
}

// Idempotent tenancy migrations — safe on every boot
function ensureTenancyInitialized(preferredTenant = 'admin') {
  try {
    migrateLegacySharedData(preferredTenant);
  } catch (err) {
    console.warn('[tenantStore] legacy migration failed:', err.message);
  }
  try {
    return seedSnapshotToAllExistingUsers(preferredTenant);
  } catch (err) {
    console.warn('[tenantStore] seed-all-users failed:', err.message);
    return { seeded: false, error: err.message };
  }
}

// Wire up on require — local dev and prod boot
try {
  ensureTenancyInitialized('admin');
} catch (err) {
  console.warn('[tenantStore] init skipped:', err.message);
}

module.exports = {
  DATA_DIR,
  TENANTS_ROOT,
  TENANT_FILES,
  normalizeTenantId,
  tenantDir,
  tenantFile,
  ensureTenant,
  deleteTenantData,
  migrateLegacySharedData,
  seedSnapshotToAllExistingUsers,
  ensureTenancyInitialized,
  clonePortfolioIntoTenant,
  resolveSnapshotSources,
};
