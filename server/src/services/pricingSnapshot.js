// Compact AUD pricing snapshot on disk — keeps estimates working air-gapped.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const AdmZip = require('adm-zip');
const { AZURE_REGIONS, getRegionPriceFactor } = require('../data/azureRegions');
const { FALLBACK_PRICES, CURRENCY } = require('../data/azureFallbackPrices');

const DATA_DIR = path.join(__dirname, '../../data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'azure-pricing-snapshot.json');
const PRICING_HISTORY_FILE = path.join(DATA_DIR, 'pricing-update-history.json');
const SNAPSHOT_JSON_NAME = 'azure-pricing-snapshot.json';

let activeSnapshot = null;

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeJson(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildBaselineSnapshot(notes = 'Baseline offline snapshot') {
  const vmPrices = {};
  for (const region of AZURE_REGIONS) {
    const factor = getRegionPriceFactor(region.id);
    vmPrices[region.id] = {};
    for (const [sku, price] of Object.entries(FALLBACK_PRICES.vm)) {
      vmPrices[region.id][sku] = Math.round(price * factor * 100) / 100;
    }
  }

  return {
    formatVersion: 1,
    currency: CURRENCY,
    capturedAt: new Date().toISOString(),
    capturedFrom: os.hostname(),
    source: 'baseline',
    notes,
    regionFactors: Object.fromEntries(
      AZURE_REGIONS.map((r) => [r.id, getRegionPriceFactor(r.id)])
    ),
    vmPrices,
    storagePrices: { ...FALLBACK_PRICES.storage },
    staticPrices: JSON.parse(JSON.stringify(FALLBACK_PRICES)),
  };
}

function validateSnapshot(data) {
  if (!data || data.formatVersion !== 1) {
    throw new Error('Invalid snapshot: formatVersion must be 1');
  }
  if (!data.vmPrices || typeof data.vmPrices !== 'object') {
    throw new Error('Invalid snapshot: vmPrices required');
  }
  if (!data.storagePrices || typeof data.storagePrices !== 'object') {
    throw new Error('Invalid snapshot: storagePrices required');
  }
  if (!data.staticPrices || typeof data.staticPrices !== 'object') {
    throw new Error('Invalid snapshot: staticPrices required');
  }
  return data;
}

function loadSnapshotFromDisk() {
  const data = readJson(SNAPSHOT_FILE, null);
  if (!data) return null;
  try {
    activeSnapshot = validateSnapshot(data);
    return activeSnapshot;
  } catch (err) {
    console.warn('Pricing snapshot invalid:', err.message);
    return null;
  }
}

function getActiveSnapshot() {
  if (activeSnapshot) return activeSnapshot;
  return loadSnapshotFromDisk();
}

function saveSnapshot(data) {
  const validated = validateSnapshot(data);
  validated.updatedAt = new Date().toISOString();
  writeJson(SNAPSHOT_FILE, validated);
  activeSnapshot = validated;
  return validated;
}

function ensureSnapshotExists() {
  if (getActiveSnapshot()) return getActiveSnapshot();
  const baseline = buildBaselineSnapshot('Auto-generated baseline for offline operation');
  return saveSnapshot(baseline);
}

function appendPricingHistory(entry) {
  const history = readJson(PRICING_HISTORY_FILE, { updates: [] });
  history.updates.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  history.updates = history.updates.slice(0, 30);
  writeJson(PRICING_HISTORY_FILE, history);
  return history.updates;
}

function getPricingHistory() {
  return readJson(PRICING_HISTORY_FILE, { updates: [] }).updates;
}

function countSnapshotEntries(snapshot) {
  const vmCount = Object.values(snapshot.vmPrices).reduce(
    (sum, region) => sum + Object.keys(region).length,
    0
  );
  const storageCount = Object.keys(snapshot.storagePrices).length;
  const staticCount = Object.values(snapshot.staticPrices).reduce(
    (sum, cat) => sum + (typeof cat === 'object' ? Object.keys(cat).length : 0),
    0
  );
  return { vmCount, storageCount, staticCount, total: vmCount + storageCount + staticCount };
}

function getSnapshotInfo() {
  const snapshot = getActiveSnapshot();
  if (!snapshot) {
    return {
      available: false,
      offlineReady: false,
      message: 'No pricing snapshot found',
    };
  }
  const counts = countSnapshotEntries(snapshot);
  return {
    available: true,
    offlineReady: true,
    currency: snapshot.currency,
    capturedAt: snapshot.capturedAt,
    updatedAt: snapshot.updatedAt || snapshot.capturedAt,
    source: snapshot.source || 'snapshot',
    notes: snapshot.notes || '',
    regions: Object.keys(snapshot.vmPrices),
    entryCounts: counts,
    history: getPricingHistory(),
  };
}

function getVmPriceFromSnapshot(sku, regionId) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;
  const regional = snapshot.vmPrices[regionId];
  if (regional && regional[sku] != null) return regional[sku];
  const east = snapshot.vmPrices.australiaeast?.[sku];
  if (east != null) {
    const factor = snapshot.regionFactors?.[regionId] ?? getRegionPriceFactor(regionId);
    return Math.round(east * factor * 100) / 100;
  }
  return null;
}

function getStoragePriceFromSnapshot(sku) {
  const snapshot = getActiveSnapshot();
  if (!snapshot) return null;
  return snapshot.storagePrices[sku] ?? null;
}

function getStaticPriceFromSnapshot(type, sku) {
  const snapshot = getActiveSnapshot();
  if (!snapshot?.staticPrices?.[type]) return null;
  const val = snapshot.staticPrices[type][sku];
  return val != null ? val : null;
}

async function exportSnapshotZip({ notes } = {}) {
  const snapshot = ensureSnapshotExists();
  const exportData = {
    ...snapshot,
    exportedAt: new Date().toISOString(),
    exportNotes: notes || '',
  };

  return new Promise((resolve, reject) => {
    const filename = `azure-pricing-${snapshot.currency.toLowerCase()}-${Date.now()}.zip`;
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];

    archive.on('error', reject);
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => {
      appendPricingHistory({
        action: 'export',
        filename,
        notes: notes || 'Pricing snapshot export',
        entryCounts: countSnapshotEntries(snapshot),
      });
      resolve({
        filename,
        buffer: Buffer.concat(chunks),
        snapshot: exportData,
      });
    });

    archive.append(JSON.stringify(exportData, null, 2), { name: SNAPSHOT_JSON_NAME });
    archive.append(
      JSON.stringify({
        formatVersion: 1,
        type: 'azure-pricing-package',
        currency: snapshot.currency,
        exportedAt: exportData.exportedAt,
      }, null, 2),
      { name: 'pricing-manifest.json' }
    );
    archive.finalize();
  });
}

