// What-if swaps on an app — compare AUD before/after.

const { estimateApplication, applyVariables, calculateFullCosts } = require('./costCalculator');
const retailCatalog = require('./retailCatalog');
const { getRegion } = require('./azurePricing');

// Apply swap list to resolved resources — resourceId + new sku/meter/qty.
function applySwaps(resources, swaps = []) {
  const next = JSON.parse(JSON.stringify(resources));
  const applied = [];

  for (const swap of swaps) {
    if (!swap?.resourceId) continue;
    const res = next.find((r) => r.id === swap.resourceId);
    if (!res) {
      applied.push({ resourceId: swap.resourceId, ok: false, error: 'Resource not found' });
      continue;
    }

    const before = {
      sku: res.sku,
      meterId: res.meterId || null,
      type: res.type,
      quantity: res.quantity,
    };

    if (swap.sku != null) res.sku = swap.sku;
    if (swap.armSkuName != null) {
      res.sku = swap.armSkuName;
      res.armSkuName = swap.armSkuName;
    }
    if (swap.meterId != null) {
      res.meterId = swap.meterId;
      res.type = res.type === 'storage' ? res.type : (res.type || 'azure_component');
      const meter = retailCatalog.findByMeterId(swap.meterId);
      if (meter) {
        res.sku = meter.armSkuName || meter.skuName || res.sku;
        res.armSkuName = meter.armSkuName || res.armSkuName;
        res.serviceName = meter.serviceName;
        res.productName = meter.productName;
        res.skuName = meter.skuName;
      }
    }
    if (swap.quantity != null) res.quantity = Number(swap.quantity);

    applied.push({
      resourceId: swap.resourceId,
      ok: true,
      before,
      after: {
        sku: res.sku,
        meterId: res.meterId || null,
        type: res.type,
        quantity: res.quantity,
      },
    });
  }

  return { resources: next, applied };
}

// Baseline estimate vs after swaps.
async function runScenario(app, { overrides = {}, swaps = [] } = {}) {
  const baseEstimate = await estimateApplication(app, { overrides });
  const baseVars = applyVariables(app, overrides);
  const { resources: swappedResources, applied } = applySwaps(baseVars.resources, swaps);
  const projectedCosts = await calculateFullCosts(app, swappedResources, baseVars.variableState);

  const deltaMonthly = Math.round((projectedCosts.totalMonthly - baseEstimate.totalMonthly) * 100) / 100;
  const savingsMonthly = Math.round(-deltaMonthly * 100) / 100;
  const savingsAnnual = Math.round(savingsMonthly * 12 * 100) / 100;
  const savingsPct =
    baseEstimate.totalMonthly > 0
      ? Math.round((savingsMonthly / baseEstimate.totalMonthly) * 1000) / 10
      : 0;

  return {
    currency: baseEstimate.currency,
    base: {
      totalMonthly: baseEstimate.totalMonthly,
      totalAnnual: baseEstimate.totalAnnual,
      azureInfraMonthly: baseEstimate.costSummary?.azureInfraMonthly,
      lineItems: baseEstimate.lineItems,
    },
    projected: {
      totalMonthly: projectedCosts.totalMonthly,
      totalAnnual: Math.round(projectedCosts.totalMonthly * 12 * 100) / 100,
      azureInfraMonthly: projectedCosts.azureInfraMonthly,
      lineItems: projectedCosts.lineItems,
    },
    deltaMonthly,
    savingsMonthly,
    savingsAnnual,
    savingsPct,
    swaps: applied,
    region: getRegion(),
  };
}

// Per resource, suggest cheaper catalog SKUs (same-ish size class).
async function suggestSavings(app, { overrides = {}, limitPerResource = 6 } = {}) {
  const estimate = await estimateApplication(app, { overrides });
  const { resources } = applyVariables(app, overrides);
  const region = getRegion();
  const suggestions = [];

  for (const res of resources) {
    if (['vm', 'aks_node', 'aro_node'].includes(res.type) || (res.sku && String(res.sku).startsWith('Standard_'))) {
      const alts = retailCatalog.suggestVmAlternatives(res.sku || res.armSkuName, {
        region,
        limit: limitPerResource,
      });
      const currentLine = estimate.lineItems.find((i) => i.id === res.id);
      suggestions.push({
        resourceId: res.id,
        type: res.type,
        currentSku: res.sku,
        currentMonthly: currentLine?.monthlyCost ?? null,
        quantity: res.quantity,
        current: alts.current,
        alternatives: alts.alternatives.map((a) => ({
          ...a,
          projectedResourceMonthly: Math.round(a.monthly * res.quantity * 100) / 100,
          resourceSavingsMonthly:
            currentLine != null
              ? Math.round((currentLine.monthlyCost - a.monthly * res.quantity) * 100) / 100
              : Math.round((a.savingsMonthly || 0) * res.quantity * 100) / 100,
        })),
      });
    }
  }

  return {
    currency: estimate.currency,
    totalMonthly: estimate.totalMonthly,
    catalogReady: retailCatalog.isCatalogReady(),
    suggestions,
    region,
  };
}

module.exports = {
  applySwaps,
  runScenario,
  suggestSavings,
};
