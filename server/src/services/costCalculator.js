// Turn app definition + overrides + drivers into monthly/annual AUD totals.

const { getResourceUnitPrice, CURRENCY } = require('./azurePricing');
const { getTshirtSizeMeta, TSHIRT_SIZES, appHasSkuLicenses } = require('../data/applications');
const {
  applyNodeQuantityOverrides,
  scaleDependentQuantities,
  composeAppResources,
} = require('./nodeResources');

function resolveAppResources(app, overrides = {}) {
  const size = overrides.tshirtSize || app.defaultTshirtSize || 'M';
  let sizeMeta = getTshirtSizeMeta(app, size);
  const baseline = sizeMeta?.resources
    ? JSON.parse(JSON.stringify(sizeMeta.resources))
    : JSON.parse(JSON.stringify(app.baseResources || []));

  // Merge in extras; strip rows the user removed
  let resources = composeAppResources(baseline, overrides);

  const mergedOverrides = { ...overrides, tshirtSize: size };
  if (sizeMeta?.variableDefaults) {
    for (const [key, val] of Object.entries(sizeMeta.variableDefaults)) {
      if (mergedOverrides[key] === undefined) mergedOverrides[key] = val;
    }
  }

  return { resources, mergedOverrides, sizeMeta, tshirtSize: size };
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Subscription/licence lines — overrides win; else seed from app defaults.
function resolveCommercialLines(app, overrides = {}, variableState = {}) {
  if (Array.isArray(overrides.commercialLines)) {
    return overrides.commercialLines
      .filter((l) => l)
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
  }

  const commercial = app.commercialCosts || {};
  const lines = [];
  const sub =
    variableState.subscriptionCostMonthly !== undefined
      ? Number(variableState.subscriptionCostMonthly)
      : Number(commercial.subscription?.defaultMonthly ?? 0);
  lines.push({
    id: 'subscription_default',
    kind: 'subscription',
    label: commercial.subscription?.label || 'Subscription',
    monthlyCost: Math.max(0, Number.isFinite(sub) ? sub : 0),
  });

  // Contract licence line — 0 when we're only pricing per-node SKU licences
  let lic =
    variableState.licenseCostMonthly !== undefined
      ? Number(variableState.licenseCostMonthly)
      : Number(commercial.license?.defaultMonthly ?? 0);
  if (appHasSkuLicenses(app) && variableState.licenseCostMonthly === undefined && overrides.licenseCostMonthly === undefined) {
    lic = 0;
  }
  lines.push({
    id: 'license_default',
    kind: 'license',
    label: commercial.license?.label || 'Licence',
    monthlyCost: Math.max(0, Number.isFinite(lic) ? lic : 0),
  });

  return lines;
}

function applyCommercialLinesToState(variableState, lines) {
  variableState.commercialLines = lines;
  variableState.subscriptionCostMonthly = money(
    lines.filter((l) => l.kind === 'subscription').reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0)
  );
  variableState.licenseCostMonthly = money(
    lines.filter((l) => l.kind === 'license').reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0)
  );
}

function applyVariables(app, overrides = {}) {
  const { resources, mergedOverrides, sizeMeta, tshirtSize } = resolveAppResources(app, overrides);
  const variableState = { tshirtSize };

  for (const v of app.variables) {
    if (v.type === 'tshirt' || v.type === 'currency') continue;
    const value = mergedOverrides[v.key] !== undefined ? mergedOverrides[v.key] : v.default;
    variableState[v.key] = value;

    if (v.resourceId) {
      const res = resources.find((r) => r.id === v.resourceId);
      if (res) {
        if (v.scale) {
          res.quantity = value * v.scale;
        } else if (v.type === 'select' && v.key.toLowerCase().includes('sku')) {
          res.sku = value;
        } else {
          res.quantity = value;
        }
      }
    }
  }

  for (const v of app.variables) {
    if (v.type !== 'currency') continue;
    const value = mergedOverrides[v.key] !== undefined ? mergedOverrides[v.key] : v.default;
    variableState[v.key] = value;
  }

  // Extra sub/licence lines the user typed in
  const commercialLines = resolveCommercialLines(app, mergedOverrides, variableState);
  applyCommercialLinesToState(variableState, commercialLines);

  applyNodeQuantityOverrides(resources, mergedOverrides, variableState);
  scaleDependentQuantities(resources, app, tshirtSize);

  return { resources, variableState, sizeMeta, tshirtSize };
}

