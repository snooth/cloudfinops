// Simulate tab pricing — AU only, human labels, qty × AUD, no calculator rabbit hole.

const retailCatalog = require('./retailCatalog');
const { FALLBACK_PRICES } = require('../data/azureFallbackPrices');
const { coresFromSku, ramGbFromSku, vmSpecs, formatRamGb } = require('./vmSpecs');

// Simulator regions — AU East + AU Central only
const SIMULATOR_REGIONS = [
  {
    id: 'australiaeast',
    label: 'AU East',
    short: 'Sydney / NSW',
  },
  {
    id: 'australiacentral',
    label: 'AU Central',
    short: 'Canberra',
  },
];

// Curated VM picks — not the entire Azure catalogue
const VM_PICKS = [
  { armSkuName: 'Standard_B2s', label: 'Tiny', blurb: '2 vCPU · 4 GB', cores: 2, ramGb: 4 },
  { armSkuName: 'Standard_D2s_v5', label: 'Small', blurb: '2 vCPU · 8 GB', cores: 2, ramGb: 8 },
  { armSkuName: 'Standard_D4s_v5', label: 'Medium', blurb: '4 vCPU · 16 GB', cores: 4, ramGb: 16 },
  { armSkuName: 'Standard_D8s_v5', label: 'Large', blurb: '8 vCPU · 32 GB', cores: 8, ramGb: 32 },
  { armSkuName: 'Standard_D16s_v5', label: 'X-Large', blurb: '16 vCPU · 64 GB', cores: 16, ramGb: 64 },
  { armSkuName: 'Standard_D32s_v5', label: '2X-Large', blurb: '32 vCPU · 128 GB', cores: 32, ramGb: 128 },
  { armSkuName: 'Standard_E4s_v5', label: 'Memory medium', blurb: '4 vCPU · 32 GB RAM', cores: 4, ramGb: 32 },
  { armSkuName: 'Standard_E8s_v5', label: 'Memory large', blurb: '8 vCPU · 64 GB RAM', cores: 8, ramGb: 64 },
  { armSkuName: 'Standard_E16s_v5', label: 'Memory X-Large', blurb: '16 vCPU · 128 GB RAM', cores: 16, ramGb: 128 },
];

