// Resource rows for estimates — counts, SKUs, extras, removals, friendly labels per app.

const { getTshirtSizeMeta } = require('../data/applications');

const NODE_RESOURCE_TYPES = new Set(['vm', 'aks_node', 'aro_node']);
const EDITABLE_RESOURCE_TYPES = new Set([
  'vm',
  'aks_node',
  'aro_node',
  'storage',
  'managed_cache',
  'load_balancer',
  'app_gateway',
]);

const EXTRA_RESOURCES_KEY = 'extraResources';
const REMOVED_RESOURCES_KEY = 'removedResources';
const ADDED_RESOURCE_TYPES = new Set(['vm', 'aks_node', 'aro_node', 'storage']);

const STORAGE_SKU_OPTIONS = [
  { id: 'premium_ssd', label: 'Premium SSD (per GB)' },
  { id: 'standard_ssd', label: 'Standard SSD (per GB)' },
  { id: 'standard_hdd', label: 'Standard HDD (per GB)' },
  { id: 'ultra_ssd', label: 'Ultra SSD (per GB)' },
  { id: 'hot_blob', label: 'Hot blob (per GB)' },
  { id: 'cool_blob', label: 'Cool blob (per GB)' },
];

// VM SKUs we surface at the top of dropdowns
const POPULAR_VM_SKUS = [
  'Standard_B2s',
  'Standard_B4ms',
  'Standard_B8ms',
  'Standard_D2s_v5',
  'Standard_D4s_v5',
  'Standard_D8s_v5',
  'Standard_D16s_v5',
  'Standard_D32s_v5',
  'Standard_D48s_v5',
  'Standard_D64s_v5',
  'Standard_E2s_v5',
  'Standard_E4s_v5',
  'Standard_E8s_v5',
  'Standard_E16s_v5',
  'Standard_E20s_v5',
  'Standard_E32s_v5',
  'Standard_E48s_v5',
  'Standard_E64s_v5',
  'Standard_E64-16s_v5',
  'Standard_E96s_v5',
  'Standard_E104is_v5',
  'Standard_F4s_v2',
  'Standard_F8s_v2',
  'Standard_F16s_v2',
  'Standard_F32s_v2',
  'Standard_NC6s_v3',
  'Standard_M16ts',
  'Standard_M32ts',
  'Standard_M64ts',
];

function skuOverrideKey(resourceId) {
  return `${resourceId}__sku`;
}

function getBaselineResourceMap(app, tshirtSize) {
  const sizeMeta = getTshirtSizeMeta(app, tshirtSize);
  const map = {};
  for (const res of sizeMeta?.resources || []) {
    map[res.id] = res.quantity;
  }
  return map;
}

function getPrimaryWorkerResource(resources) {
  return resources.find((r) =>
    NODE_RESOURCE_TYPES.has(r.type) && (r.role === 'worker' || /workers?$/i.test(r.id))
  ) || resources.find((r) => NODE_RESOURCE_TYPES.has(r.type));
}

function scaleDependentQuantities(resources, app, tshirtSize) {
  const baselines = getBaselineResourceMap(app, tshirtSize);
  const worker = getPrimaryWorkerResource(resources);
  if (!worker) return;

  const baselineWorkers = baselines[worker.id] || worker.quantity || 1;
  const ratio = worker.quantity / baselineWorkers;

  for (const res of resources) {
    if (res.type !== 'license') continue;
    const baselineQty = baselines[res.id];
    if (baselineQty == null) continue;

    if (res.unit === 'nodes' || res.sku === 'cloudera_cds_node') {
      res.quantity = Math.max(1, Math.round(worker.quantity));
      continue;
    }

    if (res.unit === 'cluster') {
      if (ratio !== 1 && baselineQty > 0) {
        res.quantity = Math.max(1, Math.round(baselineQty * ratio));
      }
      continue;
    }

    if (ratio !== 1 || res.unit === 'cores' || res.sku === 'openshift_per_core') {
      const perWorker = baselineQty / baselineWorkers;
      res.quantity = Math.max(1, Math.round(perWorker * worker.quantity));
    }
  }
}

