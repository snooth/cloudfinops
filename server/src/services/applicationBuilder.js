// Wire user input + platform template into a full app def — optional catalog components for real meters.

const { app, PLATFORM, TSHIRT_SIZES } = require('../data/applications');
const retailCatalog = require('./retailCatalog');

const SIZE_SCALE = { S: 0.5, M: 1, L: 2, XL: 4 };
const STORAGE_SCALE = { S: 0.25, M: 1, L: 2, XL: 4 };

const PLATFORM_DEFAULTS = {
  vm: {
    vmSku: 'Standard_D4s_v5',
    nodeCount: 2,
    storageGb: 1000,
    storageSku: 'premium_ssd',
  },
  aks: {
    vmSku: 'Standard_D4s_v5',
    nodeCount: 3,
    storageGb: 500,
    storageSku: 'premium_ssd',
  },
  aro: {
    vmSku: 'Standard_D8s_v5',
    nodeCount: 4,
    storageGb: 2000,
    storageSku: 'premium_ssd',
    infraSku: 'Standard_D4s_v5',
    infraCount: 3,
  },
  components: {
    vmSku: null,
    nodeCount: 0,
    storageGb: 0,
    storageSku: 'premium_ssd',
  },
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function normalizeExtraComponents(components = []) {
  if (!Array.isArray(components)) return [];
  return components
    .filter((c) => c && (c.meterId || c.armSkuName || c.sku || c.serviceName))
    .map((c, idx) => {
      const id = c.id || `component_${idx + 1}`;
      const isVm = Boolean(c.armSkuName || (c.sku && String(c.sku).startsWith('Standard_')));
      return {
        id,
        type: c.type || (isVm ? 'vm' : 'azure_component'),
        quantity: Number(c.quantity) > 0 ? Number(c.quantity) : 1,
        sku: c.armSkuName || c.sku || c.skuName || c.meterId || 'catalog',
        armSkuName: c.armSkuName || null,
        meterId: c.meterId || null,
        serviceName: c.serviceName || null,
        productName: c.productName || null,
        skuName: c.skuName || null,
        unit: c.unit || null,
        role: c.role || c.serviceName || 'component',
        label: c.label || c.productName || c.skuName || c.armSkuName || id,
      };
    });
}

function buildResourcesForPlatform(platform, {
  nodeCount, vmSku, storageGb, storageSku, infraCount, infraSku, components = [],
}) {
  const extras = normalizeExtraComponents(components);
  let base = [];

  switch (platform) {
    case PLATFORM.VM:
    case 'vm':
      base = [
        { id: 'app_vms', type: 'vm', quantity: nodeCount, sku: vmSku, role: 'application' },
        { id: 'app_storage', type: 'storage', quantity: storageGb, sku: storageSku, unit: 'GB' },
      ];
      break;
    case PLATFORM.AKS:
    case 'aks':
      base = [
        { id: 'aks_nodes', type: 'aks_node', quantity: nodeCount, sku: vmSku },
        { id: 'app_storage', type: 'storage', quantity: storageGb, sku: storageSku, unit: 'GB' },
      ];
      break;
    case PLATFORM.ARO:
    case 'aro':
      base = [
        { id: 'aro_workers', type: 'aro_node', quantity: nodeCount, sku: vmSku, role: 'worker' },
        { id: 'aro_infra', type: 'aro_node', quantity: infraCount, sku: infraSku, role: 'infra' },
        { id: 'app_storage', type: 'storage', quantity: storageGb, sku: storageSku, unit: 'GB' },
        { id: 'openshift_license', type: 'license', quantity: nodeCount * 8, sku: 'openshift_per_core', unit: 'cores' },
      ];
      break;
    case 'components':
      // components platform — stack catalog meters only
      base = extras.length
        ? extras
        : [{ id: 'placeholder', type: 'azure_component', quantity: 0, sku: 'none', label: 'Add catalog components' }];
      return base;
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }

  return [...base, ...extras];
}

function buildTshirtSizes(platform, mediumConfig) {
  const sizes = {};
  const labels = {
    S: { label: 'Small', description: 'POC / dev — minimal footprint' },
    M: { label: 'Medium', description: 'Production baseline' },
    L: { label: 'Large', description: 'Enterprise scale' },
    XL: { label: 'Extra Large', description: 'Maximum footprint' },
  };

  for (const size of TSHIRT_SIZES) {
    const computeScale = SIZE_SCALE[size];
    const storageScale = STORAGE_SCALE[size];
    const scaledComponents = (mediumConfig.components || []).map((c) => ({
      ...c,
      quantity: Math.max(1, Math.round((c.quantity || 1) * computeScale)),
    }));
    const scaled = {
      ...mediumConfig,
      nodeCount: platform === 'components'
        ? 0
        : Math.max(1, Math.round((mediumConfig.nodeCount || 1) * computeScale)),
      storageGb: platform === 'components'
        ? 0
        : Math.max(100, Math.round((mediumConfig.storageGb || 100) * storageScale)),
      infraCount: mediumConfig.infraCount
        ? Math.max(2, Math.round(mediumConfig.infraCount * computeScale))
        : undefined,
      components: scaledComponents,
    };
    sizes[size] = {
      ...labels[size],
      resources: buildResourcesForPlatform(platform, scaled).map((r) => ({ ...r })),
    };
  }
  return sizes;
}

function buildApplicationFromInput(input) {
  const platform = input.platform || 'vm';
  const defaults = PLATFORM_DEFAULTS[platform] || PLATFORM_DEFAULTS.vm;
  const components = normalizeExtraComponents(input.components || []);

  const mediumConfig = {
    nodeCount: Number(input.nodeCount) || defaults.nodeCount || 0,
    vmSku: input.vmSku || defaults.vmSku || 'Standard_D4s_v5',
    storageGb: Number(input.storageGb) || defaults.storageGb || 0,
    storageSku: input.storageSku || defaults.storageSku || 'premium_ssd',
    infraCount: Number(input.infraCount) || defaults.infraCount,
    infraSku: input.infraSku || defaults.infraSku,
    components,
  };

  if (platform === 'components' && !components.length) {
    throw new Error('Add at least one Azure catalog component to model this application');
  }

  const id = input.id || slugify(input.name);
  if (!id) throw new Error('Application name is required');

  const subscriptionMonthly = Number(input.subscriptionCostMonthly) || 0;
  const licenseMonthly = Number(input.licenseCostMonthly) || 0;

  const scaleResourceId =
    platform === 'vm' ? 'app_vms'
      : platform === 'aks' ? 'aks_nodes'
        : platform === 'aro' ? 'aro_workers'
          : components[0]?.id || 'component_1';

  const def = {
    id,
    name: input.name.trim(),
    platform,
    region: input.region || 'australiaeast',
    description: input.description?.trim()
      || (platform === 'components'
        ? `${input.name} — assembled from Azure retail components.`
        : `${input.name} on Azure ${platform.toUpperCase()}.`),
    tags: input.tags?.length
      ? input.tags
      : ['custom', platform, ...(components.length ? ['catalog-components'] : [])],
    custom: true,
    catalogComponents: components,
    defaultTshirtSize: input.defaultTshirtSize || 'M',
    tshirtSizes: buildTshirtSizes(platform, mediumConfig),
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: input.defaultTshirtSize || 'M', options: TSHIRT_SIZES },
    ],
    drivers: platform === 'components'
      ? [
          {
            id: 'scale_component',
            name: 'Scale primary component',
            description: 'Increase quantity of the first catalog component',
            impacts: [{ resourceId: scaleResourceId, delta: 1 }],
          },
        ]
      : [
          {
            id: 'scale_out',
            name: 'Scale Out',
            description: 'Add compute capacity to handle increased load',
            impacts: [
              { resourceId: scaleResourceId, delta: 1 },
              { resourceId: 'app_storage', delta: 500 },
            ],
          },
          {
            id: 'storage_growth',
            name: 'Storage Growth',
            description: 'Additional storage requirement',
            perUnit: true,
            unitLabel: 'TB',
            impacts: [{ resourceId: 'app_storage', delta: 1000 }],
          },
        ],
    commercialCosts: {
      subscription: {
        label: input.subscriptionLabel || 'Subscription Cost',
        defaultMonthly: subscriptionMonthly,
        description: 'Monthly subscription or support contract',
      },
      license: {
        label: input.licenseLabel || 'License Cost',
        defaultMonthly: licenseMonthly,
        description: 'Monthly software licence (contract value)',
      },
    },
    costTriggers: [
      {
        costType: 'azure',
        trigger: platform === 'components' ? 'Catalog components' : 'Compute & storage',
        when: platform === 'components' ? 'Component quantity changes' : 'Scale out or storage growth drivers',
        driverIds: platform === 'components' ? ['scale_component'] : ['scale_out', 'storage_growth'],
      },
      {
        costType: 'subscription',
        trigger: 'Subscription contract',
        when: 'Manual adjustment in Subscription & Licence tab',
        incremental: 'Configurable',
      },
      {
        costType: 'license',
        trigger: 'Licence contract',
        when: 'Manual adjustment or platform licence scaling',
        incremental: 'Configurable',
      },
    ],
  };

  return app(def);
}