// Managed disk size rows — unitMonthlyAud is rough LRS AUD/month (AU East calc vibes).
const DISK_PICKS = [
  // Standard HDD — S series
  { id: 'S4',  azureSku: 'S4',  label: 'S4 · HDD · 32 GB',   storageSku: 'standard_hdd', gb: 32,    unitMonthlyAud: 3.55 },
  { id: 'S6',  azureSku: 'S6',  label: 'S6 · HDD · 64 GB',   storageSku: 'standard_hdd', gb: 64,    unitMonthlyAud: 6.95 },
  { id: 'S10', azureSku: 'S10', label: 'S10 · HDD · 128 GB', storageSku: 'standard_hdd', gb: 128,   unitMonthlyAud: 13.61 },
  { id: 'S15', azureSku: 'S15', label: 'S15 · HDD · 256 GB', storageSku: 'standard_hdd', gb: 256,   unitMonthlyAud: 26.18 },
  { id: 'S20', azureSku: 'S20', label: 'S20 · HDD · 512 GB', storageSku: 'standard_hdd', gb: 512,   unitMonthlyAud: 50.28 },
  { id: 'S30', azureSku: 'S30', label: 'S30 · HDD · 1 TB',   storageSku: 'standard_hdd', gb: 1024,  unitMonthlyAud: 94.64 },
  { id: 'S40', azureSku: 'S40', label: 'S40 · HDD · 2 TB',   storageSku: 'standard_hdd', gb: 2048,  unitMonthlyAud: 189.28 },
  { id: 'S50', azureSku: 'S50', label: 'S50 · HDD · 4 TB',   storageSku: 'standard_hdd', gb: 4096,  unitMonthlyAud: 378.57 },
  { id: 'S60', azureSku: 'S60', label: 'S60 · HDD · 8 TB',   storageSku: 'standard_hdd', gb: 8192,  unitMonthlyAud: 757.15 },
  { id: 'S70', azureSku: 'S70', label: 'S70 · HDD · 16 TB',  storageSku: 'standard_hdd', gb: 16384, unitMonthlyAud: 1514.3 },
  { id: 'S80', azureSku: 'S80', label: 'S80 · HDD · 32 TB',  storageSku: 'standard_hdd', gb: 32767, unitMonthlyAud: 3028.59 },

  // Standard SSD — E series (approx from per-tier AU retail scale)
  { id: 'E4',  azureSku: 'E4',  label: 'E4 · SSD · 32 GB',   storageSku: 'standard_ssd', gb: 32 },
  { id: 'E6',  azureSku: 'E6',  label: 'E6 · SSD · 64 GB',   storageSku: 'standard_ssd', gb: 64 },
  { id: 'E10', azureSku: 'E10', label: 'E10 · SSD · 128 GB', storageSku: 'standard_ssd', gb: 128 },
  { id: 'E15', azureSku: 'E15', label: 'E15 · SSD · 256 GB', storageSku: 'standard_ssd', gb: 256 },
  { id: 'E20', azureSku: 'E20', label: 'E20 · SSD · 512 GB', storageSku: 'standard_ssd', gb: 512 },
  { id: 'E30', azureSku: 'E30', label: 'E30 · SSD · 1 TB',   storageSku: 'standard_ssd', gb: 1024 },
  { id: 'E40', azureSku: 'E40', label: 'E40 · SSD · 2 TB',   storageSku: 'standard_ssd', gb: 2048 },
  { id: 'E50', azureSku: 'E50', label: 'E50 · SSD · 4 TB',   storageSku: 'standard_ssd', gb: 4096 },
  { id: 'E60', azureSku: 'E60', label: 'E60 · SSD · 8 TB',   storageSku: 'standard_ssd', gb: 8192 },

  // Premium SSD v2 / Premium SSD — full P series (Microsoft calculator AUD AU East)
  { id: 'P1',  azureSku: 'P1',  label: 'P1 · Premium SSD · 4 GB',    storageSku: 'premium_ssd', gb: 4,     unitMonthlyAud: 0.87 },
  { id: 'P2',  azureSku: 'P2',  label: 'P2 · Premium SSD · 8 GB',    storageSku: 'premium_ssd', gb: 8,     unitMonthlyAud: 1.73 },
  { id: 'P3',  azureSku: 'P3',  label: 'P3 · Premium SSD · 16 GB',   storageSku: 'premium_ssd', gb: 16,    unitMonthlyAud: 3.47 },
  { id: 'P4',  azureSku: 'P4',  label: 'P4 · Premium SSD · 32 GB',   storageSku: 'premium_ssd', gb: 32,    unitMonthlyAud: 7.62 },
  { id: 'P6',  azureSku: 'P6',  label: 'P6 · Premium SSD · 64 GB',   storageSku: 'premium_ssd', gb: 64,    unitMonthlyAud: 14.74 },
  { id: 'P10', azureSku: 'P10', label: 'P10 · Premium SSD · 128 GB', storageSku: 'premium_ssd', gb: 128,   unitMonthlyAud: 28.46 },
  { id: 'P15', azureSku: 'P15', label: 'P15 · Premium SSD · 256 GB', storageSku: 'premium_ssd', gb: 256,   unitMonthlyAud: 54.9 },
  { id: 'P20', azureSku: 'P20', label: 'P20 · Premium SSD · 512 GB', storageSku: 'premium_ssd', gb: 512,   unitMonthlyAud: 105.74 },
  { id: 'P30', azureSku: 'P30', label: 'P30 · Premium SSD · 1 TB',   storageSku: 'premium_ssd', gb: 1024,  unitMonthlyAud: 195.21 },
  { id: 'P40', azureSku: 'P40', label: 'P40 · Premium SSD · 2 TB',   storageSku: 'premium_ssd', gb: 2048,  unitMonthlyAud: 374.1 },
  { id: 'P50', azureSku: 'P50', label: 'P50 · Premium SSD · 4 TB',   storageSku: 'premium_ssd', gb: 4096,  unitMonthlyAud: 715.67 },
  { id: 'P60', azureSku: 'P60', label: 'P60 · Premium SSD · 8 TB',   storageSku: 'premium_ssd', gb: 8192,  unitMonthlyAud: 1366.28 },
  { id: 'P70', azureSku: 'P70', label: 'P70 · Premium SSD · 16 TB',  storageSku: 'premium_ssd', gb: 16384, unitMonthlyAud: 2602.44 },
  { id: 'P80', azureSku: 'P80', label: 'P80 · Premium SSD · 32 TB',  storageSku: 'premium_ssd', gb: 32767, unitMonthlyAud: 5204.87 },
];

