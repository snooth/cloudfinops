// Built-ins the tenant hid — ids list, not a real delete from the catalog.

const fs = require('fs');
const path = require('path');
const { ensureTenant, tenantFile } = require('./tenantStore');

function storeFile(tenantId) {
  ensureTenant(tenantId);
  return tenantFile(tenantId, 'removed');
}

function ensureStore(tenantId) {
  const file = storeFile(tenantId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ ids: [] }, null, 2));
  }
  return file;
}

function readIds(tenantId) {
  ensureStore(tenantId);
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(tenantId), 'utf8'));
    return Array.isArray(data.ids) ? data.ids.map(String) : [];
  } catch {
    return [];
  }
}

function writeIds(tenantId, ids) {
  ensureStore(tenantId);
  fs.writeFileSync(
    storeFile(tenantId),
    JSON.stringify({ ids: [...new Set(ids.map(String))], updatedAt: new Date().toISOString() }, null, 2)
  );
}

function isRemoved(tenantId, id) {
  return readIds(tenantId).includes(String(id));
}

function markRemoved(tenantId, id) {
  const ids = readIds(tenantId);
  if (!ids.includes(String(id))) {
    ids.push(String(id));
    writeIds(tenantId, ids);
  }
  return { ok: true, id };
}

function unmarkRemoved(tenantId, id) {
  writeIds(tenantId, readIds(tenantId).filter((x) => x !== String(id)));
  return { ok: true, id };
}

function getRemovedIds(tenantId) {
  return readIds(tenantId);
}

module.exports = {
  isRemoved,
  markRemoved,
  unmarkRemoved,
  getRemovedIds,
};
