// AU regions we actually price against (retail + simulator).

const AZURE_REGIONS = [
  {
    id: 'australiaeast',
    label: 'AU East',
    armRegionName: 'AU East',
    description: 'Australia East (New South Wales)',
  },
  {
    id: 'australiacentral',
    label: 'AU Central',
    armRegionName: 'AU Central',
    description: 'Australia Central (Canberra)',
  },
  {
    id: 'australiacentral2',
    label: 'AU Central 2',
    armRegionName: 'AU Central 2',
    description: 'Australia Central 2 (Canberra)',
  },
];

// Rough price nudge vs Sydney baseline when catalog/snapshot is thin
const REGION_PRICE_FACTOR = {
  australiaeast: 1.0,
  australiacentral: 1.02,
  australiacentral2: 1.02,
};

function getRegionById(id) {
  return AZURE_REGIONS.find((r) => r.id === id);
}

function isValidRegion(id) {
  return AZURE_REGIONS.some((r) => r.id === id);
}

function getRegionPriceFactor(id) {
  return REGION_PRICE_FACTOR[id] ?? 1.0;
}

module.exports = {
  AZURE_REGIONS,
  getRegionById,
  isValidRegion,
  getRegionPriceFactor,
};