const BLOB_PICKS = [
  { id: 'hot_1tb', label: 'Hot blob · 1 TB', storageSku: 'hot_blob', gb: 1024 },
  { id: 'hot_5tb', label: 'Hot blob · 5 TB', storageSku: 'hot_blob', gb: 5120 },
  { id: 'hot_10tb', label: 'Hot blob · 10 TB', storageSku: 'hot_blob', gb: 10240 },
  { id: 'hot_50tb', label: 'Hot blob · 50 TB', storageSku: 'hot_blob', gb: 51200 },
  { id: 'hot_100tb', label: 'Hot blob · 100 TB', storageSku: 'hot_blob', gb: 102400 },
  { id: 'cool_1tb', label: 'Cool blob · 1 TB', storageSku: 'cool_blob', gb: 1024 },
  { id: 'cool_10tb', label: 'Cool blob · 10 TB', storageSku: 'cool_blob', gb: 10240 },
  { id: 'cool_100tb', label: 'Cool blob · 100 TB', storageSku: 'cool_blob', gb: 102400 },
];

// ISV/platform licence picks (AUD/month) — ARO/SUSE-style stuff also comes from catalog meters when we have them.
const SOFTWARE_PICKS = [
  { id: 'sw_cdp_private_cloud', label: 'Cloudera CDP Private Cloud Base', blurb: 'Platform licence', unitMonthly: FALLBACK_PRICES.license.cdp_private_cloud_base },
  { id: 'sw_cloudera_cds', label: 'Cloudera Data Services (node)', blurb: 'Per CDS node', unitMonthly: FALLBACK_PRICES.license.cloudera_cds_node },
  { id: 'sw_sql_enterprise_8', label: 'SQL Server Enterprise (8-core pack)', blurb: 'Core licence pack', unitMonthly: FALLBACK_PRICES.license.sql_enterprise_8core },
  { id: 'sw_sql_standard_core', label: 'SQL Server Standard (per core)', blurb: 'Per core / month', unitMonthly: FALLBACK_PRICES.license.sql_standard_core },
  { id: 'sw_openshift_core', label: 'OpenShift (per core fallback)', blurb: 'When catalog meter not used', unitMonthly: FALLBACK_PRICES.license.openshift_per_core },
  { id: 'sw_neo4j', label: 'Neo4j Enterprise (per core)', blurb: 'Graph platform', unitMonthly: FALLBACK_PRICES.license.neo4j_enterprise_core },
  { id: 'sw_alation', label: 'Alation Enterprise', blurb: 'Data catalog', unitMonthly: FALLBACK_PRICES.license.alation_enterprise },
  { id: 'sw_infoarchive_tb', label: 'InfoArchive (per TB)', blurb: 'Archive platform', unitMonthly: FALLBACK_PRICES.license.infoarchive_tb },
  { id: 'sw_powerbi_pro', label: 'Power BI Pro (per user)', blurb: 'Self-service BI', unitMonthly: FALLBACK_PRICES.license.powerbi_pro_user },
  { id: 'sw_powerbi_premium', label: 'Power BI Premium capacity', blurb: 'Shared capacity', unitMonthly: FALLBACK_PRICES.license.powerbi_premium_capacity },
  { id: 'sw_rds_cal', label: 'RDS CAL (per user)', blurb: 'Remote desktop', unitMonthly: FALLBACK_PRICES.license.rds_cal_user },
  { id: 'sw_hashicorp', label: 'HashiCorp client', blurb: 'Vault / Terraform client', unitMonthly: FALLBACK_PRICES.license.hashicorp_client },
  { id: 'sw_erwin', label: 'erwin Data Modeler (seat)', blurb: 'Modeling seat', unitMonthly: FALLBACK_PRICES.license.erwin_modeler_seat },
  { id: 'sw_gitlab', label: 'GitLab Premium (per user)', blurb: 'Dev platform', unitMonthly: FALLBACK_PRICES.license.gitlab_premium_user },
  { id: 'sw_sap_s4', label: 'SAP S/4HANA Cloud Private', blurb: 'ERP suite', unitMonthly: FALLBACK_PRICES.license.sap_s4hana_cloud_private },
];

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function storagePerGb(sku, regionId) {
  const fromCat = retailCatalog.getStoragePricePerGbFromCatalog(sku, regionId);
  if (fromCat != null) return fromCat;
  return FALLBACK_PRICES.storage[sku] ?? 0.1;
}

function diskUnitMonthly(pick, regionId) {
  // Prefer published per-disk monthly for managed disk SKUs (matches Azure Pxx prices)
  if (pick.unitMonthlyAud != null) {
    const factor = regionId === 'australiacentral' ? 1.02 : 1.0;
    return money(pick.unitMonthlyAud * factor);
  }
  const perGb = storagePerGb(pick.storageSku, regionId);
  return money(perGb * pick.gb);
}