function applyDriverImpacts(resources, variableState, driver, units = 1) {
  const updatedResources = JSON.parse(JSON.stringify(resources));
  const updatedVars = { ...variableState };
  const applied = [];

  for (const impact of driver.impacts || []) {
    const count = driver.perUnit ? units : 1;

    if (impact.resourceId) {
      const res = updatedResources.find((r) => r.id === impact.resourceId);
      if (res) {
        let delta = impact.delta * count;
        if (impact.threshold && variableState[findVarKeyForResource(updatedResources, impact.resourceId)]) {
          // threshold-based scaling handled in projection
        }
        if (impact.skuUpgrade) res.sku = impact.skuUpgrade;
        if (impact.note && impact.delta === 0) {
          applied.push({ resourceId: impact.resourceId, note: impact.note, sku: res.sku });
        } else {
          const prev = res.quantity;
          res.quantity = Math.max(0, res.quantity + delta);
          applied.push({ resourceId: impact.resourceId, from: prev, to: res.quantity, delta, temporary: impact.temporary, costType: 'azure' });
        }
      }
    }

    if (impact.key) {
      const prev = updatedVars[impact.key] ?? 0;
      updatedVars[impact.key] = prev + impact.delta * count;
      applied.push({ variable: impact.key, from: prev, to: updatedVars[impact.key], delta: impact.delta * count, costType: 'variable' });
    }
  }

  for (const impact of driver.subscriptionImpacts || []) {
    const count = impact.perUnit || driver.perUnit ? units : 1;
    const prev = updatedVars.subscriptionCostMonthly ?? 0;
    const delta = impact.delta * count;
    updatedVars.subscriptionCostMonthly = prev + delta;
    applied.push({ costType: 'subscription', from: prev, to: updatedVars.subscriptionCostMonthly, delta });
  }

  for (const impact of driver.licenseImpacts || []) {
    const count = impact.perUnit || driver.perUnit ? units : 1;
    const prev = updatedVars.licenseCostMonthly ?? 0;
    const delta = impact.delta * count;
    updatedVars.licenseCostMonthly = prev + delta;
    applied.push({ costType: 'license', from: prev, to: updatedVars.licenseCostMonthly, delta });
  }

  return { resources: updatedResources, variableState: updatedVars, applied };
}

function findVarKeyForResource(resources, resourceId) {
  return resourceId;
}

async function calculateResourceCosts(resources) {
  const lineItems = [];
  let total = 0;

  for (const res of resources) {
    const unitPricing = await getResourceUnitPrice(res);
    let monthlyCost;

    if (unitPricing.unit === 'GB/month') {
      monthlyCost = unitPricing.price * res.quantity;
    } else if (unitPricing.unit === 'GB') {
      monthlyCost = unitPricing.price * res.quantity;
    } else if (unitPricing.unit === 'TU/month') {
      monthlyCost = unitPricing.price * res.quantity;
    } else if (unitPricing.unit === 'cores' || res.type === 'license') {
      monthlyCost = unitPricing.price * res.quantity;
    } else if (unitPricing.unit === 'users') {
      monthlyCost = unitPricing.price * res.quantity;
    } else {
      monthlyCost = unitPricing.price * res.quantity;
    }

    lineItems.push({
      id: res.id,
      type: res.type,
      sku: res.sku,
      quantity: res.quantity,
      unit: res.unit || unitPricing.unit,
      unitPrice: unitPricing.price,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      currency: CURRENCY,
      role: res.role,
      label: res.label || unitPricing.productName || res.id,
      productName: unitPricing.productName,
      meterId: unitPricing.meterId || res.meterId,
      costCategory: res.type === 'license' ? 'resource_license' : 'azure',
    });
    total += monthlyCost;
  }

  return { lineItems, totalMonthly: Math.round(total * 100) / 100, currency: CURRENCY };
}