function formatNodeLabel(resource) {
  if (resource.role) {
    const role = resource.role.charAt(0).toUpperCase() + resource.role.slice(1);
    return `${role} nodes`;
  }
  if (resource.label) return resource.label;
  return resource.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatResourceLabel(resource) {
  if (resource.type === 'storage') {
    if (resource.label) return resource.label;
    return resource.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return formatNodeLabel(resource);
}

function getBaselineNodeQuantities(app, tshirtSize) {
  const sizeMeta = getTshirtSizeMeta(app, tshirtSize);
  const map = {};
  for (const res of sizeMeta?.resources || []) {
    if (NODE_RESOURCE_TYPES.has(res.type)) {
      map[res.id] = res.quantity;
    }
  }
  return map;
}

function resolveEffectiveSku(resource, overrides = {}) {
  const key = skuOverrideKey(resource.id);
  if (overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== '') {
    return String(overrides[key]);
  }
  return resource.sku;
}

function defaultComputeTypeForApp(app) {
  const platform = String(app?.platform || 'vm').toLowerCase();
  if (platform === 'aro') return 'aro_node';
  if (platform === 'aks') return 'aks_node';
  return 'vm';
}

function parseRemovedResourceIds(overrides = {}) {
  const raw = overrides[REMOVED_RESOURCES_KEY];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((id) => String(id)).filter(Boolean));
}

function normalizeExtraResource(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;

  let type = String(raw.type || 'vm');
  if (!ADDED_RESOURCE_TYPES.has(type)) {
    type = type === 'storage' ? 'storage' : 'vm';
  }

  const isStorage = type === 'storage';
  const quantity = Number(raw.quantity);
  const sku =
    raw.sku != null && String(raw.sku).trim()
      ? String(raw.sku).trim()
      : isStorage
        ? 'P30'
        : 'Standard_D8s_v5';

  return {
    id,
    type,
    sku,
    quantity: Number.isFinite(quantity) ? quantity : 1,
    unit: raw.unit || (isStorage ? 'disks' : 'nodes'),
    label: raw.label || (isStorage ? `Storage ${index + 1}` : `VM group ${index + 1}`),
    role: raw.role || null,
    added: true,
  };
}

function parseExtraResources(overrides = {}) {
  const raw = overrides[EXTRA_RESOURCES_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => normalizeExtraResource(r, i)).filter(Boolean);
}

// Baseline resources + extras, minus removed ids
function composeAppResources(baseResources = [], overrides = {}) {
  const removed = parseRemovedResourceIds(overrides);
  const list = JSON.parse(JSON.stringify(baseResources || [])).filter((r) => !removed.has(r.id));
  const seen = new Set(list.map((r) => r.id));

  for (const extra of parseExtraResources(overrides)) {
    if (removed.has(extra.id) || seen.has(extra.id)) continue;
    list.push({
      id: extra.id,
      type: extra.type,
      sku: extra.sku,
      quantity: extra.quantity,
      unit: extra.unit,
      label: extra.label,
      role: extra.role || undefined,
      added: true,
    });
    seen.add(extra.id);
  }

  const labels =
    overrides.resourceLabels && typeof overrides.resourceLabels === 'object'
      ? overrides.resourceLabels
      : null;
  if (labels) {
    for (const res of list) {
      const override = labels[res.id];
      if (override != null && String(override).trim()) {
        res.label = String(override).trim();
      }
    }
  }

  return list;
}

function getBaselineResourcesList(app, tshirtSize) {
  const sizeMeta = getTshirtSizeMeta(app, tshirtSize);
  return JSON.parse(JSON.stringify(sizeMeta?.resources || app.baseResources || []));
}

function createExtraResource(kind, app, index = 0) {
  const isStorage = kind === 'storage';
  const type = isStorage ? 'storage' : defaultComputeTypeForApp(app);
  const id = isStorage
    ? `extra_storage_${Date.now()}_${index}`
    : `extra_vm_${Date.now()}_${index}`;
  return normalizeExtraResource(
    {
      id,
      type,
      sku: isStorage ? 'P30' : 'Standard_D8s_v5',
      quantity: 1,
      unit: isStorage ? 'disks' : 'nodes',
      label: isStorage ? `Storage` : `Additional VMs`,
      role: isStorage ? null : 'worker',
    },
    index
  );
}

function getNodeResources(app, overrides = {}) {
  return getEditableResources(app, overrides).filter((r) => NODE_RESOURCE_TYPES.has(r.type));
}

// Estimate tab editable rows — qty on id, SKU on id__sku, extras/removals in overrides
function getEditableResources(app, overrides = {}) {
  const tshirtSize = overrides.tshirtSize || app.defaultTshirtSize || 'M';
  const baselines = getBaselineResourceMap(app, tshirtSize);
  const baseList = getBaselineResourcesList(app, tshirtSize);
  const resources = composeAppResources(baseList, overrides);
  const removed = parseRemovedResourceIds(overrides);
  const extraIds = new Set(parseExtraResources(overrides).map((r) => r.id));

  const resourceLabels =
    overrides.resourceLabels && typeof overrides.resourceLabels === 'object'
      ? overrides.resourceLabels
      : {};

  return resources
    .filter((r) => EDITABLE_RESOURCE_TYPES.has(r.type))
    .map((r) => {
      const skuKey = skuOverrideKey(r.id);
      const isNode = NODE_RESOURCE_TYPES.has(r.type);
      const isStorage = r.type === 'storage';
      const sku = resolveEffectiveSku(r, overrides);
      const quantity =
        overrides[r.id] !== undefined ? Number(overrides[r.id]) : r.quantity;
      const isAdded = Boolean(r.added) || extraIds.has(r.id);
      const isRemovable = isAdded || !removed.has(r.id);
      const labelOverride = resourceLabels[r.id];
      const label =
        labelOverride != null && String(labelOverride).trim()
          ? String(labelOverride).trim()
          : formatResourceLabel(r);

      return {
        id: r.id,
        label,
        type: r.type,
        role: r.role || null,
        sku,
        defaultSku: r.sku,
        skuKey,
        quantity: Number.isFinite(quantity) ? quantity : r.quantity,
        defaultQuantity: isAdded ? (Number.isFinite(quantity) ? quantity : r.quantity) : (baselines[r.id] ?? r.quantity),
        min: 0,
        max: isStorage ? 10_000_000 : isNode ? (r.type === 'vm' ? 256 : 128) : 1000,
        unit: r.unit || (isNode ? 'nodes' : isStorage ? 'GB' : 'units'),
        fieldType: isNode ? 'compute' : isStorage ? 'storage' : 'other',
        canChangeSku: isNode || isStorage || r.type === 'managed_cache',
        isAdded,
        canRemove: isRemovable,
      };
    });
}

function countTotalNodes(nodeResources) {
  return nodeResources.reduce((sum, n) => {
    if (!NODE_RESOURCE_TYPES.has(n.type)) return sum;
    return sum + (Number(n.quantity) || 0);
  }, 0);
}

// Apply override map before we price resources
function applyNodeQuantityOverrides(resources, mergedOverrides, variableState) {
  applyResourceOverrides(resources, mergedOverrides, variableState);
}

function applyResourceOverrides(resources, mergedOverrides, variableState) {
  for (const res of resources) {
    const skuKey = skuOverrideKey(res.id);
    if (mergedOverrides[skuKey] !== undefined && mergedOverrides[skuKey] !== null && mergedOverrides[skuKey] !== '') {
      res.sku = String(mergedOverrides[skuKey]);
      variableState[skuKey] = res.sku;
    }

    // Only scale licence quantities from workers; don't bind arbitrary licence overrides here
    if (res.type === 'license' || res.type === 'subscription') {
      continue;
    }

    if (mergedOverrides[res.id] !== undefined) {
      let qty = Number(mergedOverrides[res.id]);
      if (!Number.isFinite(qty)) qty = res.quantity;
      if (res.type === 'storage') {
        res.quantity = Math.max(0, qty);
      } else {
        res.quantity = Math.max(0, Math.round(qty));
      }
      variableState[res.id] = res.quantity;
    } else if (NODE_RESOURCE_TYPES.has(res.type) || EDITABLE_RESOURCE_TYPES.has(res.type)) {
      variableState[res.id] = res.quantity;
    }
  }
}

function nodeOverridesFromResources(app, tshirtSize) {
  return getBaselineNodeQuantities(app, tshirtSize);
}

module.exports = {
  NODE_RESOURCE_TYPES,
  EDITABLE_RESOURCE_TYPES,
  STORAGE_SKU_OPTIONS,
  POPULAR_VM_SKUS,
  EXTRA_RESOURCES_KEY,
  REMOVED_RESOURCES_KEY,
  skuOverrideKey,
  getNodeResources,
  getEditableResources,
  countTotalNodes,
  applyNodeQuantityOverrides,
  applyResourceOverrides,
  getBaselineNodeQuantities,
  getBaselineResourceMap,
  getBaselineResourcesList,
  composeAppResources,
  parseExtraResources,
  parseRemovedResourceIds,
  createExtraResource,
  defaultComputeTypeForApp,
  scaleDependentQuantities,
  nodeOverridesFromResources,
  formatNodeLabel,
  formatResourceLabel,
};
