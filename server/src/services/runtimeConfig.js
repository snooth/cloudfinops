// Small persisted config (region etc.) — stuff the UI can change without editing .env.

const fs = require('fs');
const path = require('path');
const { isValidRegion } = require('../data/azureRegions');

const CONFIG_FILE = path.join(__dirname, '../../data/runtime-config.json');
const DEFAULT_REGION = process.env.AZURE_REGION || 'australiaeast';

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeConfig(config) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getActiveRegionId() {
  const config = readConfig();
  const region = config.azureRegion || DEFAULT_REGION;
  return isValidRegion(region) ? region : 'australiaeast';
}

function setActiveRegionId(regionId) {
  if (!isValidRegion(regionId)) {
    throw new Error(`Invalid region: ${regionId}`);
  }
  const config = readConfig();
  config.azureRegion = regionId;
  config.updatedAt = new Date().toISOString();
  writeConfig(config);
  return regionId;
}

module.exports = {
  getActiveRegionId,
  setActiveRegionId,
  CONFIG_FILE,
};