function vmMonthly(armSkuName, regionId) {
  const fromCat = retailCatalog.getVmMonthlyFromCatalog(armSkuName, regionId);
  if (fromCat != null) return fromCat;
  return FALLBACK_PRICES.vm[armSkuName] ?? null;
}

// Series label from SKU — Standard_E64s_v5 → Esv5
function seriesFromSku(armSkuName, productName = '') {
  if (productName) {
    const seriesMatch = productName.match(/([A-Za-z0-9]+)\s+Series/i);
    if (seriesMatch) return seriesMatch[1].replace(/\s+/g, '');
  }
  const m = String(armSkuName || '').match(/^Standard_([A-Z]+)(\d+)(?:-\d+)?([a-z]*)_v(\d+)/i);
  if (m) {
    const family = m[1];
    const suffixes = m[3] || '';
    const version = m[4];
    return `${family}${suffixes}v${version}`;
  }
  const m2 = String(armSkuName || '').match(/^Standard_([A-Z]+)(\d+)([a-z]*)/i);
  if (m2) return `${m2[1]}${m2[3] || ''}`.trim();
  return 'Other';
}

function enrichVmOption(base) {
  const arm = base.armSkuName || base.id;
  const specs = vmSpecs(arm);
  const cores = base.cores != null ? base.cores : specs.cores;
  const ramGb = base.ramGb != null ? base.ramGb : specs.ramGb;
  const specLabel = specs.label || [
    cores != null ? `${cores} vCPU` : null,
    formatRamGb(ramGb),
  ].filter(Boolean).join(' · ');

  const series = base.series || seriesFromSku(arm, base.productName);
  let blurb = base.blurb || base.productName || series || '';
  // Prefer clean "series · specs" when blurb was only series/product name
  if (specLabel) {
    if (!blurb || blurb === series || /Series/i.test(blurb)) {
      blurb = [series, specLabel].filter(Boolean).join(' · ');
    } else if (!/\d+\s*vCPU/i.test(blurb) && !/\d+\s*GB/i.test(blurb)) {
      blurb = `${blurb} · ${specLabel}`;
    }
  }

  return {
    ...base,
    cores,
    ramGb,
    specLabel,
    series,
    blurb,
  };
}

// Filter to real Standard_* VM SKUs — skip catalog noise (Esv5_Type1, etc.)
function isRealVmSku(armSkuName) {
  return /^Standard_[A-Za-z]+\d/i.test(String(armSkuName || ''));
}

function buildAllVmOptions(regionId) {
  const { skus, catalogReady } = retailCatalog.listVmSkus({ region: regionId, limit: 5000 });
  const fromCatalog = (skus || [])
    .filter((s) => isRealVmSku(s.armSkuName))
    .map((s) => {
      const series = seriesFromSku(s.armSkuName, s.productName);
      return enrichVmOption({
        id: s.armSkuName,
        type: 'vm',
        label: s.armSkuName.replace(/^Standard_/, ''),
        blurb: s.productName || series,
        series,
        armSkuName: s.armSkuName,
        unitMonthly: money(s.monthly),
        unitLabel: 'per machine / month',
        productName: s.productName,
      });
    });

  // Ensure popular / app defaults are present even if catalog thin
  const seen = new Set(fromCatalog.map((o) => o.armSkuName));
  for (const pick of VM_PICKS) {
    if (seen.has(pick.armSkuName)) continue;
    const unitMonthly = vmMonthly(pick.armSkuName, regionId);
    if (unitMonthly == null) continue;
    fromCatalog.push(
      enrichVmOption({
        id: pick.armSkuName,
        type: 'vm',
        label: pick.armSkuName.replace(/^Standard_/, ''),
        blurb: pick.blurb,
        series: seriesFromSku(pick.armSkuName),
        armSkuName: pick.armSkuName,
        cores: pick.cores,
        ramGb: pick.ramGb,
        unitMonthly: money(unitMonthly),
        unitLabel: 'per machine / month',
      })
    );
  }

  fromCatalog.sort((a, b) => {
    const sc = String(a.series).localeCompare(String(b.series));
    if (sc !== 0) return sc;
    if ((a.cores || 0) !== (b.cores || 0)) return (a.cores || 0) - (b.cores || 0);
    if ((a.ramGb || 0) !== (b.ramGb || 0)) return (a.ramGb || 0) - (b.ramGb || 0);
    return a.armSkuName.localeCompare(b.armSkuName);
  });

  return { options: fromCatalog, catalogReady };
}