function buildCommercialLineItems(variableState, app, resourceLineItems = []) {
  const items = [];
  let lines = Array.isArray(variableState.commercialLines) ? variableState.commercialLines.map((l) => ({ ...l })) : null;

  // Drivers might have bumped legacy sub/licence vars — fold back into lines
  if (lines && lines.length) {
    const targetSub = money(variableState.subscriptionCostMonthly);
    const targetLic = money(variableState.licenseCostMonthly);
    const subLines = lines.filter((l) => l.kind === 'subscription');
    const licLines = lines.filter((l) => l.kind === 'license');
    const subSum = money(subLines.reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0));
    const licSum = money(licLines.reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0));
    if (targetSub !== subSum) {
      if (subLines[0]) {
        subLines[0].monthlyCost = money((Number(subLines[0].monthlyCost) || 0) + (targetSub - subSum));
      } else if (targetSub > 0) {
        lines.push({
          id: 'subscription_driver',
          kind: 'subscription',
          label: app.commercialCosts?.subscription?.label || 'Subscription',
          monthlyCost: targetSub,
        });
      }
    }
    if (targetLic !== licSum) {
      if (licLines[0]) {
        licLines[0].monthlyCost = money((Number(licLines[0].monthlyCost) || 0) + (targetLic - licSum));
      } else if (targetLic > 0) {
        lines.push({
          id: 'license_driver',
          kind: 'license',
          label: app.commercialCosts?.license?.label || 'Licence',
          monthlyCost: targetLic,
        });
      }
    }
    // refresh local arrays after possible push
    lines = lines.map((l) => ({ ...l }));
  }

  if (lines && lines.length) {
    for (const line of lines) {
      const cost = money(line.monthlyCost);
      if (cost <= 0) continue;
      const isLicense = line.kind === 'license';
      items.push({
        id: line.id || `commercial_${line.kind}_${items.length}`,
        type: isLicense ? 'license_contract' : 'subscription',
        sku: 'contract',
        quantity: 1,
        unit: 'AUD/month',
        unitPrice: cost,
        monthlyCost: cost,
        currency: CURRENCY,
        costCategory: isLicense ? 'license' : 'subscription',
        label: line.label || (isLicense ? (app.commercialCosts?.license?.label || 'Licence') : (app.commercialCosts?.subscription?.label || 'Subscription')),
      });
    }
    return items;
  }

  const sub = variableState.subscriptionCostMonthly ?? 0;
  const lic = variableState.licenseCostMonthly ?? 0;

  if (sub > 0) {
    items.push({
      id: 'subscription_cost',
      type: 'subscription',
      sku: 'contract',
      quantity: 1,
      unit: 'AUD/month',
      unitPrice: sub,
      monthlyCost: money(sub),
      currency: CURRENCY,
      costCategory: 'subscription',
      label: app.commercialCosts?.subscription?.label || 'Subscription',
    });
  }
  if (lic > 0) {
    items.push({
      id: 'license_cost',
      type: 'license_contract',
      sku: 'contract',
      quantity: 1,
      unit: 'AUD/month',
      unitPrice: lic,
      monthlyCost: money(lic),
      currency: CURRENCY,
      costCategory: 'license',
      label: app.commercialCosts?.license?.label || 'License',
    });
  }
  return items;
}

function summarizeCosts(lineItems) {
  const azure = lineItems.filter((i) => i.costCategory === 'azure').reduce((s, i) => s + i.monthlyCost, 0);
  const resourceLicense = lineItems.filter((i) => i.costCategory === 'resource_license').reduce((s, i) => s + i.monthlyCost, 0);
  const subscription = lineItems.filter((i) => i.costCategory === 'subscription').reduce((s, i) => s + i.monthlyCost, 0);
  const licenseContract = lineItems.filter((i) => i.costCategory === 'license').reduce((s, i) => s + i.monthlyCost, 0);
  const totalMonthly = Math.round(lineItems.reduce((s, i) => s + i.monthlyCost, 0) * 100) / 100;
  const effectiveLicense = Math.round((resourceLicense + licenseContract) * 100) / 100;

  return {
    azureInfraMonthly: Math.round(azure * 100) / 100,
    resourceLicenseMonthly: Math.round(resourceLicense * 100) / 100,
    subscriptionMonthly: Math.round(subscription * 100) / 100,
    licenseMonthly: Math.round(licenseContract * 100) / 100,
    effectiveLicenseMonthly: effectiveLicense,
    totalCommercialMonthly: Math.round((subscription + effectiveLicense) * 100) / 100,
    totalMonthly,
    licenseSource: licenseContract > 0 && resourceLicense > 0
      ? 'contract_and_resource'
      : licenseContract > 0
        ? 'contract'
        : resourceLicense > 0
          ? 'resource_sku'
          : 'none',
  };
}

