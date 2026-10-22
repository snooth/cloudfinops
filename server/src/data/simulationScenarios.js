// Cost driver scenarios — turn slider inputs into per-app driver units across the portfolio.

const STORAGE_UNIT_MULTIPLIERS = { GB: 1, TB: 1000, PB: 1_000_000 };

const INGESTION_FREQUENCIES = [
  { id: 'once', label: 'One-time onboarding', eventsPerMonth: 0, oneTime: true },
  { id: 'daily', label: 'Daily', eventsPerMonth: 30 },
  { id: 'weekly', label: 'Weekly', eventsPerMonth: 52 / 12 },
  { id: 'monthly', label: 'Monthly', eventsPerMonth: 1 },
  { id: 'quarterly', label: 'Quarterly', eventsPerMonth: 1 / 3 },
  { id: 'yearly', label: 'Yearly', eventsPerMonth: 1 / 12 },
];

const SCENARIOS = [
  {
    id: 'data_ingestion',
    label: 'Data Ingestion',
    description: 'Model dataset count, size per dataset, and ingestion frequency to project storage and platform growth.',
    inputMode: 'ingestion',
    inputLabel: 'Number of datasets',
    inputUnit: 'datasets',
    defaultValue: 1,
    defaultDatasetSize: 500,
    defaultDatasetSizeUnit: 'GB',
    defaultFrequency: 'monthly',
    min: 1,
    max: 500,
    datasetSizeLimits: {
      GB: { min: 1, max: 1_000_000, step: 1 },
      TB: { min: 0.001, max: 1000, step: 0.001 },
      PB: { min: 0.000001, max: 10, step: 0.000001 },
    },
    ingestionFrequencies: INGESTION_FREQUENCIES.map(({ id, label }) => ({ id, label })),
    mappings: [
      {
        appId: 'cloudera-cdp',
        driverId: 'new_dataset',
        unitsFromIngestion: ({ datasetCount, sizeGb, monthlyIngestionGb, totalSizeGb }) => {
          const sizeFactor = Math.max(0.1, sizeGb / 2000);
          const recurring = Math.max(0, monthlyIngestionGb / 2000);
          return Math.max(0.1, datasetCount * sizeFactor + recurring);
        },
        summary: 'HDFS storage, workers, and edge nodes scale with dataset size and refresh rate',
      },
      {
        appId: 'neo4j',
        driverId: 'new_graph_domain',
        unitsFromIngestion: ({ datasetCount, monthlyIngestionGb }) => {
          const recurring = Math.max(0, monthlyIngestionGb / 500);
          return Math.max(0.1, datasetCount + recurring);
        },
        summary: 'New graph domains plus storage growth from recurring ingestion volume',
      },
      {
        appId: 'alation',
        driverId: 'new_source_system',
        unitsFromIngestion: ({ datasetCount, monthlyIngestionGb }) => {
          const recurring = Math.max(0, monthlyIngestionGb / 2000);
          return Math.max(0.1, datasetCount + recurring);
        },
        summary: 'Source connectors for new datasets; catalog storage grows with ingestion volume',
      },
      {
        appId: 'sql-server',
        driverId: 'storage_growth_1tb',
        unitsFromIngestion: ({ totalSizeGb, monthlyIngestionGb }) =>
          Math.max(0.1, (totalSizeGb + monthlyIngestionGb) / 1000),
        summary: 'SQL storage expansion from dataset footprint and recurring ingest volume',
      },
    ],
  },
  {
    id: 'user_increase',
    label: 'User Increase',
    description: 'Simulate growth in licensed users, concurrent sessions, or modeller seats.',
    inputLabel: 'Additional users',
    inputUnit: 'users',
    defaultValue: 100,
    min: 1,
    max: 10000,
    mappings: [
      {
        appId: 'powerbi',
        driverId: 'user_growth_100',
        unitsFromValue: (v) => Math.max(1, Math.ceil(v / 100)),
        summary: '+100 Pro user licences per block, report server scaling',
      },
      {
        appId: 'windows-rds',
        driverId: 'add_session_host',
        unitsFromValue: (v) => Math.max(1, Math.ceil(v / 50)),
        summary: '+50 RDS CALs and session host per block',
      },
      {
        appId: 'erwin-modeler',
        driverId: 'new_modeller_seat',
        unitsFromValue: (v) => Math.max(1, Math.ceil(v / 25)),
        summary: '~1 modeller seat per 25 users',
      },
      {
        appId: 'hashicorp',
        driverId: 'new_app_onboard',
        unitsFromValue: (v) => Math.max(1, Math.ceil(v / 20)),
        summary: 'Assumes ~20 users per application onboarded to Vault',
      },
    ],
  },
  {
    id: 'archive_storage',
    label: 'Archive System',
    description: 'Simulate archive/compliance storage growth — enter size in GB, TB, or PB.',
    inputLabel: 'Expected archive storage',
    inputUnit: 'GB',
    storageUnits: ['GB', 'TB', 'PB'],
    defaultValue: 5000,
    defaultStorageUnit: 'GB',
    min: 100,
    max: 1000000,
    mappings: [
      {
        appId: 'infoarchive',
        mode: 'archive_gb',
        summary: 'Archive blob storage, index storage, and per-TB licence',
      },
      {
        appId: 'cloudera-cdp',
        driverId: 'new_dataset',
        unitsFromValue: (v) => Math.max(0.1, v / 2000),
        summary: 'HDFS growth (~2 TB per dataset equivalent)',
      },
      {
        appId: 'sql-server',
        driverId: 'storage_growth_1tb',
        unitsFromValue: (v) => Math.max(0.1, v / 1000),
        summary: 'Database storage expansion',
      },
    ],
  },
];

function getScenarioById(id) {
  return SCENARIOS.find((s) => s.id === id);
}

function listScenarios() {
  return SCENARIOS.map(({ mappings, ...s }) => ({
    ...s,
    affectedApplications: mappings.map((m) => m.appId),
  }));
}

module.exports = {
  SCENARIOS,
  getScenarioById,
  listScenarios,
  INGESTION_FREQUENCIES,
  STORAGE_UNIT_MULTIPLIERS,
};
