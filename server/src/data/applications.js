// Built-in workload templates — S/M/L/XL footprints wired to Azure-ish resources and AUD drivers.

const PLATFORM = {
  AKS: 'aks',
  ARO: 'aro',
  VM: 'vm',
};

const TSHIRT_SIZES = ['S', 'M', 'L', 'XL'];

// Shallow copy resource rows from a size template
function resources(template) {
  return template.map((r) => ({ ...r }));
}

function app(def) {
  const defaultSize = def.defaultTshirtSize || 'M';
  const baseResources = def.tshirtSizes[defaultSize].resources;
  const commercial = def.commercialCosts || {};
  const hasSkuLicenses = Object.values(def.tshirtSizes || {}).some((s) =>
    (s.resources || []).some((r) => r.type === 'license')
  );
  const commercialVariables = [
    {
      key: 'subscriptionCostMonthly',
      label: commercial.subscription?.label || 'Subscription Cost',
      type: 'currency',
      default: commercial.subscription?.defaultMonthly ?? 0,
      min: 0,
      unit: 'AUD/month',
      category: 'commercial',
      description: commercial.subscription?.description,
    },
    {
      key: 'licenseCostMonthly',
      label: commercial.license?.label || 'License Cost',
      type: 'currency',
      default: hasSkuLicenses ? 0 : (commercial.license?.defaultMonthly ?? 0),
      min: 0,
      unit: 'AUD/month',
      category: 'commercial',
      description: hasSkuLicenses
        ? `${commercial.license?.description || 'Optional contract override'} — leave at 0 to use per-node SKU licence costs`
        : commercial.license?.description,
    },
  ];
  return {
    ...def,
    baseResources,
    defaultTshirtSize: defaultSize,
    variables: [...(def.variables || []), ...commercialVariables],
    costTriggers: def.costTriggers || [],
  };
}