async function calculateFullCosts(app, resources, variableState) {
  const resourceCosts = await calculateResourceCosts(resources);
  const commercialItems = buildCommercialLineItems(variableState, app, resourceCosts.lineItems);
  const lineItems = [...resourceCosts.lineItems, ...commercialItems];
  const summary = summarizeCosts(lineItems);
  const lineItemsTotal = Math.round(lineItems.reduce((s, i) => s + i.monthlyCost, 0) * 100) / 100;
  return { lineItems, ...summary, totalMonthly: lineItemsTotal, lineItemsTotal, currency: CURRENCY };
}

async function estimateApplication(app, options = {}) {
  const { overrides = {}, drivers = [], driverUnits = {} } = options;

  let { resources, variableState } = applyVariables(app, overrides);
  const driverResults = [];
  let systemCostsOneTime = 0;

  for (const driverId of drivers) {
    const driver = app.drivers.find((d) => d.id === driverId);
    if (!driver) continue;

    const units = driverUnits[driverId] || 1;
    const result = applyDriverImpacts(resources, variableState, driver, units);
    resources = result.resources;
    variableState = result.variableState;

    if (driver.systemCosts) {
      for (const sc of driver.systemCosts) {
        systemCostsOneTime += sc.costPerUnit * units;
      }
    }

    const costAfter = await calculateFullCosts(app, resources, variableState);
    driverResults.push({
      driverId,
      name: driver.name,
      units,
      applied: result.applied,
      incrementalMonthly: null,
      systemCosts: driver.systemCosts || [],
    });
  }

  const baseOnly = applyVariables(app, overrides);
  const baseCosts = await calculateFullCosts(app, baseOnly.resources, baseOnly.variableState);
  const finalCosts = await calculateFullCosts(app, resources, variableState);

  for (const dr of driverResults) {
    dr.incrementalMonthly = Math.round((finalCosts.totalMonthly - baseCosts.totalMonthly) * 100) / 100;
    dr.incrementalAzure = Math.round((finalCosts.azureInfraMonthly - baseCosts.azureInfraMonthly) * 100) / 100;
    dr.incrementalSubscription = Math.round((finalCosts.subscriptionMonthly - baseCosts.subscriptionMonthly) * 100) / 100;
    dr.incrementalLicense = Math.round((finalCosts.effectiveLicenseMonthly - baseCosts.effectiveLicenseMonthly) * 100) / 100;
  }

  const annualCost = Math.round(finalCosts.totalMonthly * 12 * 100) / 100;

  return {
    applicationId: app.id,
    applicationName: app.name,
    platform: app.platform,
    region: app.region,
    currency: CURRENCY,
    tshirtSize: variableState.tshirtSize || app.defaultTshirtSize,
    tshirtLabel: getTshirtSizeMeta(app, variableState.tshirtSize)?.label,
    tshirtDescription: getTshirtSizeMeta(app, variableState.tshirtSize)?.description,
    variables: variableState,
    commercialCosts: {
      subscription: finalCosts.subscriptionMonthly,
      license: finalCosts.licenseMonthly,
      resourceLicense: finalCosts.resourceLicenseMonthly,
      totalCommercial: finalCosts.totalCommercialMonthly,
    },
    costSummary: {
      azureInfraMonthly: finalCosts.azureInfraMonthly,
      subscriptionMonthly: finalCosts.subscriptionMonthly,
      licenseMonthly: finalCosts.licenseMonthly,
      resourceLicenseMonthly: finalCosts.resourceLicenseMonthly,
      totalCommercialMonthly: finalCosts.totalCommercialMonthly,
      licenseSource: finalCosts.licenseSource,
    },
    commercialLines: variableState.commercialLines || [],
    baseMonthly: baseCosts.totalMonthly,
    totalMonthly: finalCosts.totalMonthly,
    totalAnnual: annualCost,
    systemCostsOneTime: Math.round(systemCostsOneTime * 100) / 100,
    lineItems: finalCosts.lineItems,
    baseLineItems: baseCosts.lineItems,
    driversApplied: driverResults,
    costTriggers: app.costTriggers || [],
    breakdown: groupByCategory(finalCosts.lineItems),
  };
}

function groupByCategory(lineItems) {
  const groups = {};
  for (const item of lineItems) {
    const cat = item.type;
    if (!groups[cat]) groups[cat] = { items: [], subtotal: 0 };
    groups[cat].items.push(item);
    groups[cat].subtotal += item.monthlyCost;
  }
  for (const g of Object.values(groups)) {
    g.subtotal = Math.round(g.subtotal * 100) / 100;
  }
  return groups;
}

