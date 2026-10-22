// Full offline Azure retail catalog (AUD) — gzip on disk, indexed for search + pricing without live API.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { AZURE_REGIONS } = require('../data/azureRegions');
const { FALLBACK_PRICES } = require('../data/azureFallbackPrices');

const DATA_DIR = path.join(__dirname, '../../data');
const CATALOG_FILE = path.join(DATA_DIR, 'azure-retail-catalog.json.gz');
const CATALOG_META_FILE = path.join(DATA_DIR, 'azure-retail-catalog-meta.json');
const HOURS_PER_MONTH = 730;
const CURRENCY = process.env.AZURE_CURRENCY || 'AUD';
const PAGE_SIZE = 1000;

/** @type {null | { meta: object, items: object[], byMeterId: Map, byArmSku: Map, byService: Map }} */
let catalog = null;

// One catalog download at a time — progress struct for the UI
let downloadJob = {
  status: 'idle', // idle | running | complete | error
  startedAt: null,
  finishedAt: null,
  region: null,
  pages: 0,
  itemsFetched: 0,
  itemsKept: 0,
  error: null,
  message: null,
  percent: 0,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// Slim meter row — enough for search and monthly AUD math
function compactItem(raw, regionId) {
  return {
    meterId: raw.meterId,
    serviceName: raw.serviceName || '',
    serviceFamily: raw.serviceFamily || '',
    serviceId: raw.serviceId || '',
    productName: raw.productName || '',
    productId: raw.productId || '',
    skuName: raw.skuName || '',
    skuId: raw.skuId || '',
    armSkuName: raw.armSkuName || '',
    meterName: raw.meterName || '',
    unitOfMeasure: raw.unitOfMeasure || '',
    retailPrice: Number(raw.retailPrice) || 0,
    unitPrice: Number(raw.unitPrice) || 0,
    type: raw.type || 'Consumption',
    region: regionId || raw.armRegionName || '',
    currency: raw.currencyCode || CURRENCY,
    tierMinimumUnits: Number(raw.tierMinimumUnits) || 0,
    isPrimaryMeterRegion: Boolean(raw.isPrimaryMeterRegion),
  };
}

function isWindowsMeter(item) {
  const hay = `${item.productName} ${item.skuName} ${item.meterName}`.toLowerCase();
  return hay.includes('windows') || hay.includes(' window');
}

function isLowPriorityOrSpot(item) {
  const hay = `${item.productName} ${item.skuName} ${item.meterName}`.toLowerCase();
  return (
    hay.includes('spot') ||
    hay.includes('low priority') ||
    hay.includes('lowpriority') ||
    hay.includes('cloud services')
  );
}

// Unit retail → rough monthly AUD for qty (VMs, GB, cores, etc.)
function monthlyFromUnitPrice(item, quantity = 1) {
  if (!item || item.retailPrice == null) return 0;
  const u = (item.unitOfMeasure || '').toLowerCase();
  const price = Number(item.retailPrice) || 0;
  const q = Number(quantity) || 0;

  // Hourly compute / managed services billed per hour
  if (u.includes('hour') || u === '1 hour' || u === '1/hour') {
    return price * HOURS_PER_MONTH * q;
  }
  // Per month / unit / month
  if (u.includes('month') || u.includes('/month')) {
    return price * q;
  }
  // Per day
  if (u.includes('day')) {
    return price * 30.4167 * q;
  }
  // Per GB (storage/bandwidth) — quantity already in GB
  if (u.includes('gb') || u.includes('1 gb') || u.includes('/gb')) {
    return price * q;
  }
  // Per 10K / 1M operations etc. — treat quantity as number of units of that meter
  if (u.includes('10k') || u.includes('10,000')) {
    return price * q;
  }
  if (u.includes('1m') || u.includes('1,000,000') || u.includes('million')) {
    return price * q;
  }
  // Default: quantity × retailPrice as monthly
  return price * q;
}

function unitPriceMonthly(item) {
  return monthlyFromUnitPrice(item, 1);
}

function buildIndexes(items) {
  const byMeterId = new Map();
  const byArmSku = new Map();
  const byService = new Map();

  for (const item of items) {
    if (item.meterId) byMeterId.set(item.meterId, item);

    if (item.armSkuName) {
      if (!byArmSku.has(item.armSkuName)) byArmSku.set(item.armSkuName, []);
      byArmSku.get(item.armSkuName).push(item);
    }

    const svc = item.serviceName || 'Other';
    if (!byService.has(svc)) byService.set(svc, []);
    byService.get(svc).push(item);
  }

  return { byMeterId, byArmSku, byService };
}

function getCatalogMetaFromDisk() {
  return readJson(CATALOG_META_FILE, null);
}

function loadCatalogFromDisk() {
  if (!fs.existsSync(CATALOG_FILE)) {
    catalog = null;
    return null;
  }
  try {
    const gz = fs.readFileSync(CATALOG_FILE);
    const json = zlib.gunzipSync(gz).toString('utf8');
    const data = JSON.parse(json);
    if (!Array.isArray(data.items)) throw new Error('Catalog missing items array');
    const indexes = buildIndexes(data.items);
    catalog = {
      meta: data.meta || getCatalogMetaFromDisk() || {},
      items: data.items,
      ...indexes,
    };
    console.log(
      `Retail catalog loaded: ${catalog.items.length.toLocaleString()} meters ` +
        `(${catalog.meta.region || '?'}, ${catalog.meta.currency || CURRENCY})`
    );
    return catalog;
  } catch (err) {
    console.warn('Failed to load retail catalog:', err.message);
    catalog = null;
    return null;
  }
}

function getCatalog() {
  if (catalog) return catalog;
  return loadCatalogFromDisk();
}

function isCatalogReady() {
  const c = getCatalog();
  return Boolean(c?.items?.length);
}

function getCatalogInfo() {
  const meta = getCatalogMetaFromDisk();
  const ready = isCatalogReady();
  const c = catalog;
  const fileSize = fs.existsSync(CATALOG_FILE) ? fs.statSync(CATALOG_FILE).size : 0;

  return {
    available: ready,
    offlineFull: ready,
    currency: meta?.currency || CURRENCY,
    region: meta?.region || null,
    regions: meta?.regions || (meta?.region ? [meta.region] : []),
    downloadedAt: meta?.downloadedAt || null,
    itemCount: meta?.itemCount || c?.items?.length || 0,
    serviceCount: meta?.serviceCount || c?.byService?.size || 0,
    vmSkuCount: meta?.vmSkuCount || 0,
    fileSizeBytes: fileSize,
    fileSizeMb: Math.round((fileSize / (1024 * 1024)) * 10) / 10,
    source: meta?.source || (ready ? 'azure-retail-api' : null),
    services: meta?.services || (c ? [...c.byService.keys()].sort() : []),
    download: { ...downloadJob },
    message: ready
      ? `Full offline catalog ready (${(meta?.itemCount || c.items.length).toLocaleString()} meters)`
      : 'No full retail catalog downloaded yet — only the small baseline snapshot is available.',
  };
}

function getDownloadStatus() {
  return { ...downloadJob, catalog: getCatalogInfo() };
}

async function fetchJson(url, { retries = 8 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const waitMs = Math.max(retryAfter * 1000, Math.min(60000, 2000 * 2 ** attempt));
        downloadJob.message = `Rate limited by Azure (${res.status}) — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})…`;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) throw new Error(`Azure Retail API ${res.status}: ${url.slice(0, 120)}`);
      return res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries && /fetch|network|timeout|aborted|ECONNRESET/i.test(err.message || '')) {
        const waitMs = Math.min(30000, 1500 * 2 ** attempt);
        downloadJob.message = `Network error — retrying in ${Math.round(waitMs / 1000)}s…`;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Azure Retail API request failed after retries');
}

function buildFirstPageUrl(scope) {
  // scope: { kind: 'region', regionId } | { kind: 'primary' }
  let filter;
  if (scope.kind === 'primary') {
    // Complete AUD rate card — every primary meter (all services/regions)
    filter = 'isPrimaryMeterRegion eq true';
  } else if (scope.kind === 'global') {
    filter = "armRegionName eq 'Global'";
  } else {
    filter = `armRegionName eq '${scope.regionId}'`;
  }
  const params = new URLSearchParams({
    currencyCode: CURRENCY,
    '$filter': filter,
  });
  return `https://prices.azure.com/api/retail/prices?${params.toString()}`;
}

// Pull Consumption meters to disk — regional (AU + Global) or complete (huge). Single job; poll getDownloadStatus().
async function downloadFullCatalog({ regions, notes, mode = 'regional' } = {}) {
  if (downloadJob.status === 'running') {
    return { ok: false, alreadyRunning: true, status: getDownloadStatus() };
  }

  const regionList = (regions?.length ? regions : AZURE_REGIONS.map((r) => r.id).slice(0, 1)).filter(Boolean);
  const scopes = [];
  if (mode === 'complete') {
    scopes.push({ kind: 'primary', label: 'Primary meter (all services, AUD)' });
  } else {
    for (const regionId of regionList) {
      scopes.push({ kind: 'region', regionId, label: regionId });
    }
    scopes.push({ kind: 'global', label: 'Global' });
  }

  downloadJob = {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    region: scopes.map((s) => s.label || s.regionId).join(', '),
    pages: 0,
    itemsFetched: 0,
    itemsKept: 0,
    error: null,
    message: 'Starting download from Azure Retail Prices API…',
    percent: 1,
    regions: regionList,
    mode,
  };

  setImmediate(() => runDownload(scopes, notes, mode).catch((err) => {
    downloadJob.status = 'error';
    downloadJob.error = err.message;
    downloadJob.message = `Download failed: ${err.message}`;
    downloadJob.finishedAt = new Date().toISOString();
    console.error('Retail catalog download failed:', err);
  }));

  return { ok: true, started: true, status: getDownloadStatus() };
}

async function runDownload(scopes, notes, mode) {
  const allItems = [];
  const seenMeters = new Set();
  let pageEstimate = mode === 'complete' ? 400 : 80;

  for (let si = 0; si < scopes.length; si++) {
    const scope = scopes[si];
    const label = scope.label || scope.regionId || scope.kind;
    downloadJob.message = `Downloading ${label} (${si + 1}/${scopes.length})…`;
    downloadJob.region = label;

    let url = buildFirstPageUrl(scope);
    let page = 0;

    while (url) {
      page += 1;
      downloadJob.pages += 1;
      const data = await fetchJson(url);
      const items = data.Items || data.items || [];
      downloadJob.itemsFetched += items.length;

      for (const raw of items) {
        const priceType = raw.priceType || raw.type || 'Consumption';
        if (priceType !== 'Consumption') continue;

        const regionTag = scope.kind === 'region'
          ? scope.regionId
          : (raw.armRegionName || scope.kind);
        const compact = compactItem(raw, regionTag);
        if (!compact.meterId) continue;
        // One record per meterId — regional scopes listed first so AU rates win over Global
        if (seenMeters.has(compact.meterId)) continue;
        seenMeters.add(compact.meterId);
        allItems.push(compact);
      }

      downloadJob.itemsKept = allItems.length;
      if (page > pageEstimate * 0.85) pageEstimate = Math.ceil(page * 1.25);
      const progressBase = (si / scopes.length) * 100;
      const pageProgress = Math.min(95, progressBase + (page / pageEstimate) * (100 / scopes.length));
      downloadJob.percent = Math.round(Math.min(98, Math.max(2, pageProgress)));
      downloadJob.message =
        `Downloading ${label}: page ${page}, ` +
        `${downloadJob.itemsFetched.toLocaleString()} fetched, ` +
        `${allItems.length.toLocaleString()} unique meters`;

      url = data.NextPageLink || data.nextPageLink || null;
      if (url) await new Promise((r) => setTimeout(r, 350));
    }
  }

  downloadJob.message = 'Building indexes and writing offline catalog…';
  downloadJob.percent = 99;

  const services = [...new Set(allItems.map((i) => i.serviceName).filter(Boolean))].sort();
  const vmSkus = new Set();
  for (const item of allItems) {
    if (item.serviceName === 'Virtual Machines' && item.armSkuName) {
      vmSkus.add(item.armSkuName);
    }
  }

  const regionIds = scopes.filter((s) => s.kind === 'region').map((s) => s.regionId);
  const meta = {
    formatVersion: 2,
    currency: CURRENCY,
    mode,
    regions: regionIds.length ? regionIds : ['primary-meter'],
    region: regionIds[0] || 'primary-meter',
    downloadedAt: new Date().toISOString(),
    source: 'azure-retail-api',
    notes: notes || (mode === 'complete'
      ? 'Complete primary-meter Azure retail catalog (Consumption, AUD)'
      : 'Regional + Global Azure retail catalog (Consumption, AUD)'),
    itemCount: allItems.length,
    serviceCount: services.length,
    vmSkuCount: vmSkus.size,
    services,
    hoursPerMonth: HOURS_PER_MONTH,
    scopes: scopes.map((s) => s.label || s.regionId || s.kind),
  };

  ensureDataDir();
  const payload = JSON.stringify({ meta, items: allItems });
  const gz = zlib.gzipSync(Buffer.from(payload, 'utf8'), { level: 6 });
  fs.writeFileSync(CATALOG_FILE, gz);
  writeJson(CATALOG_META_FILE, meta);

  const indexes = buildIndexes(allItems);
  catalog = { meta, items: allItems, ...indexes };

  try {
    const { syncSnapshotFromCatalog } = require('./pricingSnapshot');
    syncSnapshotFromCatalog(catalog);
    const { clearPriceCache } = require('./azurePricing');
    clearPriceCache();
  } catch (err) {
    console.warn('Could not sync baseline snapshot from catalog:', err.message);
  }

  downloadJob.status = 'complete';
  downloadJob.finishedAt = new Date().toISOString();
  downloadJob.percent = 100;
  downloadJob.itemsKept = allItems.length;
  downloadJob.message =
    `Offline catalog ready: ${allItems.length.toLocaleString()} meters, ` +
    `${services.length} services, ${vmSkus.size} VM SKUs (${CURRENCY})`;

  console.log(downloadJob.message);
}

function findByMeterId(meterId) {
  const c = getCatalog();
  if (!c) return null;
  return c.byMeterId.get(meterId) || null;
}

// Pick a VM meter — Linux, not spot, hourly; wander to Global if region row missing.
function findVmMeter(armSkuName, regionId) {
  const c = getCatalog();
  if (!c) return null;

  const all = (c.byArmSku.get(armSkuName) || []).filter((i) => {
    if (i.serviceName !== 'Virtual Machines') return false;
    if (isLowPriorityOrSpot(i)) return false;
    const u = (i.unitOfMeasure || '').toLowerCase();
    return u.includes('hour');
  });

  if (!all.length) return null;

  const ranked = all.slice().sort((a, b) => {
    const aw = isWindowsMeter(a) ? 1 : 0;
    const bw = isWindowsMeter(b) ? 1 : 0;
    if (aw !== bw) return aw - bw;
    if (regionId) {
      const ar = a.region === regionId ? 0 : 1;
      const br = b.region === regionId ? 0 : 1;
      if (ar !== br) return ar - br;
    }
    if (a.isPrimaryMeterRegion !== b.isPrimaryMeterRegion) {
      return a.isPrimaryMeterRegion ? -1 : 1;
    }
    if (a.tierMinimumUnits !== b.tierMinimumUnits) {
      return a.tierMinimumUnits - b.tierMinimumUnits;
    }
    return a.retailPrice - b.retailPrice;
  });

  return ranked[0];
}

function getVmMonthlyFromCatalog(armSkuName, regionId) {
  const meter = findVmMeter(armSkuName, regionId);
  if (!meter) return null;
  return Math.round(unitPriceMonthly(meter) * 100) / 100;
}

// Match our storageSku keys to catalog product name patterns
const STORAGE_PRODUCT_MATCHERS = {
  premium_ssd: (i) =>
    /premium ssd/i.test(i.productName) &&
    /managed disks/i.test(i.productName) &&
    /p10|p15|p20|1 gb|gb\/month|units/i.test(`${i.skuName} ${i.meterName} ${i.unitOfMeasure}`),
  standard_ssd: (i) =>
    /standard ssd/i.test(i.productName) && /managed disks/i.test(i.productName),
  standard_hdd: (i) =>
    (/standard hdd/i.test(i.productName) || /standard hdd managed/i.test(i.productName)) &&
    /managed disks|disk/i.test(i.productName),
  hot_blob: (i) =>
    /blob storage|storage -|azure data lake/i.test(i.productName) &&
    /hot/i.test(`${i.skuName} ${i.meterName}`) &&
    /lrs/i.test(`${i.skuName} ${i.meterName} ${i.productName}`),
  cool_blob: (i) =>
    /blob storage|storage -/i.test(i.productName) &&
    /cool/i.test(`${i.skuName} ${i.meterName}`),
  ultra_ssd: (i) => /ultra.*(disk|ssd)/i.test(i.productName),
};

function getStoragePricePerGbFromCatalog(storageSku, regionId) {
  const c = getCatalog();
  if (!c) return null;
  const matcher = STORAGE_PRODUCT_MATCHERS[storageSku];
  if (!matcher) return null;

  const candidates = c.items.filter((i) => {
    if (regionId && i.region && i.region !== regionId) return false;
    if (!matcher(i)) return false;
    const u = (i.unitOfMeasure || '').toLowerCase();
    return u.includes('gb') || u.includes('unit');
  });

  if (!candidates.length) return null;

  // Prefer entries that look like GB/month capacity
  const ranked = candidates.slice().sort((a, b) => {
    const aGb = /gb/i.test(a.unitOfMeasure) ? 0 : 1;
    const bGb = /gb/i.test(b.unitOfMeasure) ? 0 : 1;
    if (aGb !== bGb) return aGb - bGb;
    return a.retailPrice - b.retailPrice;
  });

  return ranked[0].retailPrice;
}

function searchCatalog({
  q = '',
  serviceName,
  serviceFamily,
  armSkuName,
  region,
  limit = 40,
  offset = 0,
  computeOnly = false,
} = {}) {
  const c = getCatalog();
  if (!c) {
    return { items: [], total: 0, catalogReady: false };
  }

  const query = (q || '').trim().toLowerCase();
  let pool = c.items;

  if (serviceName) {
    pool = c.byService.get(serviceName) || pool.filter((i) => i.serviceName === serviceName);
  }
  if (armSkuName) {
    pool = (c.byArmSku.get(armSkuName) || []).filter((i) => !serviceName || i.serviceName === serviceName);
  }
  if (serviceFamily) {
    pool = pool.filter((i) => i.serviceFamily === serviceFamily);
  }
  if (region) {
    pool = pool.filter((i) => !i.region || i.region === region);
  }
  if (computeOnly) {
    pool = pool.filter((i) => i.serviceName === 'Virtual Machines' && i.armSkuName);
  }

  let filtered = pool;
  if (query) {
    const terms = query.split(/\s+/).filter(Boolean);
    filtered = pool.filter((i) => {
      const hay = [
        i.serviceName,
        i.productName,
        i.skuName,
        i.armSkuName,
        i.meterName,
        i.serviceFamily,
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  // De-dupe by product+sku+arm+uom for search UX
  const seen = new Set();
  const unique = [];
  for (const item of filtered) {
    const key = `${item.serviceName}|${item.productName}|${item.skuName}|${item.armSkuName}|${item.unitOfMeasure}|${item.retailPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  // Prefer Linux, non-spot when listing VMs
  unique.sort((a, b) => {
    if (a.serviceName === 'Virtual Machines' && b.serviceName === 'Virtual Machines') {
      const aw = isWindowsMeter(a) ? 1 : 0;
      const bw = isWindowsMeter(b) ? 1 : 0;
      if (aw !== bw) return aw - bw;
      if (isLowPriorityOrSpot(a) !== isLowPriorityOrSpot(b)) {
        return isLowPriorityOrSpot(a) ? 1 : -1;
      }
    }
    return a.serviceName.localeCompare(b.serviceName) || a.productName.localeCompare(b.productName);
  });

  const total = unique.length;
  const slice = unique.slice(offset, offset + Math.min(limit, 100)).map((item) => ({
    ...item,
    monthlyUnitPrice: Math.round(unitPriceMonthly(item) * 10000) / 10000,
    monthlyEstimate: Math.round(unitPriceMonthly(item) * 100) / 100,
  }));

  return { items: slice, total, catalogReady: true, offset, limit };
}

function listServices() {
  const c = getCatalog();
  if (!c) return { services: [], catalogReady: false };

  const services = [...c.byService.entries()]
    .map(([name, items]) => ({
      name,
      count: items.length,
      family: items[0]?.serviceFamily || null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { services, catalogReady: true, total: services.length };
}

function listVmSkus({ region, q, limit = 80 } = {}) {
  const c = getCatalog();
  if (!c) return { skus: [], catalogReady: false };

  const skuMap = new Map();
  for (const item of c.items) {
    if (item.serviceName !== 'Virtual Machines' || !item.armSkuName) continue;
    if (region && item.region && item.region !== region) continue;
    if (isWindowsMeter(item) || isLowPriorityOrSpot(item)) continue;
    const u = (item.unitOfMeasure || '').toLowerCase();
    if (!u.includes('hour')) continue;

    const existing = skuMap.get(item.armSkuName);
    const monthly = unitPriceMonthly(item);
    if (!existing || monthly < existing.monthly) {
      skuMap.set(item.armSkuName, {
        armSkuName: item.armSkuName,
        skuName: item.skuName,
        productName: item.productName,
        meterId: item.meterId,
        hourly: item.retailPrice,
        monthly: Math.round(monthly * 100) / 100,
        region: item.region,
        currency: item.currency || CURRENCY,
      });
    }
  }

  let skus = [...skuMap.values()];
  if (q) {
    const query = q.toLowerCase();
    skus = skus.filter(
      (s) =>
        s.armSkuName.toLowerCase().includes(query) ||
        s.skuName.toLowerCase().includes(query) ||
        s.productName.toLowerCase().includes(query)
    );
  }
  skus.sort((a, b) => a.monthly - b.monthly || a.armSkuName.localeCompare(b.armSkuName));

  return {
    skus: skus.slice(0, limit),
    total: skus.length,
    catalogReady: true,
  };
}

// Cheaper/nearby VMs — same core count so we don't swap a 16-core master for a tiny box.
function suggestVmAlternatives(armSkuName, { region, limit = 12 } = {}) {
  const current = findVmMeter(armSkuName, region);
  const currentMonthly = current ? unitPriceMonthly(current) : null;
  const { skus } = listVmSkus({ region, limit: 500 });

  const coresMatch = String(armSkuName || '').match(/Standard_[A-Z]*(\d+)/i);
  const cores = coresMatch ? Number(coresMatch[1]) : null;
  const familyMatch = armSkuName.match(/Standard_([A-Z]+)/i);
  const family = familyMatch ? familyMatch[1][0] : null;
  const versionMatch = armSkuName.match(/_v(\d+)/i);
  const version = versionMatch ? versionMatch[1] : null;

  const scored = skus
    .filter((s) => s.armSkuName !== armSkuName)
    .filter((s) => {
      if (cores == null) return true;
      const m = s.armSkuName.match(/Standard_[A-Z]*(\d+)/i);
      if (!m) return false;
      return Number(m[1]) === cores;
    })
    .map((s) => {
      let score = 0;
      if (family && s.armSkuName.includes(`Standard_${family}`)) score += 3;
      if (version && s.armSkuName.includes(`_v${version}`)) score += 2;
      if (currentMonthly != null && s.monthly < currentMonthly) score += 2;
      if (currentMonthly != null && s.monthly > currentMonthly * 1.5) score -= 2;
      const savings =
        currentMonthly != null ? Math.round((currentMonthly - s.monthly) * 100) / 100 : null;
      const savingsPct =
        currentMonthly && currentMonthly > 0
          ? Math.round(((currentMonthly - s.monthly) / currentMonthly) * 1000) / 10
          : null;
      return { ...s, score, savingsMonthly: savings, savingsPct, cores };
    })
    .sort((a, b) => b.score - a.score || (b.savingsMonthly || 0) - (a.savingsMonthly || 0));

  const savingsFirst = scored
    .filter((s) => (s.savingsMonthly || 0) > 0)
    .slice(0, limit);
  const rest = scored.filter((s) => !savingsFirst.includes(s)).slice(0, Math.max(0, limit - savingsFirst.length));

  return {
    current: current
      ? {
          armSkuName,
          meterId: current.meterId,
          productName: current.productName,
          hourly: current.retailPrice,
          monthly: Math.round(currentMonthly * 100) / 100,
          currency: CURRENCY,
          cores,
        }
      : { armSkuName, monthly: null, currency: CURRENCY, cores },
    alternatives: [...savingsFirst, ...rest].slice(0, limit),
    catalogReady: isCatalogReady(),
    sameCoreOnly: true,
  };
}

function resolveComponentPrice(component, regionId) {
  if (!component) return null;

  if (component.meterId) {
    const meter = findByMeterId(component.meterId);
    if (meter) {
      return {
        meter,
        unitPrice: meter.retailPrice,
        monthlyUnit: unitPriceMonthly(meter),
        monthly: monthlyFromUnitPrice(meter, component.quantity ?? 1),
        currency: CURRENCY,
        source: 'retail-catalog',
      };
    }
  }

  if (component.armSkuName || (component.sku && String(component.sku).startsWith('Standard_'))) {
    const sku = component.armSkuName || component.sku;
    const meter = findVmMeter(sku, regionId);
    if (meter) {
      return {
        meter,
        unitPrice: meter.retailPrice,
        monthlyUnit: unitPriceMonthly(meter),
        monthly: monthlyFromUnitPrice(meter, component.quantity ?? 1),
        currency: CURRENCY,
        source: 'retail-catalog',
      };
    }
  }

  // Free-text search best match
  if (component.serviceName || component.productName) {
    const result = searchCatalog({
      q: [component.productName, component.skuName, component.sku].filter(Boolean).join(' '),
      serviceName: component.serviceName,
      region: regionId,
      limit: 5,
    });
    if (result.items[0]) {
      const meter = result.items[0];
      return {
        meter,
        unitPrice: meter.retailPrice,
        monthlyUnit: unitPriceMonthly(meter),
        monthly: monthlyFromUnitPrice(meter, component.quantity ?? 1),
        currency: CURRENCY,
        source: 'retail-catalog-search',
      };
    }
  }

  return null;
}

// Path to gz catalog on disk (ZIP export lives in version/snapshot pack)
function getCatalogFilePath() {
  return CATALOG_FILE;
}

// VM list before catalog download — fall back to baseline AUD so templates aren't empty.
function listKnownVmSkusWithPrices(regionId) {
  const fromCatalog = listVmSkus({ region: regionId, limit: 300 });
  if (fromCatalog.catalogReady && fromCatalog.skus.length) return fromCatalog;

  const skus = Object.entries(FALLBACK_PRICES.vm).map(([armSkuName, monthly]) => ({
    armSkuName,
    skuName: armSkuName,
    productName: 'Baseline (offline fallback)',
    meterId: null,
    hourly: Math.round((monthly / HOURS_PER_MONTH) * 10000) / 10000,
    monthly,
    region: regionId || 'australiaeast',
    currency: CURRENCY,
    source: 'baseline',
  }));
  return { skus, total: skus.length, catalogReady: false };
}

// Load catalog on require when the gz file's already there
if (fs.existsSync(CATALOG_FILE)) {
  try {
    loadCatalogFromDisk();
  } catch {
    /* ignore at require-time */
  }
}

module.exports = {
  HOURS_PER_MONTH,
  CURRENCY,
  CATALOG_FILE,
  downloadFullCatalog,
  getDownloadStatus,
  getCatalogInfo,
  getCatalog,
  isCatalogReady,
  loadCatalogFromDisk,
  findByMeterId,
  findVmMeter,
  getVmMonthlyFromCatalog,
  getStoragePricePerGbFromCatalog,
  searchCatalog,
  listServices,
  listVmSkus,
  listKnownVmSkusWithPrices,
  suggestVmAlternatives,
  resolveComponentPrice,
  monthlyFromUnitPrice,
  unitPriceMonthly,
  getCatalogFilePath,
};
