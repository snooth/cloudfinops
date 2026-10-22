// Built-in app catalog + whatever each tenant adds. Rename OK; delete is soft for built-ins, gone for customs.

const {
  applications: builtinApplications,
  getTshirtSizeMeta,
  listTshirtSizes,
  PLATFORM,
  TSHIRT_SIZES,
  app,
} = require('./applications');

const {
  loadCustomApplications,
  saveCustomApplication,
  updateCustomApplication,
  deleteCustomApplication,
} = require('../services/customApplicationStore');

const { isRemoved, markRemoved } = require('../services/removedApplications');
const { clearAppOverrides } = require('../services/appOverrides');
const {
  setDisplayFields,
  applyDisplayName,
  clearDisplayName,
} = require('../services/appDisplayNames');
const { normalizeTenantId } = require('../services/tenantStore');

function tid(tenantId) {
  return normalizeTenantId(tenantId);
}

function buildApplications(tenantId) {
  const t = tid(tenantId);
  let customApplications = [];
  try {
    customApplications = loadCustomApplications(t);
  } catch (err) {
    console.warn(`[registry] could not load custom apps for ${t}:`, err.message);
    customApplications = [];
  }
  const builtinIds = new Set(builtinApplications.map((a) => a.id));
  const filteredCustom = customApplications.filter((a) => !builtinIds.has(a.id));
  const activeBuiltins = builtinApplications.filter((a) => !isRemoved(t, a.id));
  return (activeBuiltins.concat(filteredCustom)).map((a) => applyDisplayName(t, a));
}

function getAllApplications(tenantId) {
  return buildApplications(tenantId);
}

function getApplicationById(tenantId, id) {
  return buildApplications(tenantId).find((a) => a.id === id);
}

function isBuiltinApplication(id) {
  return builtinApplications.some((a) => a.id === id);
}

function createApplication(tenantId, input) {
  const t = tid(tenantId);
  if (isBuiltinApplication(input.id) && !isRemoved(t, input.id)) {
    throw new Error('An application with this id already exists (built-in)');
  }
  if (isBuiltinApplication(input.id)) {
    throw new Error('This id is reserved for a built-in application definition');
  }
  const created = saveCustomApplication(t, input);
  return getApplicationById(t, created.id) || applyDisplayName(t, created);
}

function renameApplication(tenantId, id, name) {
  return updateApplicationMeta(tenantId, id, { name });
}

function updateApplicationMeta(tenantId, id, { name, description } = {}) {
  const t = tid(tenantId);
  const existing = getApplicationById(t, id);
  if (!existing) throw new Error('Application not found');

  const patch = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (!Object.keys(patch).length) {
    throw new Error('Nothing to update');
  }

  setDisplayFields(t, id, patch);

  if (!isBuiltinApplication(id)) {
    try {
      const customPatch = {};
      if (name !== undefined) customPatch.name = String(name || '').trim();
      if (description !== undefined) customPatch.description = String(description ?? '').trim();
      if (Object.keys(customPatch).length) updateCustomApplication(t, id, customPatch);
    } catch {
      /* display fields still applied */
    }
  }

  return getApplicationById(t, id);
}

function updateApplication(tenantId, id, input = {}) {
  const t = tid(tenantId);
  const existing = getApplicationById(t, id);
  if (!existing) throw new Error('Application not found');

  if (input.name != null || input.description != null) {
    return updateApplicationMeta(t, id, {
      name: input.name,
      description: input.description,
    });
  }

  if (isBuiltinApplication(id)) {
    throw new Error('Built-in applications only support name and description edits via the UI');
  }

  const updated = updateCustomApplication(t, id, input);
  return getApplicationById(t, updated.id) || applyDisplayName(t, updated);
}

// Drop from this tenant's portfolio — customs deleted; built-ins just hidden.
function removeApplication(tenantId, id) {
  const t = tid(tenantId);
  const customList = (() => {
    try {
      return loadCustomApplications(t);
    } catch {
      return [];
    }
  })();
  const existing =
    getApplicationById(t, id) ||
    builtinApplications.find((a) => a.id === id) ||
    customList.find((a) => a.id === id);
  if (!existing && !isBuiltinApplication(id)) {
    throw new Error('Application not found');
  }

  if (isBuiltinApplication(id)) {
    markRemoved(t, id);
  } else {
    deleteCustomApplication(t, id);
  }

  try {
    clearAppOverrides(t, id);
  } catch {
    /* non-fatal */
  }
  try {
    clearDisplayName(t, id);
  } catch {
    /* non-fatal */
  }

  return { ok: true, id, custom: !isBuiltinApplication(id) };
}

/** @deprecated no-op — we build the list per request per tenant now */
function reloadApplications() {
  return true;
}

module.exports = {
  getAllApplications,
  getApplicationById,
  isBuiltinApplication,
  createApplication,
  updateApplication,
  updateApplicationMeta,
  renameApplication,
  removeApplication,
  reloadApplications,
  getTshirtSizeMeta,
  listTshirtSizes,
  PLATFORM,
  TSHIRT_SIZES,
  app,
  builtinApplications,
};