function getPlatformTemplates() {
  const region = process.env.AZURE_REGION || 'australiaeast';
  const vmList = retailCatalog.listKnownVmSkusWithPrices(region);
  const catalogInfo = retailCatalog.getCatalogInfo();

  return {
    platforms: [
      { id: 'vm', label: 'Virtual Machines', description: 'Dedicated Azure VMs' },
      { id: 'aks', label: 'Azure Kubernetes (AKS)', description: 'Container workloads on AKS' },
      { id: 'aro', label: 'Azure Red Hat OpenShift (ARO)', description: 'OpenShift PaaS on Azure' },
      {
        id: 'components',
        label: 'Azure Components (catalog)',
        description: 'Assemble any services from the offline Azure retail catalog',
      },
    ],
    vmSkus: vmList.skus.length
      ? vmList.skus.map((s) => s.armSkuName)
      : [
          'Standard_D2s_v5',
          'Standard_D4s_v5',
          'Standard_D8s_v5',
          'Standard_D16s_v5',
          'Standard_E4s_v5',
          'Standard_E8s_v5',
        ],
    vmSkuDetails: vmList.skus.slice(0, 120),
    catalogReady: catalogInfo.available,
    catalog: {
      itemCount: catalogInfo.itemCount,
      serviceCount: catalogInfo.serviceCount,
      downloadedAt: catalogInfo.downloadedAt,
    },
    defaults: PLATFORM_DEFAULTS,
    tshirtSizes: TSHIRT_SIZES,
  };
}

module.exports = {
  buildApplicationFromInput,
  getPlatformTemplates,
  slugify,
};
