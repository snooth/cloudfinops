// Portal auth — scrypt passwords, server sessions. Default admin/password until first login (then change it).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_FILE = path.join(__dirname, '../../data/admin-auth.json');
const COOKIE_NAME = 'cf_admin_session';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'password';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

// Roles you pick when creating/editing users
const ROLE_DEFS = [
  {
    id: 'admin',
    label: 'Admin',
    description: 'Full access — portal, configuration, software version, and user management',
  },
  {
    id: 'operator',
    label: 'Operator',
    description: 'Portal plus configuration and software version (no user management)',
  },
  {
    id: 'user',
    label: 'User',
    description: 'Portal only — dashboard, applications, cost drivers, and simulate',
  },
];
const ROLE_IDS = new Set(ROLE_DEFS.map((r) => r.id));
const ROLE_PERMISSIONS = {
  admin: new Set(['portal', 'config', 'version', 'users', 'adminUi']),
  operator: new Set(['portal', 'config', 'version', 'adminUi']),
  user: new Set(['portal']),
};

function listRoles() {
  return ROLE_DEFS.map((r) => ({ ...r }));
}

function normalizeRole(role) {
  const id = String(role || 'user').trim().toLowerCase();
  return ROLE_IDS.has(id) ? id : 'user';
}

function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[normalizeRole(role)];
  return Boolean(perms && perms.has(permission));
}

/** @type {Map<string, { username: string, expires: number }>} */
const sessions = new Map();
const SESSIONS_FILE = path.join(path.dirname(AUTH_FILE), 'sessions.json');
let sessionsPersistTimer = null;

function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const list = Array.isArray(raw?.sessions) ? raw.sessions : [];
    const now = Date.now();
    for (const row of list) {
      if (!row?.id || !row?.username || !row?.expires) continue;
      if (Number(row.expires) <= now) continue;
      sessions.set(String(row.id), {
        username: String(row.username),
        expires: Number(row.expires),
      });
    }
  } catch (err) {
    console.warn('[adminAuth] could not load sessions:', err.message);
  }
}

