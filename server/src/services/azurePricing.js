// Price lookup chain: full offline catalog → compact snapshot → baked fallbacks. Live Retail API only if AZURE_PRICING_ONLINE=true.

const priceCache = new Map();
let lastFetch = 0;

const { getRegionById, getRegionPriceFactor } = require('../data/azureRegions');
const { FALLBACK_PRICES, VM_SKU_MAP } = require('../data/azureFallbackPrices');
const { getActiveRegionId, setActiveRegionId: persistRegion } = require('./runtimeConfig');
const {
  getVmPriceFromSnapshot,
  getStoragePriceFromSnapshot,
  getStaticPriceFromSnapshot,
  getActiveSnapshot,
  ensureSnapshotExists,
} = require('./pricingSnapshot');
const retailCatalog = require('./retailCatalog');

const CURRENCY = process.env.AZURE_CURRENCY || 'AUD';

function isOnlinePricingEnabled() {
  return process.env.AZURE_PRICING_ONLINE === 'true';
}

function getRegion() {
  return getActiveRegionId();
}

function getArmRegionName(regionId) {
  const meta = getRegionById(regionId || getRegion());
  return meta?.armRegionName || 'AU East';
}

function clearPriceCache() {
  priceCache.clear();
  lastFetch = 0;
}

function setActiveRegion(regionId) {
  persistRegion(regionId);
  clearPriceCache();
  return getRegionById(regionId);
}

async function fetchAzureRetailPrices(filter) {
  const url = `https://prices.azure.com/api/retail/prices?currencyCode=${CURRENCY}&${filter}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Azure pricing API: ${res.status}`);
  const data = await res.json();
  return data.Items || [];
}

async function getVmMonthlyPrice(sku, regionId) {
  const region = regionId || getRegion();
  const cacheKey = `vm:${sku}:${region}:${CURRENCY}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);

  // 1 — full offline catalog (proper AUD retail when you've downloaded it)
  const fromCatalog = retailCatalog.getVmMonthlyFromCatalog(sku, region);
  if (fromCatalog != null) {
    priceCache.set(cacheKey, fromCatalog);
    return fromCatalog;
  }

  // 2 — compact snapshot on disk
  const snapshotPrice = getVmPriceFromSnapshot(sku, region);
  if (snapshotPrice != null) {
    priceCache.set(cacheKey, snapshotPrice);
    return snapshotPrice;
  }

  // 3 — hit Azure live (optional)
  if (isOnlinePricingEnabled()) {
    const armRegion = region;
    const filter = new URLSearchParams({
      '$filter': `serviceName eq 'Virtual Machines' and armSkuName eq '${sku}' and armRegionName eq '${armRegion}' and type eq 'Consumption'`,
    });

    try {
      const items = await fetchAzureRetailPrices(filter.toString());
      const linux = items.find(
        (i) =>
          i.currencyCode === CURRENCY &&
          (i.unitOfMeasure || '').toLowerCase().includes('hour') &&
          !/windows/i.test(`${i.productName} ${i.skuName}`) &&
          !/spot|low priority/i.test(`${i.productName} ${i.skuName}`)
      );
      const audItem = linux || items.find((i) => i.currencyCode === CURRENCY) || items[0];
      if (audItem) {
        const monthly = audItem.retailPrice * 730;
        priceCache.set(cacheKey, monthly);
        return monthly;
      }
    } catch (err) {
      console.warn(`Azure API unavailable for VM ${sku} (${armRegion}):`, err.message);
    }
  }

  const factor = getRegionPriceFactor(region);
  const fallback = (FALLBACK_PRICES.vm[sku] ?? 250) * factor;
  priceCache.set(cacheKey, fallback);
  return fallback;
}

async function getStoragePricePerGb(sku) {
  const region = getRegion();
  const cacheKey = `storage:${sku}:${region}:${CURRENCY}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);

  const fromCatalog = retailCatalog.getStoragePricePerGbFromCatalog(sku, region);
  if (fromCatalog != null) {
    priceCache.set(cacheKey, fromCatalog);
    return fromCatalog;
  }

  const snapshotPrice = getStoragePriceFromSnapshot(sku);
  if (snapshotPrice != null) {
    priceCache.set(cacheKey, snapshotPrice);
    return snapshotPrice;
  }

  if (isOnlinePricingEnabled()) {
    const skuFilters = {
      premium_ssd: "productName eq 'Premium SSD Managed Disks'",
      standard_ssd: "productName eq 'Standard SSD Managed Disks'",
      standard_hdd: "productName eq 'Standard HDD Managed Disks'",
      hot_blob: "productName eq 'Blob Storage' and skuName eq 'Hot LRS'",
      cool_blob: "productName eq 'Blob Storage' and skuName eq 'Cool LRS'",
    };
    const productFilter = skuFilters[sku];
    if (productFilter) {
      try {
        const filter = new URLSearchParams({
          '$filter': `${productFilter} and type eq 'Consumption' and armRegionName eq '${region}'`,
        });
        const items = await fetchAzureRetailPrices(filter.toString());
        const audItem = items.find((i) => i.currencyCode === CURRENCY && i.unitOfMeasure?.includes('GB'));
        if (audItem) {
          priceCache.set(cacheKey, audItem.retailPrice);
          return audItem.retailPrice;
        }
      } catch (err) {
        console.warn(`Azure API unavailable for storage ${sku}:`, err.message);
      }
    }
  }

  const fallback = FALLBACK_PRICES.storage[sku] ?? 0.1;
  priceCache.set(cacheKey, fallback);
  return fallback;
}

