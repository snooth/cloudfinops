// Rename/describe apps in the UI without touching stable app ids — per tenant.

const fs = require('fs');
const path = require('path');
const { ensureTenant, tenantFile } = require('./tenantStore');

function storeFile(tenantId) {
  ensureTenant(tenantId);
  return tenantFile(tenantId, 'displayNames');
}

function ensureStore(tenantId) {
  const file = storeFile(tenantId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ overrides: {} }, null, 2));
  }
  return file;
}

function normalizeStore(raw) {
  const overrides = {};
  if (raw && raw.overrides && typeof raw.overrides === 'object') {
    for (const [id, val] of Object.entries(raw.overrides)) {
      if (val == null) continue;
      if (typeof val === 'string') {
        overrides[id] = { name: val };
      } else if (typeof val === 'object') {
        const entry = {};
        if (val.name != null && String(val.name).trim()) entry.name = String(val.name).trim();
        if (val.description != null) entry.description = String(val.description);
        if (Object.keys(entry).length) overrides[id] = entry;
      }
    }
  }
  if (raw && raw.names && typeof raw.names === 'object') {
    for (const [id, name] of Object.entries(raw.names)) {
      if (name == null || !String(name).trim()) continue;
      overrides[id] = { ...(overrides[id] || {}), name: String(name).trim() };
    }
  }
  return overrides;
}

function readOverrides(tenantId) {
  ensureStore(tenantId);
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(tenantId), 'utf8'));
    return normalizeStore(data);
  } catch {
    return {};
  }
}

function writeOverrides(tenantId, overrides) {
  ensureStore(tenantId);
  fs.writeFileSync(
    storeFile(tenantId),
    JSON.stringify({ overrides, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function getDisplayOverride(tenantId, appId) {
  const overrides = readOverrides(tenantId);
  return overrides[appId] || null;
}

function getDisplayName(tenantId, appId) {
  return getDisplayOverride(tenantId, appId)?.name || null;
}

function setDisplayFields(tenantId, appId, { name, description } = {}) {
  if (!appId) throw new Error('Application id is required');
  const overrides = readOverrides(tenantId);
  const current = { ...(overrides[appId] || {}) };

  if (name !== undefined) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Name is required');
    if (clean.length > 120) throw new Error('Name must be 120 characters or less');
    current.name = clean;
  }

  if (description !== undefined) {
    const clean = String(description ?? '');
    if (clean.length > 500) throw new Error('Description must be 500 characters or less');
    if (clean.trim()) current.description = clean.trim();
    else delete current.description;
  }

  if (!Object.keys(current).length) {
    delete overrides[appId];
  } else {
    overrides[appId] = current;
  }
  writeOverrides(tenantId, overrides);
  return current;
}

function setDisplayName(tenantId, appId, name) {
  const fields = setDisplayFields(tenantId, appId, { name });
  return fields.name;
}

function setDisplayDescription(tenantId, appId, description) {
  const fields = setDisplayFields(tenantId, appId, { description });
  return fields.description || '';
}

function clearDisplayName(tenantId, appId) {
  const overrides = readOverrides(tenantId);
  if (!overrides[appId]) return;
  delete overrides[appId];
  writeOverrides(tenantId, overrides);
}

function applyDisplayName(tenantId, app) {
  if (!app) return app;
  const override = getDisplayOverride(tenantId, app.id);
  if (!override) return app;
  const next = { ...app };
  if (override.name) {
    next.originalName = app.name !== override.name ? app.name : app.originalName;
    next.name = override.name;
  }
  if (override.description != null) {
    next.originalDescription =
      app.description !== override.description ? app.description : app.originalDescription;
    next.description = override.description;
  }
  return next;
}

function applyDisplayNames(tenantId, apps) {
  return (apps || []).map((a) => applyDisplayName(tenantId, a));
}

module.exports = {
  getDisplayName,
  getDisplayOverride,
  setDisplayName,
  setDisplayDescription,
  setDisplayFields,
  clearDisplayName,
  applyDisplayName,
  applyDisplayNames,
};