// Software/licence lines for Simulate — catalog "Virtual Machines Licenses" + our ISV picks.
function buildSoftwareOptions() {
  const options = [];
  const seen = new Set();

  // Azure retail: Virtual Machines Licenses (usually Global region)
  try {
    const { items, catalogReady } = retailCatalog.searchCatalog({
      serviceName: 'Virtual Machines Licenses',
      limit: 100,
    });
    for (const item of items || []) {
      const monthly = money(item.monthlyEstimate ?? item.monthlyUnitPrice ?? 0);
      if (!(monthly > 0)) continue;
      const sku = item.skuName || item.meterName || '';
      if (/Trial|BYOS|Free|Tracking|AHB|Hybrid Benefit/i.test(`${item.productName} ${sku}`)) continue;
      if (/ARO$|AROO$/i.test(sku) && monthly < 20) continue;

      const id = item.meterId
        ? `sw_meter_${item.meterId}`
        : `sw_${String(item.productName).slice(0, 24)}_${sku}`.replace(/[^a-zA-Z0-9]+/g, '_');
      if (seen.has(id)) continue;
      seen.add(id);

      const shortProduct = String(item.productName || 'Azure licence')
        .replace(/^Azure\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      options.push({
        id,
        type: 'software',
        label: `${shortProduct} · ${sku}`,
        blurb: item.serviceName || 'Virtual Machines Licenses',
        productName: item.productName,
        skuName: sku,
        meterId: item.meterId || null,
        unitMonthly: monthly,
        unitLabel: 'per unit / month',
        source: 'catalog',
      });
    }

    // Optional: Microsoft Defender for Cloud (often on bills with ARO)
    const defender = retailCatalog.searchCatalog({
      serviceName: 'Microsoft Defender for Cloud',
      limit: 40,
    });
    for (const item of defender.items || []) {
      const monthly = money(item.monthlyEstimate ?? 0);
      if (!(monthly > 0)) continue;
      if (!/Server|Servers|CSPM|Node/i.test(`${item.productName} ${item.skuName} ${item.meterName}`)) continue;
      const id = item.meterId ? `sw_def_${item.meterId}` : `sw_def_${item.skuName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      options.push({
        id,
        type: 'software',
        label: `Defender · ${item.skuName || item.meterName || item.productName}`,
        blurb: item.productName || 'Microsoft Defender for Cloud',
        productName: item.productName,
        skuName: item.skuName,
        meterId: item.meterId || null,
        unitMonthly: monthly,
        unitLabel: 'per unit / month',
        source: 'catalog',
      });
    }

    // Fallthrough if catalog thin
    void catalogReady;
  } catch {
    /* catalog optional */
  }

  for (const pick of SOFTWARE_PICKS) {
    if (seen.has(pick.id)) continue;
    seen.add(pick.id);
    options.push({
      id: pick.id,
      type: 'software',
      label: pick.label,
      blurb: pick.blurb,
      unitMonthly: money(pick.unitMonthly),
      unitLabel: 'per unit / month',
      source: 'platform',
    });
  }

  options.sort((a, b) => {
    const src = String(a.source).localeCompare(String(b.source));
    if (src !== 0) return src;
    return a.label.localeCompare(b.label);
  });

  return {
    options,
    catalogReady: retailCatalog.isCatalogReady(),
  };
}

// Simulator menu payload — VMs, disks, blob packs, software (opts: series, q, limit).
function getSimpleOptions(regionId = 'australiaeast', opts = {}) {
  if (typeof regionId === 'object') {
    opts = regionId;
    regionId = opts.regionId || opts.region || 'australiaeast';
  }
  const region = SIMULATOR_REGIONS.find((r) => r.id === regionId)?.id || 'australiaeast';
  const vmSeries = (opts.vmSeries || opts.series || '').trim();
  const vmQuery = (opts.vmQuery || opts.q || '').trim().toLowerCase();
  const vmLimit = opts.vmLimit ? Number(opts.vmLimit) : undefined;

  const { options: allVms, catalogReady } = buildAllVmOptions(region);

  let virtualMachines = allVms;
  if (vmSeries) {
    const s = vmSeries.toLowerCase();
    virtualMachines = virtualMachines.filter(
      (o) =>
        String(o.series).toLowerCase() === s ||
        String(o.series).toLowerCase().includes(s) ||
        String(o.blurb).toLowerCase().includes(s) ||
        String(o.armSkuName).toLowerCase().includes(s)
    );
  }
  if (vmQuery) {
    virtualMachines = virtualMachines.filter((o) => {
      const hay = `${o.armSkuName} ${o.label} ${o.blurb} ${o.series}`.toLowerCase();
      return hay.includes(vmQuery);
    });
  }
  const totalVmCount = virtualMachines.length;
  if (vmLimit && virtualMachines.length > vmLimit) {
    virtualMachines = virtualMachines.slice(0, vmLimit);
  }

  const seriesList = [...new Set(allVms.map((o) => o.series).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  const managedDisks = DISK_PICKS.map((pick) => {
    const unitMonthly = diskUnitMonthly(pick, region);
    let blurb = 'Standard SSD managed disk';
    if (pick.storageSku === 'premium_ssd') blurb = 'Premium SSD managed disk';
    if (pick.storageSku === 'standard_hdd') blurb = 'Standard HDD managed disk';
    return {
      id: pick.id,
      type: 'disk',
      label: pick.label,
      blurb,
      azureSku: pick.azureSku || pick.id,
      storageSku: pick.storageSku,
      gb: pick.gb,
      unitMonthly,
      unitLabel: 'per disk / month',
    };
  });

  const blobStorage = BLOB_PICKS.map((pick) => {
    const perGb = storagePerGb(pick.storageSku, region);
    const unitMonthly = money(perGb * pick.gb);
    return {
      id: pick.id,
      type: 'blob',
      label: pick.label,
      blurb: pick.storageSku === 'hot_blob' ? 'Frequently accessed data' : 'Cheap archival-style data',
      storageSku: pick.storageSku,
      gb: pick.gb,
      unitMonthly,
      unitLabel: 'per block / month',
    };
  });

  const { options: allSoftware } = buildSoftwareOptions();
  let software = allSoftware;
  if (vmQuery) {
    software = software.filter((o) => {
      const hay = `${o.label} ${o.blurb} ${o.productName || ''} ${o.skuName || ''}`.toLowerCase();
      return hay.includes(vmQuery);
    });
  }

  return {
    currency: 'AUD',
    region,
    regions: SIMULATOR_REGIONS,
    catalogReady: catalogReady || retailCatalog.isCatalogReady(),
    vmSeries: seriesList,
    vmTotalAvailable: allVms.length,
    vmMatched: totalVmCount,
    softwareTotalAvailable: allSoftware.length,
    softwareMatched: software.length,
    categories: [
      {
        id: 'vm',
        label: 'Virtual machines',
        help: 'All offline catalog VM sizes (Linux Consumption). Filter by series (e.g. Esv5) or search.',
        options: virtualMachines,
      },
      {
        id: 'software',
        label: 'Software',
        help: 'Licences & software — Azure OpenShift / SUSE / Arc meters, Defender, and platform ISV licences (CDP, SQL, Power BI…). Qty = units (nodes, cores packs, users).',
        options: software,
      },
      {
        id: 'disk',
        label: 'Disks',
        help: 'Managed disks — Standard HDD (Sxx), Standard SSD (Exx), Premium SSD (Pxx). Size × how many disks.',
        options: managedDisks,
      },
      {
        id: 'blob',
        label: 'File / object storage',
        help: 'Cheap bulk storage for files, backups, data lakes.',
        options: blobStorage,
      },
    ],
  };
}

// Quote simulator cart lines — { type, optionId|armSkuName|storageSku+gb, quantity }.
function quoteComponents(components = [], regionId = 'australiaeast') {
  const region = SIMULATOR_REGIONS.find((r) => r.id === regionId)?.id || 'australiaeast';
  const menu = getSimpleOptions(region);
  const byId = new Map();
  for (const cat of menu.categories) {
    for (const opt of cat.options) byId.set(opt.id, { ...opt, category: cat.id });
  }

  const lines = [];
  let total = 0;

  for (const raw of components) {
    const qty = Math.max(0, Number(raw.quantity) || 0);
    if (qty <= 0) continue;

    let opt = raw.optionId ? byId.get(raw.optionId) : null;

    // Direct SKU path for app resource swaps
    if (!opt && raw.type === 'vm' && (raw.armSkuName || raw.sku)) {
      const arm = raw.armSkuName || raw.sku;
      const unit = vmMonthly(arm, region);
      if (unit != null) {
        const monthly = money(unit * qty);
        total += monthly;
        lines.push({
          id: raw.id || arm,
          type: 'vm',
          label: raw.label || arm,
          blurb: raw.blurb || '',
          optionId: arm,
          quantity: qty,
          unitMonthly: money(unit),
          monthly,
          formula: `${qty} × ${money(unit)} = ${monthly}`,
        });
        continue;
      }
    }

    if (!opt && raw.type === 'storage' && raw.storageSku && raw.gb) {
      const perGb = storagePerGb(raw.storageSku, region);
      const unit = money(perGb * Number(raw.gb));
      const monthly = money(unit * qty);
      total += monthly;
      lines.push({
        id: raw.id || `${raw.storageSku}_${raw.gb}`,
        type: 'storage',
        label: raw.label || `${raw.storageSku} · ${raw.gb} GB`,
        blurb: '',
        optionId: null,
        quantity: qty,
        unitMonthly: unit,
        monthly,
        formula: `${qty} × ${unit} = ${monthly}`,
      });
      continue;
    }

    // Software / licence with stored unit price (saved projects, catalog reloads)
    if (!opt && (raw.type === 'software' || raw.type === 'license') && raw.unitMonthly != null) {
      const unit = money(raw.unitMonthly);
      const monthly = money(unit * qty);
      total += monthly;
      lines.push({
        id: raw.id || raw.optionId || `software_${lines.length}`,
        type: 'software',
        label: raw.label || 'Software',
        blurb: raw.blurb || '',
        optionId: raw.optionId || null,
        quantity: qty,
        unitMonthly: unit,
        monthly,
        formula: `${qty} × ${unit} = ${monthly}`,
      });
      continue;
    }

    if (!opt) continue;

    const monthly = money(opt.unitMonthly * qty);
    total += monthly;
    lines.push({
      id: raw.id || opt.id,
      type: opt.type,
      label: opt.label,
      blurb: opt.blurb,
      optionId: opt.id,
      quantity: qty,
      unitMonthly: opt.unitMonthly,
      monthly,
      formula: `${qty} × ${opt.unitMonthly} = ${monthly}`,
    });
  }

  return {
    currency: 'AUD',
    region,
    regionLabel: SIMULATOR_REGIONS.find((r) => r.id === region)?.label || region,
    lines,
    totalMonthly: money(total),
    totalAnnual: money(total * 12),
  };
}

// Cheaper/sibling SKUs for swaps — same core count, don't downsize a master node by accident.
function simplifiedVmAlternatives(armSkuName, { region = 'australiaeast', limit = 8 } = {}) {
  const regionId = SIMULATOR_REGIONS.find((r) => r.id === region)?.id || 'australiaeast';
  const specs = vmSpecs(armSkuName);
  const cores = specs.cores;
  const currentMonthly = vmMonthly(armSkuName, regionId);

  const fromMenu = getSimpleOptions(regionId).categories
    .find((c) => c.id === 'vm')
    ?.options || [];

  // Also pull same-core catalog SKUs for slightly broader comparison
  const catalog = retailCatalog.listVmSkus({ region: regionId, limit: 400 });
  const catalogNear = (catalog.skus || [])
    .filter((s) => {
      if (s.armSkuName === armSkuName) return false;
      if (cores == null) return true;
      return coresFromSku(s.armSkuName) === cores;
    })
    .slice(0, 20);

  const seen = new Set([armSkuName]);
  const alts = [];

  for (const opt of fromMenu) {
    if (seen.has(opt.armSkuName)) continue;
    if (cores != null && opt.cores !== cores) continue;
    seen.add(opt.armSkuName);
    const savings = currentMonthly != null ? money(currentMonthly - opt.unitMonthly) : null;
    alts.push({
      armSkuName: opt.armSkuName,
      label: opt.label,
      blurb: opt.specLabel || opt.blurb,
      cores: opt.cores,
      ramGb: opt.ramGb,
      monthly: opt.unitMonthly,
      savingsMonthly: savings,
      savingsPct:
        currentMonthly && currentMonthly > 0 && savings != null
          ? Math.round((savings / currentMonthly) * 1000) / 10
          : null,
    });
  }

  for (const s of catalogNear) {
    if (seen.has(s.armSkuName)) continue;
    seen.add(s.armSkuName);
    const altSpecs = vmSpecs(s.armSkuName);
    const savings = currentMonthly != null ? money(currentMonthly - s.monthly) : null;
    alts.push({
      armSkuName: s.armSkuName,
      label: s.armSkuName.replace('Standard_', ''),
      blurb: altSpecs.label || 'Same CPU count',
      cores: altSpecs.cores,
      ramGb: altSpecs.ramGb,
      monthly: s.monthly,
      savingsMonthly: savings,
      savingsPct:
        currentMonthly && currentMonthly > 0 && savings != null
          ? Math.round((savings / currentMonthly) * 1000) / 10
          : null,
    });
  }

  alts.sort((a, b) => (b.savingsMonthly || 0) - (a.savingsMonthly || 0) || a.monthly - b.monthly);

  return {
    current: {
      armSkuName,
      monthly: currentMonthly != null ? money(currentMonthly) : null,
      cores,
      ramGb: specs.ramGb,
      specLabel: specs.label,
    },
    alternatives: alts.slice(0, limit),
    region: regionId,
    currency: 'AUD',
    catalogReady: retailCatalog.isCatalogReady(),
  };
}

// Estimate tab VM + storage dropdowns — per-GB tiers + S/E/P disk sizes (priced via catalog, AU East when dense).
function getManagedDiskPick(sku) {
  if (!sku) return null;
  const key = String(sku);
  return DISK_PICKS.find((d) => d.id === key || d.azureSku === key) || null;
}

function getManagedDiskUnitMonthly(sku, regionId = 'australiaeast') {
  const pick = getManagedDiskPick(sku);
  if (!pick) return null;
  return diskUnitMonthly(pick, regionId);
}

function getBlobPackPick(sku) {
  if (!sku) return null;
  return BLOB_PICKS.find((b) => b.id === String(sku)) || null;
}

function getResourceSelectOptions(regionId = 'australiaeast') {
  const { POPULAR_VM_SKUS, STORAGE_SKU_OPTIONS } = require('./nodeResources');
  const priceRegion = 'australiaeast';
  const menu = getSimpleOptions(priceRegion);
  const allVms = menu.categories?.find((c) => c.id === 'vm')?.options || [];
  const byName = new Map(allVms.map((v) => [v.armSkuName, v]));

  const popular = [];
  const seen = new Set();
  for (const name of POPULAR_VM_SKUS) {
    const v = byName.get(name);
    if (!v) continue;
    seen.add(name);
    popular.push({
      id: v.armSkuName,
      label: v.armSkuName.replace(/^Standard_/, ''),
      series: v.series,
      cores: v.cores,
      ramGb: v.ramGb,
      specLabel: v.specLabel,
      unitMonthly: v.unitMonthly,
      group: 'Popular',
    });
  }

  const rest = allVms
    .filter((v) => !seen.has(v.armSkuName))
    .map((v) => ({
      id: v.armSkuName,
      label: v.armSkuName.replace(/^Standard_/, ''),
      series: v.series,
      cores: v.cores,
      ramGb: v.ramGb,
      specLabel: v.specLabel,
      unitMonthly: v.unitMonthly,
      group: v.series || 'Other',
    }));

  // Cap full catalog list for select UX but keep popular complete
  const maxRest = 800;
  const restLimited = rest.slice(0, maxRest);

  const storage = [];

  for (const s of STORAGE_SKU_OPTIONS) {
    const perGb = storagePerGb(s.id, priceRegion);
    storage.push({
      id: s.id,
      label: s.label,
      mode: 'per_gb',
      unitLabel: 'GB',
      perGb,
      unitMonthly: null,
      group: 'Capacity (per GB)',
    });
  }

  const diskGroups = {
    standard_hdd: 'Standard HDD disks (Sxx)',
    standard_ssd: 'Standard SSD disks (Exx)',
    premium_ssd: 'Premium SSD disks (Pxx)',
  };
  for (const pick of DISK_PICKS) {
    const unitMonthly = diskUnitMonthly(pick, priceRegion);
    storage.push({
      id: pick.id,
      label: pick.label,
      mode: 'disk',
      gb: pick.gb,
      storageFamily: pick.storageSku,
      unitLabel: 'disks',
      unitMonthly,
      group: diskGroups[pick.storageSku] || 'Managed disks',
    });
  }

  for (const pick of BLOB_PICKS) {
    const perGb = storagePerGb(pick.storageSku, priceRegion);
    const unitMonthly = money(perGb * pick.gb);
    storage.push({
      id: pick.id,
      label: pick.label,
      mode: 'blob_pack',
      gb: pick.gb,
      storageFamily: pick.storageSku,
      unitLabel: 'packs',
      unitMonthly,
      group: pick.storageSku === 'hot_blob' ? 'Hot blob packs' : 'Cool blob packs',
    });
  }

  return {
    currency: 'AUD',
    region: regionId || priceRegion,
    pricedFrom: priceRegion,
    catalogReady: menu.catalogReady,
    vm: [...popular, ...restLimited],
    vmTotal: allVms.length,
    storage,
    storageTotal: storage.length,
  };
}

module.exports = {
  SIMULATOR_REGIONS,
  getSimpleOptions,
  quoteComponents,
  simplifiedVmAlternatives,
  getResourceSelectOptions,
  getManagedDiskPick,
  getManagedDiskUnitMonthly,
  getBlobPackPick,
  DISK_PICKS,
  BLOB_PICKS,
};