async function warmPriceCache(options = {}) {
  ensureSnapshotExists();
  lastFetch = Date.now();
  const regions = [getRegion(), 'australiaeast', 'australiacentral', 'australiacentral2'];
  const uniqueRegions = [...new Set(regions)];
  const skus = Object.keys(FALLBACK_PRICES.vm);

  await Promise.allSettled(
    uniqueRegions.flatMap((region) => skus.map((sku) => getVmMonthlyPrice(sku, region)))
  );
  await Promise.allSettled(
    Object.keys(FALLBACK_PRICES.storage).map((sku) => getStoragePricePerGb(sku))
  );

  if (options.forceOnline) {
    process.env.AZURE_PRICING_ONLINE = 'true';
  }
}

function getStaticPrice(type, sku) {
  const fromSnapshot = getStaticPriceFromSnapshot(type, sku);
  if (fromSnapshot != null) return fromSnapshot;
  const category = FALLBACK_PRICES[type];
  if (!category) return 0;
  return category[sku] ?? 0;
}

async function getResourceUnitPrice(resource) {
  const { type, sku, unit, meterId } = resource;
  const region = getRegion();

  // Catalog meter row — real retail component pricing
  if (type === 'azure_component' || type === 'azure_meter' || meterId) {
    const resolved = retailCatalog.resolveComponentPrice(
      {
        meterId,
        armSkuName: resource.armSkuName || (sku?.startsWith?.('Standard_') ? sku : null),
        sku,
        skuName: resource.skuName,
        serviceName: resource.serviceName,
        productName: resource.productName,
        quantity: 1,
      },
      region
    );
    if (resolved) {
      return {
        price: resolved.monthlyUnit,
        unit: 'month',
        currency: CURRENCY,
        meterId: resolved.meter?.meterId,
        retailUnitPrice: resolved.unitPrice,
        unitOfMeasure: resolved.meter?.unitOfMeasure,
        productName: resolved.meter?.productName,
        source: resolved.source,
      };
    }
  }

  switch (type) {
    case 'vm':
    case 'aks_node':
    case 'aro_node':
      return { price: await getVmMonthlyPrice(sku), unit: 'month', currency: CURRENCY };

    case 'storage': {
      // Managed disk size SKU (S/E/P) — flat monthly per disk
      try {
        const { getManagedDiskUnitMonthly, getBlobPackPick } = require('./simpleOptions');
        const diskMonthly = getManagedDiskUnitMonthly(sku, region);
        if (diskMonthly != null) {
          return { price: diskMonthly, unit: 'disk/month', currency: CURRENCY, productName: sku };
        }
        const blobPack = getBlobPackPick(sku);
        if (blobPack) {
          const perGb = await getStoragePricePerGb(blobPack.storageSku);
          return {
            price: Math.round(perGb * blobPack.gb * 100) / 100,
            unit: 'pack/month',
            currency: CURRENCY,
            productName: blobPack.label || sku,
          };
        }
      } catch {
        /* require cycle — fall back to per-GB */
      }
      const perGb = await getStoragePricePerGb(sku);
      return { price: perGb, unit: 'GB/month', currency: CURRENCY };
    }

    case 'aks_control_plane':
      return { price: getStaticPrice('aks_control_plane', sku), unit: 'month', currency: CURRENCY };

    case 'aro_control_plane':
      return { price: getStaticPrice('aro_control_plane', sku) * 730, unit: 'month', currency: CURRENCY };

    case 'load_balancer':
    case 'app_gateway':
    case 'managed_cache':
      return { price: getStaticPrice(type, sku), unit: 'month', currency: CURRENCY };

    case 'managed_service': {
      const base = getStaticPrice('managed_service', sku);
      if (sku?.startsWith('event_hubs')) {
        return { price: base, unit: 'TU/month', currency: CURRENCY };
      }
      return { price: base, unit: 'month', currency: CURRENCY };
    }

    case 'license': {
      const perUnit = getStaticPrice('license', sku);
      return { price: perUnit, unit: unit || 'month', currency: CURRENCY };
    }

    case 'network':
      return { price: getStaticPrice('network', sku), unit: unit || 'GB', currency: CURRENCY };

    default:
      return { price: 0, unit: 'month', currency: CURRENCY };
  }
}

function getPricingConfig() {
  const regionId = getRegion();
  const meta = getRegionById(regionId);
  const snapshot = getActiveSnapshot();
  const catalogInfo = retailCatalog.getCatalogInfo();

  let source;
  if (catalogInfo.available) {
    source = `Full offline Azure retail catalog (${catalogInfo.itemCount.toLocaleString()} meters, ${catalogInfo.currency})`;
  } else if (snapshot) {
    source = `Offline pricing snapshot (${snapshot.source || 'local'}) — limited SKU set`;
  } else {
    source = 'Built-in AUD fallback rates';
  }

  return {
    region: regionId,
    regionLabel: meta?.label || regionId,
    regionDescription: meta?.description,
    currency: CURRENCY,
    source,
    offlineMode: !isOnlinePricingEnabled(),
    fullCatalog: catalogInfo,
    snapshotCapturedAt: snapshot?.capturedAt || null,
    snapshotUpdatedAt: snapshot?.updatedAt || snapshot?.capturedAt || null,
    cacheEntries: priceCache.size,
    lastWarm: lastFetch ? new Date(lastFetch).toISOString() : null,
  };
}

module.exports = {
  warmPriceCache,
  getVmMonthlyPrice,
  getStoragePricePerGb,
  getResourceUnitPrice,
  getPricingConfig,
  getRegion,
  setActiveRegion,
  clearPriceCache,
  FALLBACK_PRICES,
  CURRENCY,
  isOnlinePricingEnabled,
  VM_SKU_MAP,
};
