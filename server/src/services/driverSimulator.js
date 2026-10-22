// Run a portfolio scenario — map sliders to driver units, then price the delta.

const { getApplicationById } = require('../data/applicationRegistry');
const { getScenarioById, INGESTION_FREQUENCIES, STORAGE_UNIT_MULTIPLIERS } = require('../data/simulationScenarios');
const { getEffectiveOverrides } = require('./appOverrides');
const { projectDriver, applyVariables, calculateFullCosts, diffLineItems } = require('./costCalculator');

async function simulateArchiveGb(app, gb, overrides = {}) {
  const base = applyVariables(app, overrides);
  const baseCosts = await calculateFullCosts(app, base.resources, base.variableState);

  const resources = JSON.parse(JSON.stringify(base.resources));
  const archiveRes = resources.find((r) => r.id === 'archive_storage');
  const licenseRes = resources.find((r) => r.id === 'infoarchive_license');
  const indexRes = resources.find((r) => r.id === 'index_storage');

  const applied = [];
  if (archiveRes) {
    const prev = archiveRes.quantity;
    archiveRes.quantity += gb;
    applied.push({ resourceId: 'archive_storage', from: prev, to: archiveRes.quantity, delta: gb, costType: 'azure' });
  }
  if (licenseRes) {
    const tbDelta = gb / 1000;
    const prev = licenseRes.quantity;
    licenseRes.quantity += tbDelta;
    applied.push({ resourceId: 'infoarchive_license', from: prev, to: licenseRes.quantity, delta: tbDelta, costType: 'license' });
  }
  if (indexRes && gb >= 1000) {
    const indexDelta = Math.round(gb * 0.05);
    const prev = indexRes.quantity;
    indexRes.quantity += indexDelta;
    applied.push({ resourceId: 'index_storage', from: prev, to: indexRes.quantity, delta: indexDelta, costType: 'azure' });
  }

  const projectedCosts = await calculateFullCosts(app, resources, base.variableState);
  const { incrementalMonthly, incrementalBreakdown } = diffLineItems(baseCosts.lineItems, projectedCosts.lineItems);

  return {
    applicationId: app.id,
    applicationName: app.name,
    platform: app.platform,
    driverName: `Archive +${gb.toLocaleString()} GB`,
    driverDescription: 'Proportional archive, index, and per-TB licence growth',
    units: gb,
    unitLabel: 'GB',
    baseMonthly: baseCosts.totalMonthly,
    projectedMonthly: projectedCosts.totalMonthly,
    incrementalMonthly,
    incrementalAnnual: Math.round(incrementalMonthly * 12 * 100) / 100,
    incrementalBreakdown,
    systemCostsOneTime: 0,
    resourceChanges: applied,
    impacts: applied.map((a) => ({
      resource: a.resourceId,
      change: `${a.from} → ${Math.round(a.to * 100) / 100}`,
      type: a.costType,
    })),
    currency: 'AUD',
  };
}

async function simulateMapping(app, mapping, value, overrides, ingestionCtx = null) {
  if (mapping.mode === 'archive_gb') {
    return simulateArchiveGb(app, value, overrides);
  }

  const driver = app.drivers.find((d) => d.id === mapping.driverId);
  if (!driver) {
    return {
      applicationId: app.id,
      applicationName: app.name,
      platform: app.platform,
      error: `Driver not found: ${mapping.driverId}`,
      incrementalMonthly: 0,
    };
  }

  const units = mapping.unitsFromIngestion
    ? mapping.unitsFromIngestion(ingestionCtx)
    : mapping.unitsFromValue(value);
  const projection = await projectDriver(app, mapping.driverId, units, overrides);

  let systemTotal = 0;
  if (projection.systemCosts) {
    systemTotal = projection.systemCosts.reduce((s, c) => s + (c.total || 0), 0);
  }

  return {
    applicationId: app.id,
    applicationName: app.name,
    platform: app.platform,
    driverId: mapping.driverId,
    driverName: driver.name,
    driverDescription: mapping.summary || driver.description,
    units: Math.round(units * 100) / 100,
    unitLabel: driver.unitLabel || 'units',
    baseMonthly: projection.baseMonthly,
    projectedMonthly: projection.projectedMonthly,
    incrementalMonthly: projection.incrementalMonthly,
    incrementalAnnual: projection.incrementalAnnual,
    incrementalBreakdown: projection.incrementalBreakdown,
    systemCostsOneTime: projection.systemCostsOneTime,
    resourceChanges: projection.resourceChanges,
    impacts: buildImpactSummary(projection.resourceChanges, projection.incrementalBreakdown),
    currency: projection.currency,
  };
}