function diffLineItems(baseItems, projectedItems) {
  const baseMap = Object.fromEntries(baseItems.map((i) => [i.id, i.monthlyCost]));
  const breakdown = { azure: 0, subscription: 0, license: 0 };
  let total = 0;

  const allIds = new Set([...baseItems.map((i) => i.id), ...projectedItems.map((i) => i.id)]);
  for (const id of allIds) {
    const baseCost = baseMap[id] || 0;
    const projItem = projectedItems.find((i) => i.id === id);
    const projCost = projItem?.monthlyCost || 0;
    const delta = projCost - baseCost;
    if (delta === 0) continue;
    total += delta;
    const cat = projItem?.costCategory || 'azure';
    if (cat === 'resource_license' || cat === 'license') breakdown.license += delta;
    else if (cat === 'subscription') breakdown.subscription += delta;
    else breakdown.azure += delta;
  }

  for (const k of Object.keys(breakdown)) {
    breakdown[k] = Math.round(breakdown[k] * 100) / 100;
  }
  return { incrementalMonthly: Math.round(total * 100) / 100, incrementalBreakdown: breakdown };
}

async function projectDriver(app, driverId, units = 1, overrides = {}) {
  const driver = app.drivers.find((d) => d.id === driverId);
  if (!driver) throw new Error(`Driver not found: ${driverId}`);

  const base = applyVariables(app, overrides);
  const baseCosts = await calculateFullCosts(app, base.resources, base.variableState);

  const projected = applyDriverImpacts(base.resources, base.variableState, driver, units);
  const projectedCosts = await calculateFullCosts(app, projected.resources, projected.variableState);

  const { incrementalMonthly, incrementalBreakdown } = diffLineItems(baseCosts.lineItems, projectedCosts.lineItems);

  let systemCost = 0;
  if (driver.systemCosts) {
    systemCost = driver.systemCosts.reduce((s, c) => s + c.costPerUnit * units, 0);
  }

  return {
    driver: { id: driver.id, name: driver.name, description: driver.description, perUnit: driver.perUnit, unitLabel: driver.unitLabel },
    units,
    baseMonthly: baseCosts.totalMonthly,
    projectedMonthly: projectedCosts.totalMonthly,
    incrementalMonthly,
    incrementalAnnual: Math.round(incrementalMonthly * 12 * 100) / 100,
    incrementalBreakdown,
    systemCostsOneTime: Math.round(systemCost * 100) / 100,
    systemCosts: (driver.systemCosts || []).map((sc) => ({
      ...sc,
      total: Math.round(sc.costPerUnit * units * 100) / 100,
    })),
    resourceChanges: projected.applied,
    lineItems: projectedCosts.lineItems,
    currency: CURRENCY,
  };
}

async function compareAugmentation(app, augmentation) {
  const { type, resourceId, delta, overrides = {} } = augmentation;

  const base = await estimateApplication(app, { overrides });
  const augmentedResources = JSON.parse(JSON.stringify(applyVariables(app, overrides).resources));
  const res = augmentedResources.find((r) => r.id === resourceId);
  if (res) res.quantity += delta;

  const augCosts = await calculateResourceCosts(augmentedResources);

  return {
    augmentation: { type, resourceId, delta },
    baseMonthly: base.totalMonthly,
    augmentedMonthly: augCosts.totalMonthly,
    incrementalMonthly: Math.round((augCosts.totalMonthly - base.totalMonthly) * 100) / 100,
    incrementalAnnual: Math.round((augCosts.totalMonthly - base.totalMonthly) * 12 * 100) / 100,
    currency: CURRENCY,
    newLineItems: augCosts.lineItems,
  };
}

async function estimateAllTshirtSizes(app, overrides = {}) {
  if (!app.tshirtSizes) return [];

  const sizes = TSHIRT_SIZES.filter((s) => app.tshirtSizes[s]);
  const results = await Promise.all(
    sizes.map(async (size) => {
      const est = await estimateApplication(app, { overrides: { ...overrides, tshirtSize: size } });
      return {
        size,
        label: app.tshirtSizes[size].label,
        description: app.tshirtSizes[size].description,
        monthly: est.totalMonthly,
        annual: est.totalAnnual,
        costSummary: est.costSummary,
        lineItems: est.lineItems,
      };
    })
  );
  return results;
}

module.exports = {
  estimateApplication,
  estimateAllTshirtSizes,
  projectDriver,
  compareAugmentation,
  applyVariables,
  resolveAppResources,
  resolveCommercialLines,
  calculateResourceCosts,
  calculateFullCosts,
  diffLineItems,
};
