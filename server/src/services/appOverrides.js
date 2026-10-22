// Per-app estimate overrides (size, node counts, SKUs) — one JSON file per tenant.

const fs = require('fs');
const path = require('path');
const { appHasSkuLicenses } = require('../data/applications');
const { ensureTenant, tenantFile } = require('./tenantStore');

function overridesPath(tenantId) {
  ensureTenant(tenantId);
  return tenantFile(tenantId, 'overrides');
}

function readAll(tenantId) {
  try {
    const file = overridesPath(tenantId);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeAll(tenantId, data) {
  const file = overridesPath(tenantId);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getAppOverrides(tenantId, appId) {
  const all = readAll(tenantId);
  return all[appId] || {};
}

function sanitizeOverrides(app, overrides) {
  const clean = { ...overrides };

  if (Array.isArray(clean.extraResources)) {
    clean.extraResources = clean.extraResources
      .filter((r) => r && r.id)
      .map((r) => ({
        id: String(r.id),
        type: r.type || 'vm',
        sku: r.sku,
        quantity: r.quantity,
        unit: r.unit,
        label: r.label,
        role: r.role || undefined,
      }));
  } else {
    delete clean.extraResources;
  }

  if (Array.isArray(clean.removedResources)) {
    clean.removedResources = [...new Set(clean.removedResources.map((id) => String(id)).filter(Boolean))];
  } else {
    delete clean.removedResources;
  }

  if (clean.resourceLabels && typeof clean.resourceLabels === 'object' && !Array.isArray(clean.resourceLabels)) {
    const labels = {};
    for (const [id, label] of Object.entries(clean.resourceLabels)) {
      if (!id || label == null) continue;
      const text = String(label).trim();
      if (text) labels[String(id)] = text;
    }
    if (Object.keys(labels).length) clean.resourceLabels = labels;
    else delete clean.resourceLabels;
  } else {
    delete clean.resourceLabels;
  }

  if (Array.isArray(clean.commercialLines)) {
    clean.commercialLines = clean.commercialLines
      .filter((l) => l && (l.id || l.label || l.kind))
      .map((l, i) => {
        const kind = String(l.kind || 'subscription').toLowerCase() === 'license' ? 'license' : 'subscription';
        const monthly = Number(l.monthlyCost);
        return {
          id: String(l.id || `commercial_${kind}_${i}`),
          kind,
          label: String(l.label || (kind === 'license' ? 'Licence' : 'Subscription')).trim().slice(0, 120)
            || (kind === 'license' ? 'Licence' : 'Subscription'),
          monthlyCost: Number.isFinite(monthly) ? Math.max(0, monthly) : 0,
        };
      });
    const subSum = clean.commercialLines
      .filter((l) => l.kind === 'subscription')
      .reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0);
    const licSum = clean.commercialLines
      .filter((l) => l.kind === 'license')
      .reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0);
    clean.subscriptionCostMonthly = Math.round(subSum * 100) / 100;
    clean.licenseCostMonthly = Math.round(licSum * 100) / 100;
  } else {
    delete clean.commercialLines;
    // Legacy single-field apps with per-node SKU licences drop empty contract field
    if (app && appHasSkuLicenses(app) && !clean.licenseCostMonthly) {
      delete clean.licenseCostMonthly;
    }
  }

  return clean;
}

function getEffectiveOverrides(tenantId, app, partial = {}) {
  const saved = getAppOverrides(tenantId, app.id);
  const tshirtSize = partial.tshirtSize || saved.tshirtSize || app.defaultTshirtSize || 'M';
  return sanitizeOverrides(app, {
    ...saved,
    ...partial,
    tshirtSize,
  });
}

function setAppOverrides(tenantId, appId, overrides, app = null) {
  const all = readAll(tenantId);
  const clean = app ? sanitizeOverrides(app, overrides) : { ...overrides };
  all[appId] = {
    ...clean,
    updatedAt: new Date().toISOString(),
  };
  writeAll(tenantId, all);
  return all[appId];
}

function clearAppOverrides(tenantId, appId) {
  const all = readAll(tenantId);
  if (all[appId] == null) return { ok: true, id: appId, cleared: false };
  delete all[appId];
  writeAll(tenantId, all);
  return { ok: true, id: appId, cleared: true };
}

module.exports = {
  getAppOverrides,
  setAppOverrides,
  getEffectiveOverrides,
  sanitizeOverrides,
  clearAppOverrides,
};