async function importSnapshotZip(buffer, { notes } = {}) {
  if (!buffer?.length) throw new Error('Empty upload');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('Pricing package exceeds 20 MB limit');

  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Invalid ZIP file');
  }

  const entry = zip.getEntry(SNAPSHOT_JSON_NAME);
  if (!entry) {
    throw new Error(`ZIP must contain ${SNAPSHOT_JSON_NAME}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    throw new Error('Invalid JSON in pricing snapshot');
  }

  const previous = getActiveSnapshot();
  const validated = validateSnapshot(parsed);
  if (notes) validated.notes = notes;
  validated.source = validated.source || 'imported';
  validated.importedAt = new Date().toISOString();
  saveSnapshot(validated);

  appendPricingHistory({
    action: 'import',
    notes: notes || validated.notes || 'Imported pricing update',
    previousCapturedAt: previous?.capturedAt || null,
    capturedAt: validated.capturedAt,
    entryCounts: countSnapshotEntries(validated),
  });

  return {
    ok: true,
    snapshot: getSnapshotInfo(),
    entryCounts: countSnapshotEntries(validated),
  };
}

// Optional live pull into snapshot — only when online mode is on.
async function captureLiveSnapshot({ notes } = {}) {
  const {
    warmPriceCache,
    getVmMonthlyPrice,
    getStoragePricePerGb,
    getRegion,
    CURRENCY: currency,
  } = require('./azurePricing');

  process.env.AZURE_PRICING_ONLINE = 'true';
  await warmPriceCache({ forceOnline: true });

  const vmPrices = {};
  for (const region of AZURE_REGIONS) {
    vmPrices[region.id] = {};
    for (const sku of Object.keys(FALLBACK_PRICES.vm)) {
      vmPrices[region.id][sku] = await getVmMonthlyPrice(sku, region.id);
    }
  }

  const storagePrices = {};
  for (const sku of Object.keys(FALLBACK_PRICES.storage)) {
    storagePrices[sku] = await getStoragePricePerGb(sku);
  }

  delete process.env.AZURE_PRICING_ONLINE;

  const snapshot = saveSnapshot({
    formatVersion: 1,
    currency,
    capturedAt: new Date().toISOString(),
    capturedFrom: os.hostname(),
    source: 'azure-retail-api',
    notes: notes || 'Captured from Azure Retail Prices API',
    regionFactors: Object.fromEntries(
      AZURE_REGIONS.map((r) => [r.id, getRegionPriceFactor(r.id)])
    ),
    vmPrices,
    storagePrices,
    staticPrices: JSON.parse(JSON.stringify(FALLBACK_PRICES)),
    activeRegionAtCapture: getRegion(),
  });

  appendPricingHistory({
    action: 'capture',
    notes: snapshot.notes,
    entryCounts: countSnapshotEntries(snapshot),
  });

  return getSnapshotInfo();
}

// After a full catalog download, refresh the small snapshot the app model still reads.
function syncSnapshotFromCatalog(catalogObj) {
  const retail = require('./retailCatalog');
  const regionIds = AZURE_REGIONS.map((r) => r.id);
  const catalog = catalogObj || retail.getCatalog();
  if (!catalog?.items?.length) return null;

  const vmPrices = {};
  for (const region of regionIds) {
    vmPrices[region] = {};
  }

  // All unique arm SKUs (Linux-preferring resolution)
  // Compact snapshot only stores baseline + commonly sized SKUs; full catalog
  // remains the source of truth for every other meter.
  const armSkus = new Set(Object.keys(FALLBACK_PRICES.vm));
  const seriesHints = ['_D2', '_D4', '_D8', '_D16', '_E2', '_E4', '_E8', '_E16', '_F2', '_F4', '_B2', '_B4'];
  for (const item of catalog.items) {
    if (item.serviceName !== 'Virtual Machines' || !item.armSkuName) continue;
    if (seriesHints.some((h) => item.armSkuName.includes(h))) {
      armSkus.add(item.armSkuName);
    }
  }

  for (const region of regionIds) {
    for (const sku of armSkus) {
      const monthly = retail.getVmMonthlyFromCatalog(sku, region);
      if (monthly != null) {
        vmPrices[region][sku] = monthly;
      } else if (FALLBACK_PRICES.vm[sku] != null) {
        const factor = getRegionPriceFactor(region);
        vmPrices[region][sku] = Math.round(FALLBACK_PRICES.vm[sku] * factor * 100) / 100;
      }
    }
  }

  const storagePrices = { ...FALLBACK_PRICES.storage };
  const primaryRegion = catalog.meta?.region || 'australiaeast';
  for (const sku of Object.keys(FALLBACK_PRICES.storage)) {
    const fromCat = retail.getStoragePricePerGbFromCatalog(sku, primaryRegion);
    if (fromCat != null) storagePrices[sku] = fromCat;
  }

  const snapshot = saveSnapshot({
    formatVersion: 1,
    currency: catalog.meta?.currency || CURRENCY,
    capturedAt: catalog.meta?.downloadedAt || new Date().toISOString(),
    capturedFrom: os.hostname(),
    source: 'full-retail-catalog',
    notes: `Synced from full offline catalog (${catalog.items.length.toLocaleString()} meters)`,
    regionFactors: Object.fromEntries(
      AZURE_REGIONS.map((r) => [r.id, getRegionPriceFactor(r.id)])
    ),
    vmPrices,
    storagePrices,
    staticPrices: JSON.parse(JSON.stringify(FALLBACK_PRICES)),
    catalogItemCount: catalog.items.length,
    catalogServiceCount: catalog.meta?.serviceCount || null,
  });

  appendPricingHistory({
    action: 'sync-from-catalog',
    notes: snapshot.notes,
    entryCounts: countSnapshotEntries(snapshot),
  });

  return getSnapshotInfo();
}

module.exports = {
  SNAPSHOT_FILE,
  buildBaselineSnapshot,
  ensureSnapshotExists,
  getActiveSnapshot,
  getSnapshotInfo,
  getVmPriceFromSnapshot,
  getStoragePriceFromSnapshot,
  getStaticPriceFromSnapshot,
  saveSnapshot,
  loadSnapshotFromDisk,
  exportSnapshotZip,
  importSnapshotZip,
  captureLiveSnapshot,
  syncSnapshotFromCatalog,
  getPricingHistory,
  countSnapshotEntries,
};