function buildImpactSummary(changes, breakdown) {
  const items = [];
  for (const c of changes || []) {
    if (c.resourceId) {
      items.push({
        resource: c.resourceId,
        change: c.note || `${c.from ?? '?'} → ${typeof c.to === 'number' ? Math.round(c.to * 100) / 100 : c.to}`,
        type: c.costType || 'azure',
      });
    }
    if (c.costType === 'subscription') {
      items.push({ resource: 'Subscription', change: `${c.from} → ${c.to} AUD/mo`, type: 'subscription' });
    }
    if (c.costType === 'license' && !c.resourceId) {
      items.push({ resource: 'Licence (contract)', change: `${c.from} → ${c.to} AUD/mo`, type: 'license' });
    }
    if (c.variable) {
      items.push({ resource: c.variable, change: `${c.from} → ${c.to}`, type: 'variable' });
    }
  }
  if (items.length === 0 && breakdown) {
    if (breakdown.azure > 0) items.push({ resource: 'Azure infrastructure', change: `+${breakdown.azure} AUD/mo`, type: 'azure' });
    if (breakdown.subscription > 0) items.push({ resource: 'Subscription', change: `+${breakdown.subscription} AUD/mo`, type: 'subscription' });
    if (breakdown.license > 0) items.push({ resource: 'Licence', change: `+${breakdown.license} AUD/mo`, type: 'license' });
  }
  return items;
}

function resolveArchiveInput(value, unit = 'GB') {
  const raw = Number(value);
  const safeUnit = STORAGE_UNIT_MULTIPLIERS[unit] ? unit : 'GB';
  return {
    valueInGb: raw * STORAGE_UNIT_MULTIPLIERS[safeUnit],
    inputValueRaw: raw,
    inputUnit: safeUnit,
  };
}

function resolveIngestionInput(value, options = {}) {
  const datasetCount = Number(options.datasetCount ?? value ?? 1);
  const sizeRaw = Number(options.datasetSize ?? 500);
  const sizeUnit = STORAGE_UNIT_MULTIPLIERS[options.datasetSizeUnit] ? options.datasetSizeUnit : 'GB';
  const sizeGb = sizeRaw * STORAGE_UNIT_MULTIPLIERS[sizeUnit];
  const frequencyId = options.frequency || 'monthly';
  const freq = INGESTION_FREQUENCIES.find((f) => f.id === frequencyId)
    || INGESTION_FREQUENCIES.find((f) => f.id === 'monthly');
  const monthlyIngestionGb = freq.oneTime ? 0 : datasetCount * sizeGb * freq.eventsPerMonth;

  return {
    datasetCount,
    sizeGb,
    sizeRaw,
    sizeUnit,
    frequency: frequencyId,
    frequencyLabel: freq.label,
    eventsPerMonth: freq.eventsPerMonth,
    monthlyIngestionGb,
    totalSizeGb: datasetCount * sizeGb,
  };
}

function formatIngestionDisplay(ctx) {
  const countPart = `${ctx.datasetCount.toLocaleString()} dataset${ctx.datasetCount === 1 ? '' : 's'}`;
  const sizePart = `${ctx.sizeRaw.toLocaleString()} ${ctx.sizeUnit} each`;
  if (ctx.frequency === 'once') {
    return `${countPart} × ${sizePart} — ${ctx.totalSizeGb.toLocaleString()} GB footprint`;
  }
  return `${countPart} × ${sizePart}, ${ctx.frequencyLabel.toLowerCase()} (~${Math.round(ctx.monthlyIngestionGb).toLocaleString()} GB/mo)`;
}