const applications = [
  app({
    id: 'cloudera-cdp',
    name: 'Cloudera CDP',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'Cloudera Data Platform (CDP) Private Cloud on Azure VMs — masters, workers, HDFS, and edge nodes.',
    tags: ['cloudera', 'cdp', 'data', 'vm'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: 'POC / dev — 3 masters, 4 workers, 5 TB HDFS, up to 10 datasets',
        resources: resources([
          { id: 'master_nodes', type: 'vm', quantity: 3, sku: 'Standard_D8s_v5', role: 'master' },
          { id: 'worker_nodes', type: 'vm', quantity: 4, sku: 'Standard_D8s_v5', role: 'worker' },
          { id: 'hdfs_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'edge_nodes', type: 'vm', quantity: 1, sku: 'Standard_D4s_v5', role: 'edge' },
          { id: 'cdp_license', type: 'license', quantity: 1, sku: 'cdp_private_cloud_base', unit: 'cluster' },
        ]),
        variableDefaults: { datasetCount: 10 },
      },
      M: {
        label: 'Medium',
        description: 'Production baseline — 3 masters, 8 workers, 20 TB HDFS, up to 50 datasets',
        resources: resources([
          { id: 'master_nodes', type: 'vm', quantity: 3, sku: 'Standard_D8s_v5', role: 'master' },
          { id: 'worker_nodes', type: 'vm', quantity: 8, sku: 'Standard_D16s_v5', role: 'worker' },
          { id: 'hdfs_storage', type: 'storage', quantity: 20000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'edge_nodes', type: 'vm', quantity: 2, sku: 'Standard_D4s_v5', role: 'edge' },
          { id: 'cdp_license', type: 'license', quantity: 1, sku: 'cdp_private_cloud_base', unit: 'cluster' },
        ]),
        variableDefaults: { datasetCount: 50 },
      },
      L: {
        label: 'Large',
        description: 'Enterprise scale — 3 masters, 16 workers, 50 TB HDFS, up to 200 datasets',
        resources: resources([
          { id: 'master_nodes', type: 'vm', quantity: 3, sku: 'Standard_D16s_v5', role: 'master' },
          { id: 'worker_nodes', type: 'vm', quantity: 16, sku: 'Standard_D16s_v5', role: 'worker' },
          { id: 'hdfs_storage', type: 'storage', quantity: 50000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'edge_nodes', type: 'vm', quantity: 4, sku: 'Standard_D8s_v5', role: 'edge' },
          { id: 'cdp_license', type: 'license', quantity: 1, sku: 'cdp_private_cloud_base', unit: 'cluster' },
        ]),
        variableDefaults: { datasetCount: 200 },
      },
      XL: {
        label: 'Extra Large',
        description: 'Multi-tenant analytics fabric — 3 masters, 32 workers, 100 TB HDFS, 500+ datasets',
        resources: resources([
          { id: 'master_nodes', type: 'vm', quantity: 3, sku: 'Standard_D16s_v5', role: 'master' },
          { id: 'worker_nodes', type: 'vm', quantity: 32, sku: 'Standard_D32s_v5', role: 'worker' },
          { id: 'hdfs_storage', type: 'storage', quantity: 100000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'edge_nodes', type: 'vm', quantity: 6, sku: 'Standard_D8s_v5', role: 'edge' },
          { id: 'cdp_license', type: 'license', quantity: 2, sku: 'cdp_private_cloud_base', unit: 'cluster' },
        ]),
        variableDefaults: { datasetCount: 500 },
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'datasetCount', label: 'Active Datasets', type: 'number', default: 50, min: 1, max: 1000, unit: 'datasets', driverLinked: 'new_dataset' },
    ],
    drivers: [
      {
        id: 'new_dataset',
        name: 'New Dataset Onboarded',
        description: 'Each dataset adds HDFS storage, worker pressure, and optional edge nodes',
        perUnit: true,
        unitLabel: 'dataset',
        impacts: [
          { resourceId: 'hdfs_storage', delta: 2000, unit: 'GB' },
          { resourceId: 'worker_nodes', delta: 0.1, unit: 'nodes' },
          { resourceId: 'edge_nodes', delta: 0.03, unit: 'nodes' },
        ],
        systemCosts: [
          { name: 'Data Engineering (onboarding)', costPerUnit: 2500, unit: 'AUD', period: 'one-time' },
          { name: 'Data Governance Review', costPerUnit: 800, unit: 'AUD', period: 'one-time' },
        ],
      },
      { id: 'impala_surge', name: 'Impala Query Surge', description: 'Temporary ad-hoc analytics load', impacts: [{ resourceId: 'worker_nodes', delta: 2, temporary: true }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Cloudera Support Subscription',
        defaultMonthly: 3500,
        description: 'Production support & security patches (amortised monthly)',
      },
      license: {
        label: 'CDP Enterprise License (contract)',
        defaultMonthly: 8500,
        description: 'Annual CDP Private Cloud base licence — adjust to match your contract',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'Scale workers / storage', when: 'Dataset growth, query surge', driverIds: ['new_dataset', 'impala_surge'] },
      { costType: 'license', trigger: 'CDP cluster licence', when: 'XL size adds 2nd cluster licence', driverIds: [] },
      { costType: 'subscription', trigger: 'Support tier upgrade', when: 'Production go-live or SLA upgrade', incremental: '+$2,000–5,000/mo' },
      { costType: 'system', trigger: 'Dataset onboarding', when: 'Each new dataset', driverIds: ['new_dataset'], note: 'One-time engineering & governance' },
    ],
  }),

  app({
    id: 'cloudera-cds',
    name: 'Cloudera CDS',
    platform: PLATFORM.ARO,
    region: 'australiaeast',
    description: 'Cloudera Data Services (CDS) on Azure Red Hat OpenShift — streaming, ML, and operational DB nodes.',
    tags: ['cloudera', 'cds', 'aro', 'openshift'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: 'Single-namespace CDS — 3 workers, CML + CDE lite',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 3, sku: 'Standard_D8s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 3, sku: 'Standard_D4s_v5', role: 'infra' },
          { id: 'cds_storage', type: 'storage', quantity: 2000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'cds_license', type: 'license', quantity: 3, sku: 'cloudera_cds_node', unit: 'nodes' },
          { id: 'openshift_license', type: 'license', quantity: 24, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
      M: {
        label: 'Medium',
        description: 'Production CDS — 6 workers, CML + CDE + COD',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 6, sku: 'Standard_D8s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 3, sku: 'Standard_D4s_v5', role: 'infra' },
          { id: 'cds_storage', type: 'storage', quantity: 8000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'cds_license', type: 'license', quantity: 6, sku: 'cloudera_cds_node', unit: 'nodes' },
          { id: 'openshift_license', type: 'license', quantity: 48, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
      L: {
        label: 'Large',
        description: 'Multi-service CDS — 12 workers, full data service stack',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 12, sku: 'Standard_D16s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 4, sku: 'Standard_D8s_v5', role: 'infra' },
          { id: 'cds_storage', type: 'storage', quantity: 20000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'cds_license', type: 'license', quantity: 12, sku: 'cloudera_cds_node', unit: 'nodes' },
          { id: 'openshift_license', type: 'license', quantity: 96, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
      XL: {
        label: 'Extra Large',
        description: 'Enterprise CDS fabric — 24 workers, HA across AZs',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 24, sku: 'Standard_D16s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 6, sku: 'Standard_D8s_v5', role: 'infra' },
          { id: 'cds_storage', type: 'storage', quantity: 50000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'cds_license', type: 'license', quantity: 24, sku: 'cloudera_cds_node', unit: 'nodes' },
          { id: 'openshift_license', type: 'license', quantity: 192, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'serviceCount', label: 'CDS Services Deployed', type: 'number', default: 3, min: 1, max: 10, unit: 'services' },
    ],
    drivers: [
      { id: 'new_cds_service', name: 'New CDS Service', description: 'Deploy additional CDS capability (e.g. CML workspace)', impacts: [{ resourceId: 'aro_workers', delta: 2 }, { resourceId: 'cds_license', delta: 2 }] },
      { id: 'ml_workspace', name: 'New ML Workspace', description: 'CML workspace with GPU backing', impacts: [{ resourceId: 'aro_workers', delta: 3 }, { resourceId: 'cds_storage', delta: 2000 }], subscriptionImpacts: [{ delta: 800 }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Cloudera CDS Support',
        defaultMonthly: 2800,
        description: 'CDS platform support & updates',
      },
      license: {
        label: 'CDS + OpenShift Licence (contract)',
        defaultMonthly: 12000,
        description: 'Per-node CDS and OpenShift core licences — override with contract value',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'ARO worker / storage', when: 'New CDS service or ML workspace', driverIds: ['new_cds_service', 'ml_workspace'] },
      { costType: 'license', trigger: 'CDS node licence', when: 'Each new CDS service (+2 nodes)', driverIds: ['new_cds_service'], incremental: '+$2,400/mo per service' },
      { costType: 'subscription', trigger: 'CML / GPU workspace', when: 'ML workspace driver', driverIds: ['ml_workspace'], incremental: '+$800/mo' },
    ],
  }),

  app({
    id: 'neo4j',
    name: 'Neo4j',
    platform: PLATFORM.AKS,
    region: 'australiaeast',
    description: 'Neo4j graph database cluster on AKS with causal cluster and persistent volumes.',
    tags: ['neo4j', 'graph', 'aks', 'database'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: 'Dev/test — 3-core cluster, 500 GB graph store',
        resources: resources([
          { id: 'aks_nodes', type: 'aks_node', quantity: 3, sku: 'Standard_E4s_v5' },
          { id: 'graph_storage', type: 'storage', quantity: 500, sku: 'premium_ssd', unit: 'GB' },
          { id: 'neo4j_license', type: 'license', quantity: 3, sku: 'neo4j_enterprise_core', unit: 'cores' },
        ]),
      },
      M: {
        label: 'Medium',
        description: 'Production HA — 3-node core, 2 TB graph store',
        resources: resources([
          { id: 'aks_nodes', type: 'aks_node', quantity: 3, sku: 'Standard_E8s_v5' },
          { id: 'graph_storage', type: 'storage', quantity: 2000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'neo4j_license', type: 'license', quantity: 6, sku: 'neo4j_enterprise_core', unit: 'cores' },
        ]),
      },
      L: {
        label: 'Large',
        description: 'Read replicas + analytics — 6 nodes, 8 TB store',
        resources: resources([
          { id: 'aks_nodes', type: 'aks_node', quantity: 6, sku: 'Standard_E8s_v5' },
          { id: 'graph_storage', type: 'storage', quantity: 8000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'neo4j_license', type: 'license', quantity: 12, sku: 'neo4j_enterprise_core', unit: 'cores' },
        ]),
      },
      XL: {
        label: 'Extra Large',
        description: 'Enterprise graph platform — 12 nodes, 20 TB, GDS',
        resources: resources([
          { id: 'aks_nodes', type: 'aks_node', quantity: 12, sku: 'Standard_E16s_v5' },
          { id: 'graph_storage', type: 'storage', quantity: 20000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'neo4j_license', type: 'license', quantity: 24, sku: 'neo4j_enterprise_core', unit: 'cores' },
        ]),
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
    ],
    drivers: [
      { id: 'new_graph_domain', name: 'New Graph Domain', description: 'Onboard new knowledge graph domain', impacts: [{ resourceId: 'graph_storage', delta: 500 }, { resourceId: 'aks_nodes', delta: 1, threshold: 5 }] },
      { id: 'read_replica', name: 'Add Read Replica', description: 'Scale read throughput', impacts: [{ resourceId: 'aks_nodes', delta: 1 }, { resourceId: 'neo4j_license', delta: 2 }], licenseImpacts: [{ delta: 900 }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Neo4j Enterprise Subscription',
        defaultMonthly: 1200,
        description: 'Enterprise support & Bloom/GDS subscription',
      },
      license: {
        label: 'Neo4j Core Licence (contract)',
        defaultMonthly: 2700,
        description: 'Per-core enterprise licence — override with EA agreement',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'AKS nodes & graph storage', when: 'New graph domain', driverIds: ['new_graph_domain'] },
      { costType: 'license', trigger: 'Core licence expansion', when: 'Read replica (+2 cores)', driverIds: ['read_replica'], incremental: '+$900/mo' },
      { costType: 'subscription', trigger: 'GDS / Bloom add-on', when: 'XL deployment or feature pack', incremental: '+$600/mo' },
    ],
  }),

  app({
    id: 'alation',
    name: 'Alation',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'Alation data catalog and governance platform on dedicated Azure VMs.',
    tags: ['alation', 'catalog', 'governance', 'vm'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: 'Up to 500 data assets, single app server',
        resources: resources([
          { id: 'app_server', type: 'vm', quantity: 1, sku: 'Standard_D8s_v5', role: 'application' },
          { id: 'db_server', type: 'vm', quantity: 1, sku: 'Standard_E4s_v5', role: 'database' },
          { id: 'app_storage', type: 'storage', quantity: 500, sku: 'premium_ssd', unit: 'GB' },
          { id: 'alation_license', type: 'license', quantity: 1, sku: 'alation_enterprise', unit: 'instance' },
        ]),
        variableDefaults: { assetCount: 500 },
      },
      M: {
        label: 'Medium',
        description: 'Up to 5,000 assets, HA app tier',
        resources: resources([
          { id: 'app_server', type: 'vm', quantity: 2, sku: 'Standard_D8s_v5', role: 'application' },
          { id: 'db_server', type: 'vm', quantity: 1, sku: 'Standard_E8s_v5', role: 'database' },
          { id: 'app_storage', type: 'storage', quantity: 2000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'alation_license', type: 'license', quantity: 1, sku: 'alation_enterprise', unit: 'instance' },
        ]),
        variableDefaults: { assetCount: 5000 },
      },
      L: {
        label: 'Large',
        description: 'Up to 25,000 assets, scaled connectors',
        resources: resources([
          { id: 'app_server', type: 'vm', quantity: 3, sku: 'Standard_D16s_v5', role: 'application' },
          { id: 'db_server', type: 'vm', quantity: 1, sku: 'Standard_E16s_v5', role: 'database' },
          { id: 'app_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'alation_license', type: 'license', quantity: 1, sku: 'alation_enterprise', unit: 'instance' },
        ]),
        variableDefaults: { assetCount: 25000 },
      },
      XL: {
        label: 'Extra Large',
        description: 'Enterprise catalog — 100K+ assets, multi-region connectors',
        resources: resources([
          { id: 'app_server', type: 'vm', quantity: 4, sku: 'Standard_D16s_v5', role: 'application' },
          { id: 'db_server', type: 'vm', quantity: 2, sku: 'Standard_E16s_v5', role: 'database' },
          { id: 'app_storage', type: 'storage', quantity: 10000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'alation_license', type: 'license', quantity: 2, sku: 'alation_enterprise', unit: 'instance' },
        ]),
        variableDefaults: { assetCount: 100000 },
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'assetCount', label: 'Catalogued Assets', type: 'number', default: 5000, min: 100, max: 200000, unit: 'assets', driverLinked: 'new_source_system' },
    ],
    drivers: [
      { id: 'new_source_system', name: 'New Source System', description: 'Connect and scan new data platform', perUnit: true, unitLabel: 'source', impacts: [{ resourceId: 'app_storage', delta: 200 }, { resourceId: 'app_server', delta: 0.1 }], subscriptionImpacts: [{ delta: 350, perUnit: true }], systemCosts: [{ name: 'Steward onboarding', costPerUnit: 1200, unit: 'AUD', period: 'one-time' }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Alation Cloud Connector Pack',
        defaultMonthly: 4500,
        description: 'SaaS connector & lineage subscription',
      },
      license: {
        label: 'Alation Enterprise Licence',
        defaultMonthly: 6500,
        description: 'Catalog instance licence — adjust per asset tier',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'VM & storage scaling', when: 'Asset growth exceeds tier', driverIds: ['new_source_system'] },
      { costType: 'license', trigger: 'Asset tier upgrade', when: 'Exceed 5K / 25K / 100K assets', incremental: 'Tier step-up' },
      { costType: 'subscription', trigger: 'New source connector', when: 'Each source system', driverIds: ['new_source_system'], incremental: '+$350/mo per source' },
      { costType: 'system', trigger: 'Steward onboarding', when: 'Per source', driverIds: ['new_source_system'], note: 'One-time $1,200' },
    ],
  }),

  app({
    id: 'infoarchive',
    name: 'OpenText InfoArchive',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'InfoArchive compliance archiving on Azure VMs with WORM storage.',
    tags: ['infoarchive', 'opentext', 'archive', 'compliance', 'vm'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: '5 TB archive, 2 app nodes, 10-year retention',
        resources: resources([
          { id: 'app_nodes', type: 'vm', quantity: 2, sku: 'Standard_D4s_v5', role: 'application' },
          { id: 'archive_storage', type: 'storage', quantity: 5000, sku: 'cool_blob', unit: 'GB' },
          { id: 'index_storage', type: 'storage', quantity: 500, sku: 'premium_ssd', unit: 'GB' },
          { id: 'infoarchive_license', type: 'license', quantity: 1, sku: 'infoarchive_tb', unit: 'TB' },
        ]),
        variableDefaults: { archiveTb: 5 },
      },
      M: {
        label: 'Medium',
        description: '25 TB archive, HA app tier, compliance holds',
        resources: resources([
          { id: 'app_nodes', type: 'vm', quantity: 2, sku: 'Standard_D8s_v5', role: 'application' },
          { id: 'archive_storage', type: 'storage', quantity: 25000, sku: 'cool_blob', unit: 'GB' },
          { id: 'index_storage', type: 'storage', quantity: 2000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'infoarchive_license', type: 'license', quantity: 25, sku: 'infoarchive_tb', unit: 'TB' },
        ]),
        variableDefaults: { archiveTb: 25 },
      },
      L: {
        label: 'Large',
        description: '100 TB archive, search cluster, legal hold',
        resources: resources([
          { id: 'app_nodes', type: 'vm', quantity: 3, sku: 'Standard_D8s_v5', role: 'application' },
          { id: 'search_nodes', type: 'vm', quantity: 2, sku: 'Standard_D4s_v5', role: 'search' },
          { id: 'archive_storage', type: 'storage', quantity: 100000, sku: 'cool_blob', unit: 'GB' },
          { id: 'index_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'infoarchive_license', type: 'license', quantity: 100, sku: 'infoarchive_tb', unit: 'TB' },
        ]),
        variableDefaults: { archiveTb: 100 },
      },
      XL: {
        label: 'Extra Large',
        description: '500 TB regulated archive, multi-jurisdiction',
        resources: resources([
          { id: 'app_nodes', type: 'vm', quantity: 4, sku: 'Standard_D16s_v5', role: 'application' },
          { id: 'search_nodes', type: 'vm', quantity: 4, sku: 'Standard_D8s_v5', role: 'search' },
          { id: 'archive_storage', type: 'storage', quantity: 500000, sku: 'cool_blob', unit: 'GB' },
          { id: 'index_storage', type: 'storage', quantity: 10000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'infoarchive_license', type: 'license', quantity: 500, sku: 'infoarchive_tb', unit: 'TB' },
        ]),
        variableDefaults: { archiveTb: 500 },
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'archiveTb', label: 'Archive Volume', type: 'number', default: 25, min: 1, max: 1000, unit: 'TB' },
    ],
    drivers: [
      { id: 'new_retention_policy', name: 'New Retention Policy (5 TB)', description: 'Onboard new regulated data class', perUnit: true, unitLabel: 'policy', impacts: [{ resourceId: 'archive_storage', delta: 5000 }, { resourceId: 'infoarchive_license', delta: 5 }] },
      { id: 'legal_hold_surge', name: 'Legal Hold Surge', description: 'Litigation hold increases index and search', impacts: [{ resourceId: 'search_nodes', delta: 1 }, { resourceId: 'index_storage', delta: 1000 }], subscriptionImpacts: [{ delta: 1500 }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'InfoArchive Compliance Pack',
        defaultMonthly: 2000,
        description: 'Regulatory compliance & legal hold subscription',
      },
      license: {
        label: 'Archive Capacity Licence',
        defaultMonthly: 1125,
        description: 'Per-TB archive licence (25 TB × $45) — scales with volume',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'Archive & index storage', when: 'New retention policy', driverIds: ['new_retention_policy'] },
      { costType: 'license', trigger: 'Per-TB archive licence', when: 'Each 5 TB policy', driverIds: ['new_retention_policy'], incremental: '+$225/mo per 5 TB' },
      { costType: 'subscription', trigger: 'Legal hold module', when: 'Litigation surge', driverIds: ['legal_hold_surge'], incremental: '+$1,500/mo' },
    ],
  }),

  app({
    id: 'powerbi',
    name: 'Power BI',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'Power BI Report Server on Azure VMs with SQL Server backend and gateway.',
    tags: ['powerbi', 'bi', 'reporting', 'vm'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: '50 users, single report server, dev workloads',
        resources: resources([
          { id: 'report_server', type: 'vm', quantity: 1, sku: 'Standard_D4s_v5', role: 'reporting' },
          { id: 'sql_backend', type: 'vm', quantity: 1, sku: 'Standard_D4s_v5', role: 'database' },
          { id: 'report_storage', type: 'storage', quantity: 500, sku: 'standard_ssd', unit: 'GB' },
          { id: 'pbi_license', type: 'license', quantity: 50, sku: 'powerbi_pro_user', unit: 'users' },
        ]),
        variableDefaults: { userCount: 50 },
      },
      M: {
        label: 'Medium',
        description: '200 users, HA report servers, gateway',
        resources: resources([
          { id: 'report_server', type: 'vm', quantity: 2, sku: 'Standard_D8s_v5', role: 'reporting' },
          { id: 'sql_backend', type: 'vm', quantity: 1, sku: 'Standard_E4s_v5', role: 'database' },
          { id: 'gateway', type: 'vm', quantity: 1, sku: 'Standard_D2s_v5', role: 'gateway' },
          { id: 'report_storage', type: 'storage', quantity: 2000, sku: 'standard_ssd', unit: 'GB' },
          { id: 'pbi_license', type: 'license', quantity: 200, sku: 'powerbi_pro_user', unit: 'users' },
        ]),
        variableDefaults: { userCount: 200 },
      },
      L: {
        label: 'Large',
        description: '1,000 users, scaled report farm, premium capacity',
        resources: resources([
          { id: 'report_server', type: 'vm', quantity: 4, sku: 'Standard_D8s_v5', role: 'reporting' },
          { id: 'sql_backend', type: 'vm', quantity: 1, sku: 'Standard_E8s_v5', role: 'database' },
          { id: 'gateway', type: 'vm', quantity: 2, sku: 'Standard_D4s_v5', role: 'gateway' },
          { id: 'report_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'pbi_license', type: 'license', quantity: 1000, sku: 'powerbi_pro_user', unit: 'users' },
          { id: 'pbi_premium', type: 'license', quantity: 1, sku: 'powerbi_premium_capacity', unit: 'capacity' },
        ]),
        variableDefaults: { userCount: 1000 },
      },
      XL: {
        label: 'Extra Large',
        description: '5,000+ users, enterprise BI platform, multiple capacities',
        resources: resources([
          { id: 'report_server', type: 'vm', quantity: 6, sku: 'Standard_D16s_v5', role: 'reporting' },
          { id: 'sql_backend', type: 'vm', quantity: 2, sku: 'Standard_E16s_v5', role: 'database' },
          { id: 'gateway', type: 'vm', quantity: 3, sku: 'Standard_D4s_v5', role: 'gateway' },
          { id: 'report_storage', type: 'storage', quantity: 10000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'pbi_license', type: 'license', quantity: 5000, sku: 'powerbi_pro_user', unit: 'users' },
          { id: 'pbi_premium', type: 'license', quantity: 2, sku: 'powerbi_premium_capacity', unit: 'capacity' },
        ]),
        variableDefaults: { userCount: 5000 },
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'userCount', label: 'Licensed Users', type: 'number', default: 200, min: 10, max: 20000, unit: 'users', resourceId: 'pbi_license' },
    ],
    drivers: [
      { id: 'user_growth_100', name: '100 New Users', description: 'User licence and gateway scaling', perUnit: true, unitLabel: 'block of 100', impacts: [{ resourceId: 'pbi_license', delta: 100 }, { resourceId: 'report_server', delta: 0.2, threshold: 500 }] },
      { id: 'new_dataset_refresh', name: 'Heavy Dataset Refresh', description: 'Large model increases SQL and report server load', impacts: [{ resourceId: 'sql_backend', delta: 0, skuUpgrade: 'Standard_E8s_v5' }, { resourceId: 'report_storage', delta: 500 }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Microsoft 365 / Fabric Subscription',
        defaultMonthly: 1500,
        description: 'Power BI Pro / Fabric capacity subscription',
      },
      license: {
        label: 'Power BI User Licences',
        defaultMonthly: 3000,
        description: 'Per-user Pro licences (200 × $15) — tied to userCount variable',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'Report server & SQL VMs', when: 'User growth or heavy refresh', driverIds: ['user_growth_100', 'new_dataset_refresh'] },
      { costType: 'license', trigger: 'Pro user licences', when: 'Each 100 users', driverIds: ['user_growth_100'], incremental: '+$1,500/mo per 100 users' },
      { costType: 'subscription', trigger: 'Premium capacity', when: 'L/XL size or >500 users', incremental: '+$8,500/mo per capacity' },
    ],
  }),

  app({
    id: 'sql-server',
    name: 'SQL Server',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'Microsoft SQL Server Always On availability group on Azure VMs.',
    tags: ['sql', 'database', 'vm', 'always-on'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: '2-node AG, 500 GB data, Standard edition',
        resources: resources([
          { id: 'sql_nodes', type: 'vm', quantity: 2, sku: 'Standard_E4s_v5', role: 'database' },
          { id: 'sql_storage', type: 'storage', quantity: 500, sku: 'premium_ssd', unit: 'GB' },
          { id: 'sql_license', type: 'license', quantity: 8, sku: 'sql_standard_core', unit: 'cores' },
        ]),
      },
      M: {
        label: 'Medium',
        description: '3-node AG, 2 TB data, Enterprise edition',
        resources: resources([
          { id: 'sql_nodes', type: 'vm', quantity: 3, sku: 'Standard_E8s_v5', role: 'database' },
          { id: 'sql_storage', type: 'storage', quantity: 2000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'sql_license', type: 'license', quantity: 1, sku: 'sql_enterprise_8core', unit: 'instance' },
        ]),
      },
      L: {
        label: 'Large',
        description: '5-node AG with read replicas, 8 TB data',
        resources: resources([
          { id: 'sql_nodes', type: 'vm', quantity: 5, sku: 'Standard_E16s_v5', role: 'database' },
          { id: 'sql_storage', type: 'storage', quantity: 8000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'sql_license', type: 'license', quantity: 2, sku: 'sql_enterprise_8core', unit: 'instance' },
        ]),
      },
      XL: {
        label: 'Extra Large',
        description: 'Mission-critical SQL — 7 nodes, 32 TB, ultra SSD',
        resources: resources([
          { id: 'sql_nodes', type: 'vm', quantity: 7, sku: 'Standard_E16s_v5', role: 'database' },
          { id: 'sql_storage', type: 'storage', quantity: 32000, sku: 'ultra_ssd', unit: 'GB' },
          { id: 'sql_license', type: 'license', quantity: 4, sku: 'sql_enterprise_8core', unit: 'instance' },
        ]),
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'dbSizeTb', label: 'Database Size', type: 'number', default: 2, min: 0.1, max: 100, unit: 'TB', resourceId: 'sql_storage', scale: 1000 },
    ],
    drivers: [
      { id: 'add_replica', name: 'Add AG Replica', description: 'Read-scale replica node', impacts: [{ resourceId: 'sql_nodes', delta: 1 }, { resourceId: 'sql_storage', delta: 500 }] },
      { id: 'storage_growth_1tb', name: '1 TB Data Growth', description: 'Application data expansion', impacts: [{ resourceId: 'sql_storage', delta: 1000 }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Software Assurance',
        defaultMonthly: 890,
        description: 'SQL Server Software Assurance & support',
      },
      license: {
        label: 'SQL Server Licence (contract)',
        defaultMonthly: 3200,
        description: 'Enterprise 8-core licence — override with Microsoft EA',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'VM & premium storage', when: 'Replica or data growth', driverIds: ['add_replica', 'storage_growth_1tb'] },
      { costType: 'license', trigger: 'Additional SQL instance', when: 'L/XL adds 2nd/4th enterprise licence', incremental: '+$3,200/mo per instance' },
      { costType: 'subscription', trigger: 'SA renewal', when: 'Annual true-up', incremental: 'Contract dependent' },
    ],
  }),

  app({
    id: 'windows-rds',
    name: 'Windows RDS',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'Windows Remote Desktop Services farm on Azure VMs with session hosts and brokers.',
    tags: ['rds', 'windows', 'vdi', 'vm'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: '50 concurrent sessions, 2 session hosts',
        resources: resources([
          { id: 'session_hosts', type: 'vm', quantity: 2, sku: 'Standard_D4s_v5', role: 'session' },
          { id: 'broker', type: 'vm', quantity: 1, sku: 'Standard_D2s_v5', role: 'broker' },
          { id: 'profile_storage', type: 'storage', quantity: 500, sku: 'standard_ssd', unit: 'GB' },
          { id: 'rds_license', type: 'license', quantity: 50, sku: 'rds_cal_user', unit: 'users' },
        ]),
        variableDefaults: { sessionCount: 50 },
      },
      M: {
        label: 'Medium',
        description: '200 concurrent sessions, 4 session hosts, HA broker',
        resources: resources([
          { id: 'session_hosts', type: 'vm', quantity: 4, sku: 'Standard_D8s_v5', role: 'session' },
          { id: 'broker', type: 'vm', quantity: 2, sku: 'Standard_D2s_v5', role: 'broker' },
          { id: 'profile_storage', type: 'storage', quantity: 2000, sku: 'standard_ssd', unit: 'GB' },
          { id: 'rds_license', type: 'license', quantity: 200, sku: 'rds_cal_user', unit: 'users' },
        ]),
        variableDefaults: { sessionCount: 200 },
      },
      L: {
        label: 'Large',
        description: '500 sessions, GPU hosts for CAD/graphics',
        resources: resources([
          { id: 'session_hosts', type: 'vm', quantity: 8, sku: 'Standard_D8s_v5', role: 'session' },
          { id: 'gpu_hosts', type: 'vm', quantity: 2, sku: 'Standard_NC6s_v3', role: 'gpu' },
          { id: 'broker', type: 'vm', quantity: 2, sku: 'Standard_D4s_v5', role: 'broker' },
          { id: 'profile_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'rds_license', type: 'license', quantity: 500, sku: 'rds_cal_user', unit: 'users' },
        ]),
        variableDefaults: { sessionCount: 500 },
      },
      XL: {
        label: 'Extra Large',
        description: '2,000 sessions, multi-pool VDI estate',
        resources: resources([
          { id: 'session_hosts', type: 'vm', quantity: 16, sku: 'Standard_D16s_v5', role: 'session' },
          { id: 'gpu_hosts', type: 'vm', quantity: 4, sku: 'Standard_NC6s_v3', role: 'gpu' },
          { id: 'broker', type: 'vm', quantity: 2, sku: 'Standard_D8s_v5', role: 'broker' },
          { id: 'profile_storage', type: 'storage', quantity: 10000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'rds_license', type: 'license', quantity: 2000, sku: 'rds_cal_user', unit: 'users' },
        ]),
        variableDefaults: { sessionCount: 2000 },
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'sessionCount', label: 'Concurrent Sessions', type: 'number', default: 200, min: 10, max: 5000, unit: 'sessions', resourceId: 'rds_license' },
    ],
    drivers: [
      { id: 'add_session_host', name: 'Add Session Host', description: 'Scale concurrent user capacity', impacts: [{ resourceId: 'session_hosts', delta: 1 }, { resourceId: 'rds_license', delta: 50 }] },
      { id: 'new_user_pool', name: 'New User Pool (100 users)', description: 'Department VDI pool', perUnit: true, unitLabel: 'pool', impacts: [{ resourceId: 'session_hosts', delta: 1 }, { resourceId: 'profile_storage', delta: 500 }], licenseImpacts: [{ delta: 1200, perUnit: true }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'Windows Server / RDS SA',
        defaultMonthly: 650,
        description: 'Software Assurance for RDS farm',
      },
      license: {
        label: 'RDS CAL Licences',
        defaultMonthly: 2400,
        description: 'Per-user CALs (200 × $12) — scales with sessionCount',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'Session host VMs & profile storage', when: 'New pool or session host', driverIds: ['add_session_host', 'new_user_pool'] },
      { costType: 'license', trigger: 'RDS CALs', when: 'Each session host (+50 CALs) or new pool', driverIds: ['add_session_host', 'new_user_pool'], incremental: '+$600/mo per 50 CALs' },
      { costType: 'subscription', trigger: 'GPU pool add-on', when: 'L/XL GPU hosts', incremental: 'Included in Azure GPU VM cost' },
    ],
  }),

  app({
    id: 'hashicorp',
    name: 'HashiCorp Platform',
    platform: PLATFORM.ARO,
    region: 'australiaeast',
    description: 'HashiCorp Vault, Consul, and Nomad on Azure Red Hat OpenShift.',
    tags: ['hashicorp', 'vault', 'consul', 'aro', 'secrets'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: 'Vault dev cluster — 3 workers, single namespace',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 3, sku: 'Standard_D4s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 3, sku: 'Standard_D4s_v5', role: 'infra' },
          { id: 'vault_storage', type: 'storage', quantity: 500, sku: 'premium_ssd', unit: 'GB' },
          { id: 'hashicorp_license', type: 'license', quantity: 25, sku: 'hashicorp_client', unit: 'clients' },
          { id: 'openshift_license', type: 'license', quantity: 24, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
      M: {
        label: 'Medium',
        description: 'Production Vault HA — 6 workers, Consul, 500 clients',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 6, sku: 'Standard_D8s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 3, sku: 'Standard_D4s_v5', role: 'infra' },
          { id: 'vault_storage', type: 'storage', quantity: 2000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'hashicorp_license', type: 'license', quantity: 500, sku: 'hashicorp_client', unit: 'clients' },
          { id: 'openshift_license', type: 'license', quantity: 48, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
      L: {
        label: 'Large',
        description: 'Enterprise secrets — 12 workers, multi-region replication',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 12, sku: 'Standard_D8s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 4, sku: 'Standard_D8s_v5', role: 'infra' },
          { id: 'vault_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'hashicorp_license', type: 'license', quantity: 2000, sku: 'hashicorp_client', unit: 'clients' },
          { id: 'openshift_license', type: 'license', quantity: 96, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
      XL: {
        label: 'Extra Large',
        description: 'Org-wide secrets platform — 24 workers, 10K clients',
        resources: resources([
          { id: 'aro_workers', type: 'aro_node', quantity: 24, sku: 'Standard_D16s_v5', role: 'worker' },
          { id: 'aro_infra', type: 'aro_node', quantity: 6, sku: 'Standard_D8s_v5', role: 'infra' },
          { id: 'vault_storage', type: 'storage', quantity: 10000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'hashicorp_license', type: 'license', quantity: 10000, sku: 'hashicorp_client', unit: 'clients' },
          { id: 'openshift_license', type: 'license', quantity: 192, sku: 'openshift_per_core', unit: 'cores' },
        ]),
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'clientCount', label: 'Vault Clients', type: 'number', default: 500, min: 25, max: 50000, unit: 'clients', resourceId: 'hashicorp_license' },
    ],
    drivers: [
      { id: 'new_app_onboard', name: 'New Application Onboarded', description: 'Each app adds Vault namespaces and clients', perUnit: true, unitLabel: 'application', impacts: [{ resourceId: 'hashicorp_license', delta: 25 }, { resourceId: 'aro_workers', delta: 0.1, threshold: 20 }] },
      { id: 'dr_replica', name: 'DR Cluster Replica', description: 'Disaster recovery Vault cluster', impacts: [{ resourceId: 'aro_workers', delta: 3 }, { resourceId: 'vault_storage', delta: 2000 }], subscriptionImpacts: [{ delta: 2500 }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'HashiCorp HCP / Support',
        defaultMonthly: 3200,
        description: 'Enterprise support & HCP control plane',
      },
      license: {
        label: 'HashiCorp Client Licences',
        defaultMonthly: 4000,
        description: 'Per-client Vault licence (500 × $8) — scales with clientCount',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'ARO workers & vault storage', when: 'App onboard or DR replica', driverIds: ['new_app_onboard', 'dr_replica'] },
      { costType: 'license', trigger: 'Vault clients', when: 'Each app onboarded (+25 clients)', driverIds: ['new_app_onboard'], incremental: '+$200/mo per app' },
      { costType: 'subscription', trigger: 'DR cluster support', when: 'DR replica driver', driverIds: ['dr_replica'], incremental: '+$2,500/mo' },
    ],
  }),

  app({
    id: 'erwin-modeler',
    name: 'ERwin Data Modeler',
    platform: PLATFORM.VM,
    region: 'australiaeast',
    description: 'ERwin data modelling repository and team server on Azure VMs.',
    tags: ['erwin', 'modelling', 'data-model', 'vm'],
    defaultTshirtSize: 'M',
    tshirtSizes: {
      S: {
        label: 'Small',
        description: '5 modellers, single repository server',
        resources: resources([
          { id: 'repo_server', type: 'vm', quantity: 1, sku: 'Standard_D4s_v5', role: 'repository' },
          { id: 'repo_storage', type: 'storage', quantity: 200, sku: 'standard_ssd', unit: 'GB' },
          { id: 'erwin_license', type: 'license', quantity: 5, sku: 'erwin_modeler_seat', unit: 'seats' },
        ]),
        variableDefaults: { modellerCount: 5 },
      },
      M: {
        label: 'Medium',
        description: '20 modellers, HA repository, model mart',
        resources: resources([
          { id: 'repo_server', type: 'vm', quantity: 2, sku: 'Standard_D8s_v5', role: 'repository' },
          { id: 'repo_storage', type: 'storage', quantity: 1000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'erwin_license', type: 'license', quantity: 20, sku: 'erwin_modeler_seat', unit: 'seats' },
        ]),
        variableDefaults: { modellerCount: 20 },
      },
      L: {
        label: 'Large',
        description: '50 modellers, enterprise model repository',
        resources: resources([
          { id: 'repo_server', type: 'vm', quantity: 2, sku: 'Standard_D16s_v5', role: 'repository' },
          { id: 'repo_storage', type: 'storage', quantity: 3000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'erwin_license', type: 'license', quantity: 50, sku: 'erwin_modeler_seat', unit: 'seats' },
        ]),
        variableDefaults: { modellerCount: 50 },
      },
      XL: {
        label: 'Extra Large',
        description: '100+ modellers, federated model governance',
        resources: resources([
          { id: 'repo_server', type: 'vm', quantity: 3, sku: 'Standard_D16s_v5', role: 'repository' },
          { id: 'repo_storage', type: 'storage', quantity: 5000, sku: 'premium_ssd', unit: 'GB' },
          { id: 'erwin_license', type: 'license', quantity: 100, sku: 'erwin_modeler_seat', unit: 'seats' },
        ]),
        variableDefaults: { modellerCount: 100 },
      },
    },
    variables: [
      { key: 'tshirtSize', label: 'T-Shirt Size', type: 'tshirt', default: 'M', options: TSHIRT_SIZES },
      { key: 'modellerCount', label: 'Licensed Modellers', type: 'number', default: 20, min: 1, max: 500, unit: 'seats', resourceId: 'erwin_license' },
    ],
    drivers: [
      { id: 'new_modeller_seat', name: 'New Modeller Seat', description: 'Add data modeller licence', perUnit: true, unitLabel: 'seat', impacts: [{ resourceId: 'erwin_license', delta: 1 }] },
      { id: 'new_subject_area', name: 'New Subject Area', description: 'Enterprise subject area with model versions', impacts: [{ resourceId: 'repo_storage', delta: 100 }, { resourceId: 'repo_server', delta: 0, note: 'May trigger size upgrade at scale' }] },
    ],
    commercialCosts: {
      subscription: {
        label: 'ERwin Maintenance & Support',
        defaultMonthly: 1800,
        description: 'Annual maintenance contract (amortised)',
      },
      license: {
        label: 'ERwin Modeller Seat Licences',
        defaultMonthly: 4400,
        description: 'Per-seat licence (20 × $220) — scales with modellerCount',
      },
    },
    costTriggers: [
      { costType: 'azure', trigger: 'Repository VM & storage', when: 'Subject area growth', driverIds: ['new_subject_area'] },
      { costType: 'license', trigger: 'Modeller seat', when: 'Each new seat', driverIds: ['new_modeller_seat'], incremental: '+$220/mo per seat' },
      { costType: 'subscription', trigger: 'Maintenance renewal', when: 'Annual contract', incremental: 'Contract dependent' },
    ],
  }),
];

function appHasSkuLicenses(app) {
  return Object.values(app.tshirtSizes || {}).some((s) =>
    (s.resources || []).some((r) => r.type === 'license')
  );
}

function getApplicationById(id) {
  return applications.find((a) => a.id === id);
}

function getTshirtSizeMeta(app, size) {
  const s = size || app.defaultTshirtSize || 'M';
  return app.tshirtSizes?.[s] || null;
}

function listTshirtSizes(app) {
  if (!app.tshirtSizes) return [];
  return TSHIRT_SIZES.filter((s) => app.tshirtSizes[s]).map((s) => ({
    size: s,
    label: app.tshirtSizes[s].label,
    description: app.tshirtSizes[s].description,
  }));
}

module.exports = {
  applications,
  app,
  appHasSkuLicenses,
  getApplicationById,
  getTshirtSizeMeta,
  listTshirtSizes,
  PLATFORM,
  TSHIRT_SIZES,
};