function persistSessionsToDisk() {
  try {
    ensureDataDir();
    const now = Date.now();
    const list = [];
    for (const [id, session] of sessions) {
      if (!session || session.expires <= now) {
        sessions.delete(id);
        continue;
      }
      list.push({ id, username: session.username, expires: session.expires });
    }
    fs.writeFileSync(
      SESSIONS_FILE,
      `${JSON.stringify({ version: 1, sessions: list, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 }
    );
  } catch (err) {
    console.warn('[adminAuth] could not persist sessions:', err.message);
  }
}

function schedulePersistSessions() {
  if (sessionsPersistTimer) return;
  sessionsPersistTimer = setTimeout(() => {
    sessionsPersistTimer = null;
    persistSessionsToDisk();
  }, 250);
}

loadSessionsFromDisk();

function ensureDataDir() {
  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT_PARAMS).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}

function normalizeDisplayName(value) {
  if (value == null) return '';
  const name = String(value).trim().replace(/\s+/g, ' ');
  if (name.length > 80) {
    const err = new Error('Name must be 80 characters or less');
    err.status = 400;
    throw err;
  }
  return name;
}

function normalizeUser(raw) {
  if (!raw || !raw.username) return null;
  const salt = raw.salt || raw.passwordSalt;
  // Legacy accounts without a role were full admins
  const role = raw.role != null ? normalizeRole(raw.role) : 'admin';
  let displayName = '';
  try {
    displayName = normalizeDisplayName(raw.displayName ?? raw.name ?? '');
  } catch {
    displayName = String(raw.displayName || raw.name || '').trim().slice(0, 80);
  }
  const passwordPlain =
    raw.passwordPlain != null && String(raw.passwordPlain).length
      ? String(raw.passwordPlain)
      : null;
  return {
    username: String(raw.username).trim(),
    displayName,
    salt,
    passwordHash: raw.passwordHash,
    passwordPlain,
    role,
    mustChangePassword: Boolean(raw.mustChangePassword),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  };
}

function publicUser(user) {
  const role = normalizeRole(user.role);
  const def = ROLE_DEFS.find((r) => r.id === role);
  const displayName = user.displayName || '';
  return {
    username: user.username,
    displayName,
    name: displayName, // alias
    role,
    roleLabel: def?.label || role,
    mustChangePassword: Boolean(user.mustChangePassword),
    // Plain password copy for admin UI only — file is 0600, not in git; don't leak it.
    password: user.passwordPlain || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// Old single-user auth file → multi-user store
function migrateStore(raw) {
  if (!raw) return null;
  if (Array.isArray(raw.users)) {
    return {
      version: 2,
      users: raw.users.map(normalizeUser).filter(Boolean),
    };
  }
  // v1 single user object
  if (raw.username && (raw.passwordHash || raw.salt || raw.passwordSalt)) {
    const user = normalizeUser(raw);
    return { version: 2, users: user ? [user] : [] };
  }
  return null;
}

function readStore() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      return migrateStore(raw);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ version: 2, users: store.users }, null, 2),
    { mode: 0o600 }
  );
}

function findUser(store, username) {
  const key = String(username || '').trim().toLowerCase();
  return store.users.find((u) => u.username.toLowerCase() === key) || null;
}

function ensureDefaultAdmin() {
  let store = readStore();
  if (store && store.users.length > 0) {
    // persist migration if needed
    if (!store.users.every((u) => u.salt && u.passwordHash)) return;
    const onDisk = fs.existsSync(AUTH_FILE)
      ? JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))
      : null;
    if (onDisk && !Array.isArray(onDisk.users)) {
      writeStore(store);
    }
    try {
      const { ensureTenancyInitialized, ensureTenant } = require('./tenantStore');
      // One-time: clone portfolio + Simulate saves to every account that already exists.
      ensureTenancyInitialized('admin');
      for (const u of store.users) {
        if (u?.username) ensureTenant(u.username);
      }
    } catch {
      /* non-fatal */
    }
    return;
  }
  const { salt, hash } = hashPassword(DEFAULT_PASSWORD);
  const now = new Date().toISOString();
  store = {
    version: 2,
    users: [
      {
        username: DEFAULT_USERNAME,
        salt,
        passwordHash: hash,
        passwordPlain: DEFAULT_PASSWORD,
        role: 'admin',
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  writeStore(store);
  try {
    const { ensureTenancyInitialized, ensureTenant } = require('./tenantStore');
    ensureTenant(DEFAULT_USERNAME);
    ensureTenancyInitialized(DEFAULT_USERNAME);
  } catch {
    /* non-fatal */
  }
}

function purgeExpiredSessions() {
  const now = Date.now();
  let removed = false;
  for (const [id, session] of sessions) {
    if (session.expires <= now) {
      sessions.delete(id);
      removed = true;
    }
  }
  if (removed) schedulePersistSessions();
}

function revokeSessionsForUser(username) {
  const key = String(username || '').toLowerCase();
  let removed = false;
  for (const [id, session] of sessions) {
    if (session.username.toLowerCase() === key) {
      sessions.delete(id);
      removed = true;
    }
  }
  if (removed) schedulePersistSessions();
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      acc[key] = decodeURIComponent(val);
    } catch {
      acc[key] = val;
    }
    return acc;
  }, {});
}

function sessionCookieOptions(maxAgeMs, { secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (maxAgeMs > 0) {
    parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  } else {
    parts.push('Max-Age=0');
  }
  return parts;
}

function isSecureRequest(req) {
  if (process.env.COOKIE_SECURE === 'true' || process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === 'false' || process.env.COOKIE_SECURE === '0') return false;
  const xf = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  if (xf === 'https') return true;
  return Boolean(req?.secure);
}

function setSessionCookie(res, sessionId, req) {
  const base = sessionCookieOptions(SESSION_TTL_MS, { secure: isSecureRequest(req) });
  base[0] = `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`;
  res.append('Set-Cookie', base.join('; '));
}

function clearSessionCookie(res, req) {
  const base = sessionCookieOptions(0, { secure: isSecureRequest(req) });
  base[0] = `${COOKIE_NAME}=`;
  res.append('Set-Cookie', base.join('; '));
}

function getSessionFromRequest(req) {
  purgeExpiredSessions();
  const cookies = parseCookies(req);
  const id = cookies[COOKIE_NAME];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expires <= Date.now()) {
    sessions.delete(id);
    schedulePersistSessions();
    return null;
  }
  session.expires = Date.now() + SESSION_TTL_MS;
  schedulePersistSessions();
  return { id, ...session };
}

function getAuthStatus(req) {
  ensureDefaultAdmin();
  const store = readStore();
  const session = getSessionFromRequest(req);
  if (!session) {
    return { authenticated: false, mustChangePassword: false, username: null, role: null };
  }
  const user = findUser(store, session.username);
  if (!user) {
    sessions.delete(session.id);
    return { authenticated: false, mustChangePassword: false, username: null, role: null };
  }
  return {
    authenticated: true,
    username: user.username,
    displayName: user.displayName || '',
    name: user.displayName || '',
    role: normalizeRole(user.role),
    roleLabel: ROLE_DEFS.find((r) => r.id === normalizeRole(user.role))?.label,
    permissions: [...(ROLE_PERMISSIONS[normalizeRole(user.role)] || [])],
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

function login(username, password) {
  ensureDefaultAdmin();
  const store = readStore();
  const user = findUser(store, username);
  const passOk = user && verifyPassword(password, user.salt, user.passwordHash);
  if (!passOk) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    username: user.username,
    expires: Date.now() + SESSION_TTL_MS,
  });
  schedulePersistSessions();
  return {
    sessionId,
    username: user.username,
    displayName: user.displayName || '',
    name: user.displayName || '',
    role: normalizeRole(user.role),
    roleLabel: ROLE_DEFS.find((r) => r.id === normalizeRole(user.role))?.label,
    permissions: [...(ROLE_PERMISSIONS[normalizeRole(user.role)] || [])],
    mustChangePassword: Boolean(user.mustChangePassword),
    authenticated: true,
    ok: true,
  };
}

function logout(req, res) {
  const session = getSessionFromRequest(req);
  if (session) {
    sessions.delete(session.id);
    schedulePersistSessions();
  }
  clearSessionCookie(res, req);
}

function changePassword(req, currentPassword, newPassword) {
  ensureDefaultAdmin();
  const session = getSessionFromRequest(req);
  if (!session) {
    const err = new Error('Not authenticated');
    err.status = 401;
    throw err;
  }
  if (!newPassword || !String(newPassword).length) {
    const err = new Error('Password is required');
    err.status = 400;
    throw err;
  }
  if (String(newPassword) === DEFAULT_PASSWORD) {
    const err = new Error('Choose a password other than the default');
    err.status = 400;
    throw err;
  }
  const store = readStore();
  const user = findUser(store, session.username);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (!verifyPassword(currentPassword, user.salt, user.passwordHash)) {
    const err = new Error('Current password is incorrect');
    err.status = 401;
    throw err;
  }
  const { salt, hash } = hashPassword(String(newPassword));
  user.salt = salt;
  user.passwordHash = hash;
  user.passwordPlain = String(newPassword);
  user.mustChangePassword = false;
  user.updatedAt = new Date().toISOString();
  writeStore(store);
  return { ok: true, mustChangePassword: false };
}

function listUsers() {
  ensureDefaultAdmin();
  const store = readStore();
  return {
    roles: listRoles(),
    users: store.users
      .map(publicUser)
      .sort((a, b) => a.username.localeCompare(b.username)),
  };
}

function createUser({ username, password, mustChangePassword = true, role = 'user', displayName, name } = {}) {
  ensureDefaultAdmin();
  const uname = String(username || '').trim();
  if (!USERNAME_RE.test(uname)) {
    const err = new Error(
      'Username must be 3–32 characters: letters, numbers, dots, underscores, or hyphens'
    );
    err.status = 400;
    throw err;
  }
  if (!password || !String(password).length) {
    const err = new Error('Password is required');
    err.status = 400;
    throw err;
  }
  const rawRole = String(role || 'user').trim().toLowerCase();
  if (!ROLE_IDS.has(rawRole)) {
    const err = new Error(`Invalid role. Choose one of: ${[...ROLE_IDS].join(', ')}`);
    err.status = 400;
    throw err;
  }
  const cleanName = normalizeDisplayName(displayName ?? name ?? '');
  const store = readStore();
  if (findUser(store, uname)) {
    const err = new Error('Username already exists');
    err.status = 409;
    throw err;
  }
  const { salt, hash } = hashPassword(String(password));
  const now = new Date().toISOString();
  const user = {
    username: uname,
    displayName: cleanName,
    salt,
    passwordHash: hash,
    passwordPlain: String(password),
    role: rawRole,
    mustChangePassword: Boolean(mustChangePassword),
    createdAt: now,
    updatedAt: now,
  };
  store.users.push(user);
  writeStore(store);
  try {
    const { ensureTenant } = require('./tenantStore');
    // New users after the seed get a clean tenant dir — empty portfolio.
    ensureTenant(user.username);
  } catch (err) {
    console.warn('[adminAuth] ensureTenant failed:', err.message);
  }
  return publicUser(user);
}

function updateUserRole(req, username, role) {
  return updateUser(req, username, { role });
}

// Patch display name, role, must-change-password flag
function updateUser(req, username, fields = {}) {
  ensureDefaultAdmin();
  const store = readStore();
  const target = findUser(store, username);
  if (!target) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  let changed = false;

  if (fields.role !== undefined) {
    const rawRole = String(fields.role || '').trim().toLowerCase();
    if (!ROLE_IDS.has(rawRole)) {
      const err = new Error(`Invalid role. Choose one of: ${[...ROLE_IDS].join(', ')}`);
      err.status = 400;
      throw err;
    }
    const previous = normalizeRole(target.role);
    if (previous === 'admin' && rawRole !== 'admin') {
      const adminCount = store.users.filter((u) => normalizeRole(u.role) === 'admin').length;
      if (adminCount <= 1) {
        const err = new Error('Cannot demote the last admin user');
        err.status = 400;
        throw err;
      }
    }
    if (target.role !== rawRole) {
      target.role = rawRole;
      changed = true;
    }
  }

  if (fields.displayName !== undefined || fields.name !== undefined) {
    const cleanName = normalizeDisplayName(fields.displayName ?? fields.name ?? '');
    if ((target.displayName || '') !== cleanName) {
      target.displayName = cleanName;
      changed = true;
    }
  }

  if (fields.mustChangePassword !== undefined) {
    const next = Boolean(fields.mustChangePassword);
    if (Boolean(target.mustChangePassword) !== next) {
      target.mustChangePassword = next;
      changed = true;
    }
  }

  if (
    !changed
    && fields.role === undefined
    && fields.displayName === undefined
    && fields.name === undefined
    && fields.mustChangePassword === undefined
  ) {
    const err = new Error('Provide name, role, and/or mustChangePassword to update');
    err.status = 400;
    throw err;
  }

  if (changed) {
    target.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  return publicUser(target);
}

function deleteUser(req, username) {
  ensureDefaultAdmin();
  const session = getSessionFromRequest(req);
  const store = readStore();
  const target = findUser(store, username);
  if (!target) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (session && target.username.toLowerCase() === session.username.toLowerCase()) {
    const err = new Error('You cannot delete your own account while signed in');
    err.status = 400;
    throw err;
  }
  if (normalizeRole(target.role) === 'admin') {
    const adminCount = store.users.filter((u) => normalizeRole(u.role) === 'admin').length;
    if (adminCount <= 1) {
      const err = new Error('Cannot delete the last admin user');
      err.status = 400;
      throw err;
    }
  }
  if (store.users.length <= 1) {
    const err = new Error('Cannot delete the last user');
    err.status = 400;
    throw err;
  }
  store.users = store.users.filter(
    (u) => u.username.toLowerCase() !== target.username.toLowerCase()
  );
  writeStore(store);
  revokeSessionsForUser(target.username);
  try {
    const { deleteTenantData } = require('./tenantStore');
    deleteTenantData(target.username);
  } catch (err) {
    console.warn('[adminAuth] deleteTenantData failed:', err.message);
  }
  return { ok: true, deleted: target.username };
}

function resetUserPassword(username, newPassword, { mustChangePassword = true } = {}) {
  ensureDefaultAdmin();
  if (!newPassword || !String(newPassword).length) {
    const err = new Error('Password is required');
    err.status = 400;
    throw err;
  }
  const store = readStore();
  const user = findUser(store, username);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const { salt, hash } = hashPassword(String(newPassword));
  user.salt = salt;
  user.passwordHash = hash;
  user.passwordPlain = String(newPassword);
  user.mustChangePassword = Boolean(mustChangePassword);
  user.updatedAt = new Date().toISOString();
  writeStore(store);
  revokeSessionsForUser(user.username);
  return publicUser(user);
}

// Must be logged in (password-change endpoints still OK)
function requireAdminSession(req, res, next) {
  ensureDefaultAdmin();
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.admin = session;
  next();
}

function resolveAuthedUser(req) {
  ensureDefaultAdmin();
  const session = getSessionFromRequest(req);
  if (!session) return null;
  const store = readStore();
  const user = findUser(store, session.username);
  if (!user) {
    sessions.delete(session.id);
    return null;
  }
  return { session, user, store };
}

// Logged in, password changed if required, and role has the permission (portal/config/version/users/adminUi)
function requirePermission(permission) {
  return (req, res, next) => {
    const ctx = resolveAuthedUser(req);
    if (!ctx) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (ctx.user.mustChangePassword) {
      return res.status(403).json({
        error: 'Password change required before accessing admin features',
        mustChangePassword: true,
      });
    }
    if (!roleHasPermission(ctx.user.role, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    req.admin = ctx.session;
    req.authUser = publicUser(ctx.user);
    next();
  };
}

// Config + pricing admin (admin or operator)
function requireAdmin(req, res, next) {
  return requirePermission('config')(req, res, next);
}

// User CRUD — admin only
function requireUsersAdmin(req, res, next) {
  return requirePermission('users')(req, res, next);
}

ensureDefaultAdmin();

module.exports = {
  COOKIE_NAME,
  DEFAULT_USERNAME,
  ROLE_DEFS,
  listRoles,
  normalizeRole,
  roleHasPermission,
  getAuthStatus,
  login,
  logout,
  changePassword,
  listUsers,
  createUser,
  updateUserRole,
  updateUser,
  deleteUser,
  resetUserPassword,
  setSessionCookie,
  clearSessionCookie,
  requireAdminSession,
  requireAdmin,
  requireUsersAdmin,
  requirePermission,
  AUTH_FILE,
};