async function simulateScenario(scenarioId, value, options = {}) {
  const scenario = getScenarioById(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);

  let numValue = Number(value);
  let inputValueRaw = numValue;
  let inputUnit = scenario.inputUnit;
  let ingestionCtx = null;
  let inputDisplay;

  if (scenario.id === 'archive_storage') {
    const resolved = resolveArchiveInput(value, options.unit);
    numValue = resolved.valueInGb;
    inputValueRaw = resolved.inputValueRaw;
    inputUnit = resolved.inputUnit;
  } else if (scenario.id === 'data_ingestion') {
    ingestionCtx = resolveIngestionInput(value, options);
    numValue = ingestionCtx.datasetCount;
    inputValueRaw = numValue;
    inputDisplay = formatIngestionDisplay(ingestionCtx);

    if (!Number.isFinite(ingestionCtx.datasetCount) || ingestionCtx.datasetCount < scenario.min || ingestionCtx.datasetCount > scenario.max) {
      throw new Error(`Dataset count must be between ${scenario.min} and ${scenario.max}`);
    }
    if (!Number.isFinite(ingestionCtx.sizeGb) || ingestionCtx.sizeGb < 1 || ingestionCtx.sizeGb > 10_000_000) {
      throw new Error('Dataset size must be between 1 GB and 10 PB per dataset');
    }
  }

  if (scenario.id !== 'data_ingestion') {
    if (!Number.isFinite(numValue) || numValue < scenario.min || numValue > scenario.max) {
      const rangeLabel = scenario.id === 'archive_storage' ? `${scenario.min} and ${scenario.max} GB` : `${scenario.min} and ${scenario.max}`;
      throw new Error(`Value must be between ${rangeLabel}`);
    }
  }

  const { tshirtSize, appFilter, tenantId } = options;
  if (!tenantId) throw new Error('tenantId is required for portfolio simulation');
  const results = [];

  for (const mapping of scenario.mappings) {
    if (appFilter?.length && !appFilter.includes(mapping.appId)) continue;

    const app = getApplicationById(tenantId, mapping.appId);
    if (!app) continue;

    const baseOv = getEffectiveOverrides(tenantId, app);
    const overrides = {
      ...baseOv,
      tshirtSize: tshirtSize || baseOv.tshirtSize || app.defaultTshirtSize,
    };
    try {
      const result = await simulateMapping(app, mapping, numValue, overrides, ingestionCtx);
      if (result.incrementalMonthly > 0 || result.systemCostsOneTime > 0 || (result.impacts?.length > 0)) {
        results.push(result);
      } else if (!result.error) {
        results.push(result);
      } else {
        results.push(result);
      }
    } catch (err) {
      results.push({
        applicationId: mapping.appId,
        applicationName: app.name,
        error: err.message,
        incrementalMonthly: 0,
      });
    }
  }

  results.sort((a, b) => (b.incrementalMonthly || 0) - (a.incrementalMonthly || 0));

  const portfolioIncremental = Math.round(results.reduce((s, r) => s + (r.incrementalMonthly || 0), 0) * 100) / 100;
  const portfolioAnnual = Math.round(portfolioIncremental * 12 * 100) / 100;
  const portfolioSystem = Math.round(results.reduce((s, r) => s + (r.systemCostsOneTime || 0), 0) * 100) / 100;

  const breakdown = results.reduce(
    (acc, r) => {
      if (r.incrementalBreakdown) {
        acc.azure += r.incrementalBreakdown.azure || 0;
        acc.subscription += r.incrementalBreakdown.subscription || 0;
        acc.license += r.incrementalBreakdown.license || 0;
      }
      return acc;
    },
    { azure: 0, subscription: 0, license: 0 }
  );
  for (const k of Object.keys(breakdown)) {
    breakdown[k] = Math.round(breakdown[k] * 100) / 100;
  }

  return {
    scenario: {
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      inputUnit: scenario.inputUnit,
    },
    inputValue: numValue,
    inputValueRaw,
    inputUnit,
    inputDisplay:
      inputDisplay
      ?? (scenario.id === 'archive_storage'
        ? `${inputValueRaw.toLocaleString()} ${inputUnit} (${numValue.toLocaleString()} GB)`
        : `${numValue.toLocaleString()} ${scenario.inputUnit}`),
    ingestion: ingestionCtx,
    currency: 'AUD',
    portfolioIncrementalMonthly: portfolioIncremental,
    portfolioIncrementalAnnual: portfolioAnnual,
    portfolioSystemCostsOneTime: portfolioSystem,
    portfolioBreakdown: breakdown,
    affectedApplications: results.length,
    results,
  };
}

module.exports = { simulateScenario, simulateArchiveGb };
