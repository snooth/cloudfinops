// Custom apps the tenant built — JSON on disk under their tenant dir.

const fs = require('fs');
const path = require('path');
const { buildApplicationFromInput } = require('./applicationBuilder');
const { ensureTenant, tenantFile } = require('./tenantStore');

function storeFile(tenantId) {
  ensureTenant(tenantId);
  return tenantFile(tenantId, 'customApps');
}

function ensureStore(tenantId) {
  const file = storeFile(tenantId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ applications: [] }, null, 2));
  }
  return file;
}

function readRaw(tenantId) {
  const file = ensureStore(tenantId);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return data.applications || [];
}

function writeRaw(tenantId, applications) {
  const file = ensureStore(tenantId);
  fs.writeFileSync(file, JSON.stringify({ applications }, null, 2));
}

function loadCustomApplications(tenantId) {
  const raw = readRaw(tenantId);
  return raw.map((input) => buildApplicationFromInput({ ...input, custom: true }));
}

function saveCustomApplication(tenantId, input) {
  const raw = readRaw(tenantId);
  const id = input.id || require('./applicationBuilder').slugify(input.name);

  if (raw.some((a) => a.id === id)) {
    throw new Error(`Application id already exists: ${id}`);
  }

  const stored = { ...input, id, custom: true, createdAt: new Date().toISOString() };
  raw.push(stored);
  writeRaw(tenantId, raw);
  return buildApplicationFromInput(stored);
}

function updateCustomApplication(tenantId, id, input) {
  const raw = readRaw(tenantId);
  const idx = raw.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('Custom application not found');
  if (!raw[idx].custom) throw new Error('Cannot update built-in application');

  const updated = { ...raw[idx], ...input, id, custom: true, updatedAt: new Date().toISOString() };
  raw[idx] = updated;
  writeRaw(tenantId, raw);
  return buildApplicationFromInput(updated);
}

function deleteCustomApplication(tenantId, id) {
  const raw = readRaw(tenantId);
  const idx = raw.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('Custom application not found');
  raw.splice(idx, 1);
  writeRaw(tenantId, raw);
  return { ok: true, id };
}

function getCustomRawById(tenantId, id) {
  return readRaw(tenantId).find((a) => a.id === id);
}

module.exports = {
  loadCustomApplications,
  saveCustomApplication,
  updateCustomApplication,
  deleteCustomApplication,
  getCustomRawById,
};
