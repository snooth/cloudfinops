const express = require('express');
const {
  getAllApplications,
  getApplicationById,
  listTshirtSizes,
  createApplication,
  removeApplication,
  renameApplication,
  updateApplicationMeta,
} = require('../data/applicationRegistry');
const { getPlatformTemplates } = require('../services/applicationBuilder');
const { estimateApplication, estimateAllTshirtSizes, projectDriver, compareAugmentation } = require('../services/costCalculator');
const { warmPriceCache, getPricingConfig, setActiveRegion, clearPriceCache } = require('../services/azurePricing');
const { AZURE_REGIONS } = require('../data/azureRegions');
const { getActiveRegionId } = require('../services/runtimeConfig');
const { queryActualCosts, getAzureConfigStatus } = require('../services/azureCostManagement');
const { listScenarios } = require('../data/simulationScenarios');
const { simulateScenario } = require('../services/driverSimulator');
const { getVersionInfo, createSystemPackage, importSystemPackage } = require('../services/versionManager');
const {
  getSnapshotInfo,
  exportSnapshotZip,
  importSnapshotZip,
  ensureSnapshotExists,
  loadSnapshotFromDisk,
} = require('../services/pricingSnapshot');
const retailCatalog = require('../services/retailCatalog');
const { runScenario, suggestSavings } = require('../services/costScenario');
const { getSimpleOptions, quoteComponents, simplifiedVmAlternatives, SIMULATOR_REGIONS, getResourceSelectOptions } = require('../services/simpleOptions');
const {
  listProjects: listSimProjects,
  getProject: getSimProject,
  saveProject: saveSimProject,
  deleteProject: deleteSimProject,
} = require('../services/simProjects');
const { getAppOverrides, setAppOverrides, getEffectiveOverrides } = require('../services/appOverrides');
const { getNodeResources, getEditableResources, countTotalNodes } = require('../services/nodeResources');
const { ensureTenant, normalizeTenantId } = require('../services/tenantStore');
const multer = require('multer');
const {
  getAuthStatus,
  login: adminLogin,
  logout: adminLogout,
  changePassword: adminChangePassword,
  listUsers,
  createUser,
  updateUserRole,
  updateUser,
  deleteUser,
  resetUserPassword,
  setSessionCookie,
  requireAdmin,
  requireUsersAdmin,
  requireAdminSession,
  requirePermission,
} = require('../services/adminAuth');

// ZIP imports only — memory buffer, 150MB cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith('.zip')
      || file.mimetype === 'application/zip'
      || file.mimetype === 'application/x-zip-compressed';
    cb(ok ? null : new Error('Only .zip packages are allowed'), ok);
  },
});

const router = express.Router();

// Portal routes — one logged-in user, one tenant sandbox (their own data dir).
const requirePortal = requirePermission('portal');

// Resolve tenant id from session — creates dir on first hit.
function tenantOf(req) {
  const username = req.authUser?.username || req.admin?.username;
  if (!username) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  const id = normalizeTenantId(username);
  ensureTenant(id);
  return id;
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* --- Auth (login, users, roles) --- */

router.get('/auth/status', (req, res) => {
  res.json(getAuthStatus(req));
});

router.post('/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = adminLogin(String(username || ''), String(password || ''));
    setSessionCookie(res, result.sessionId, req);
    res.json({
      ok: true,
      authenticated: true,
      username: result.username,
      role: result.role,
      mustChangePassword: result.mustChangePassword,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/auth/logout', (req, res) => {
  adminLogout(req, res);
  res.json({ ok: true });
});

router.post('/auth/change-password', requireAdminSession, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const result = adminChangePassword(
      req,
      String(currentPassword || ''),
      String(newPassword || '')
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/auth/users', requireUsersAdmin, (_req, res) => {
  try {
    res.json(listUsers());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/auth/users', requireUsersAdmin, (req, res) => {
  try {
    const { username, password, mustChangePassword, role, displayName, name } = req.body || {};
    const user = createUser({
      username,
      password,
      mustChangePassword: mustChangePassword !== false,
      role: role || 'user',
      displayName: displayName ?? name,
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/auth/users/:username', requireUsersAdmin, (req, res) => {
  try {
    const { role, displayName, name, mustChangePassword } = req.body || {};
    if (
      role === undefined
      && displayName === undefined
      && name === undefined
      && mustChangePassword === undefined
    ) {
      return res.status(400).json({ error: 'Provide name, role, and/or mustChangePassword to update' });
    }
    res.json(updateUser(req, req.params.username, { role, displayName, name, mustChangePassword }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/auth/users/:username', requireUsersAdmin, (req, res) => {
  try {
    res.json(deleteUser(req, req.params.username));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/auth/users/:username/reset-password', requireUsersAdmin, (req, res) => {
  try {
    const { password, mustChangePassword } = req.body || {};
    const user = resetUserPassword(req.params.username, password, {
      mustChangePassword: mustChangePassword !== false,
    });
    res.json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/config', requirePortal, (_req, res) => {
  const pricing = getPricingConfig();
  res.json({
    azure: {
      ...getAzureConfigStatus(),
      region: pricing.region,
      regionLabel: pricing.regionLabel,
    },
    pricing,
    catalog: retailCatalog.getCatalogInfo(),
    regions: AZURE_REGIONS,
    activeRegion: getActiveRegionId(),
    envVariables: [
      { key: 'PORT', description: 'API server port', default: '4000' },
      { key: 'HOST', description: 'Bind address (0.0.0.0 = all network interfaces)', default: '0.0.0.0' },
      { key: 'AZURE_REGION', description: 'Azure region for retail pricing (or use selector below)', default: 'australiaeast' },
      { key: 'AZURE_CURRENCY', description: 'Currency code for all cost displays', default: 'AUD' },
      { key: 'AZURE_SUBSCRIPTION_ID', description: 'Subscription ID for Cost Management API', required: false },
      { key: 'AZURE_TENANT_ID', description: 'Entra ID tenant for service principal', required: false },
      { key: 'AZURE_CLIENT_ID', description: 'App registration client ID', required: false },
      { key: 'AZURE_CLIENT_SECRET', description: 'App registration client secret', required: false },
    ],
  });
});

router.post('/config/region', requireAdmin, async (req, res) => {
  const { region } = req.body || {};
  if (!region) return res.status(400).json({ error: 'region is required' });
  try {
    const meta = setActiveRegion(region);
    await warmPriceCache();
    res.json({
      ok: true,
      region: meta.id,
      regionLabel: meta.label,
      pricing: getPricingConfig(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/applications', requirePortal, async (req, res) => {
  const tenantId = tenantOf(req);
  const applications = getAllApplications(tenantId);
  const summary = await Promise.all(
    applications.map(async (a) => {
      const overrides = getEffectiveOverrides(tenantId, a);
      const nodeResources = getNodeResources(a, overrides);
      const estimate = await estimateApplication(a, { overrides });
      return {
        id: a.id,
        name: a.name,
        platform: a.platform,
        region: getActiveRegionId(),
        description: a.description,
        tags: a.tags,
        custom: Boolean(a.custom),
        defaultTshirtSize: a.defaultTshirtSize,
        tshirtSize: overrides.tshirtSize,
        tshirtSizes: listTshirtSizes(a),
        variableCount: a.variables.filter((v) => v.type !== 'tshirt').length,
        driverCount: a.drivers.length,
        nodeResources,
        totalNodes: countTotalNodes(nodeResources),
        monthlyEstimate: estimate.totalMonthly,
        annualEstimate: estimate.totalAnnual,
      };
    })
  );
  res.json(summary);
});

router.get('/applications/templates', requirePortal, (_req, res) => {
  res.json(getPlatformTemplates());
});

router.post('/applications', requirePortal, (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) {
    return res.status(400).json({ error: 'Application name is required' });
  }
  if (!['vm', 'aks', 'aro', 'components'].includes(body.platform || 'vm')) {
    return res.status(400).json({ error: 'Platform must be vm, aks, aro, or components' });
  }
  try {
    const created = createApplication(tenantOf(req), body);
    res.status(201).json({
      id: created.id,
      name: created.name,
      platform: created.platform,
      custom: true,
      message: 'Application created',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/applications/:id', requirePortal, (req, res) => {
  try {
    const body = req.body || {};
    if (body.name === undefined && body.description === undefined) {
      return res.status(400).json({ error: 'Provide name and/or description' });
    }
    const updated = updateApplicationMeta(tenantOf(req), req.params.id, {
      name: body.name,
      description: body.description,
    });
    res.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
    });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.put('/applications/:id/name', requirePortal, (req, res) => {
  try {
    const { name } = req.body || {};
    const updated = renameApplication(tenantOf(req), req.params.id, name);
    res.json({ id: updated.id, name: updated.name, description: updated.description });
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/applications/:id', requirePortal, (req, res) => {
  try {
    // Built-ins: hide for this tenant. Customs: actually delete from their store.
    removeApplication(tenantOf(req), req.params.id);
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/applications/:id', requirePortal, async (req, res) => {
  const tenantId = tenantOf(req);
  const app = getApplicationById(tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const overrides = getEffectiveOverrides(tenantId, app, {
    tshirtSize: req.query.tshirtSize || undefined,
  });
  const estimate = await estimateApplication(app, { overrides });
  const tshirtComparison = await estimateAllTshirtSizes(app);
  const nodeResources = getNodeResources(app, overrides);
  const editableResources = getEditableResources(app, overrides);
  res.json({
    ...app,
    estimate,
    tshirtComparison,
    nodeResources,
    editableResources,
    resourceSelectOptions: getResourceSelectOptions(getActiveRegionId()),
    savedOverrides: getAppOverrides(tenantId, app.id),
  });
});

router.put('/applications/:id/overrides', requirePortal, async (req, res) => {
  const tenantId = tenantOf(req);
  const app = getApplicationById(tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const { overrides } = req.body || {};
  if (!overrides || typeof overrides !== 'object') {
    return res.status(400).json({ error: 'overrides object is required' });
  }

  try {
    setAppOverrides(tenantId, app.id, overrides, app);
    const merged = getEffectiveOverrides(tenantId, app, overrides);
    const estimate = await estimateApplication(app, { overrides: merged });
    const nodeResources = getNodeResources(app, merged);
    const editableResources = getEditableResources(app, merged);
    res.json({
      ok: true,
      savedOverrides: getAppOverrides(tenantId, app.id),
      estimate,
      nodeResources,
      editableResources,
      totalNodes: countTotalNodes(nodeResources),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/applications/:id/tshirt-sizes', requirePortal, async (req, res) => {
  const app = getApplicationById(tenantOf(req), req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const comparison = await estimateAllTshirtSizes(app);
  res.json({ applicationId: app.id, currency: 'AUD', sizes: comparison });
});

router.post('/applications/:id/estimate', requirePortal, async (req, res) => {
  const app = getApplicationById(tenantOf(req), req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const { overrides = {}, drivers = [], driverUnits = {} } = req.body || {};
  const estimate = await estimateApplication(app, { overrides, drivers, driverUnits });
  res.json(estimate);
});

router.get('/applications/:id/drivers', requirePortal, (req, res) => {
  const app = getApplicationById(tenantOf(req), req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  res.json(app.drivers);
});

router.post('/applications/:id/drivers/:driverId/project', requirePortal, async (req, res) => {
  const app = getApplicationById(tenantOf(req), req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const { units = 1, overrides = {} } = req.body || {};
  try {
    const projection = await projectDriver(app, req.params.driverId, units, overrides);
    res.json(projection);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/applications/:id/augment', requirePortal, async (req, res) => {
  const app = getApplicationById(tenantOf(req), req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const augmentation = req.body || {};
  const result = await compareAugmentation(app, augmentation);
  res.json(result);
});

// What-if — swap SKUs/meters, see the AUD delta
router.post('/applications/:id/scenario', requirePortal, async (req, res) => {
  const app = getApplicationById(tenantOf(req), req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  try {
    const { overrides = {}, swaps = [] } = req.body || {};
    const result = await runScenario(app, { overrides, swaps });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cheaper VM options from the offline catalog
router.get('/applications/:id/savings', requirePortal, async (req, res) => {
  const tenantId = tenantOf(req);
  const app = getApplicationById(tenantId, req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  try {
    const overrides = getEffectiveOverrides(tenantId, app, {
      tshirtSize: req.query.tshirtSize || undefined,
    });
    const result = await suggestSavings(app, { overrides });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/cost-drivers/scenarios', requirePortal, (_req, res) => {
  res.json(listScenarios());
});

router.post('/cost-drivers/simulate', requirePortal, async (req, res) => {
  const {
    scenarioId,
    value,
    tshirtSize,
    appFilter,
    unit,
    datasetCount,
    datasetSize,
    datasetSizeUnit,
    frequency,
  } = req.body || {};
  if (!scenarioId || (value === undefined && datasetCount === undefined)) {
    return res.status(400).json({ error: 'scenarioId and value (or datasetCount) are required' });
  }
  try {
    const result = await simulateScenario(scenarioId, value ?? datasetCount, {
      tshirtSize,
      appFilter,
      unit,
      datasetCount,
      datasetSize,
      datasetSizeUnit,
      frequency,
      tenantId: tenantOf(req),
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/dashboard', requirePortal, async (req, res) => {
  const tenantId = tenantOf(req);
  const applications = getAllApplications(tenantId);
  const estimates = await Promise.all(
    applications.map((a) => estimateApplication(a, { overrides: getEffectiveOverrides(tenantId, a) }))
  );
  const totalMonthly = estimates.reduce((s, e) => s + e.totalMonthly, 0);

  res.json({
    currency: estimates[0]?.currency || 'AUD',
    applicationCount: applications.length,
    totalPortfolioMonthly: Math.round(totalMonthly * 100) / 100,
    totalPortfolioAnnual: Math.round(totalMonthly * 12 * 100) / 100,
    tenant: tenantId,
    applications: applications.map((a, i) => {
      const e = estimates[i];
      const nodes = getNodeResources(a, getEffectiveOverrides(tenantId, a));
      return {
        id: e.applicationId,
        name: e.applicationName,
        platform: e.platform,
        tshirtSize: e.tshirtSize,
        totalNodes: countTotalNodes(nodes),
        monthly: e.totalMonthly,
        annual: e.totalAnnual,
        breakdown: e.breakdown,
      };
    }),
  });
});

router.get('/azure/costs', requirePortal, async (req, res) => {
  const { from, to } = req.query;
  const costs = await queryActualCosts({ from, to });
  res.json(costs);
});

router.post('/azure/refresh-prices', requireAdmin, async (_req, res) => {
  clearPriceCache();
  loadSnapshotFromDisk();
  retailCatalog.loadCatalogFromDisk();
  await warmPriceCache();
  res.json({ ok: true, pricing: getPricingConfig(), catalog: retailCatalog.getCatalogInfo() });
});

// Full offline catalog — pull Consumption meters (AUD, AU regions)
router.get('/pricing/catalog', (_req, res) => {
  res.json(retailCatalog.getCatalogInfo());
});

router.get('/pricing/catalog/status', (_req, res) => {
  res.json(retailCatalog.getDownloadStatus());
});

router.post('/pricing/catalog/download', requireAdmin, async (req, res) => {
  try {
    const { regions, notes, allRegions, mode } = req.body || {};
    const regionList = allRegions
      ? AZURE_REGIONS.map((r) => r.id)
      : (regions?.length ? regions : [getActiveRegionId()]);
    const result = await retailCatalog.downloadFullCatalog({
      regions: regionList,
      notes,
      mode: mode === 'complete' ? 'complete' : 'regional',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pricing/catalog/services', (_req, res) => {
  res.json(retailCatalog.listServices());
});

router.get('/pricing/catalog/search', (req, res) => {
  const {
    q, serviceName, serviceFamily, armSkuName, region, limit, offset, computeOnly,
  } = req.query;
  res.json(retailCatalog.searchCatalog({
    q: q || '',
    serviceName: serviceName || undefined,
    serviceFamily: serviceFamily || undefined,
    armSkuName: armSkuName || undefined,
    region: region || getActiveRegionId(),
    limit: limit ? Number(limit) : 40,
    offset: offset ? Number(offset) : 0,
    computeOnly: computeOnly === 'true' || computeOnly === '1',
  }));
});

router.get('/pricing/catalog/vm-skus', (req, res) => {
  const { q, region, limit } = req.query;
  res.json(retailCatalog.listKnownVmSkusWithPrices(region || getActiveRegionId()));
});

router.get('/pricing/catalog/alternatives', (req, res) => {
  const { armSkuName, sku, region, limit } = req.query;
  const name = armSkuName || sku;
  if (!name) return res.status(400).json({ error: 'armSkuName (or sku) is required' });
  res.json(retailCatalog.suggestVmAlternatives(name, {
    region: region || getActiveRegionId(),
    limit: limit ? Number(limit) : 12,
  }));
});

// Simulator pricing menu — AU regions only, keep it simple
router.get('/pricing/simple', (req, res) => {
  const region = req.query.region || getActiveRegionId();
  const safe = SIMULATOR_REGIONS.some((r) => r.id === region) ? region : 'australiaeast';
  res.json(getSimpleOptions(safe, {
    vmSeries: req.query.series || req.query.vmSeries || '',
    vmQuery: req.query.q || req.query.vmQuery || '',
    vmLimit: req.query.limit ? Number(req.query.limit) : undefined,
  }));
});

router.post('/pricing/simple/quote', (req, res) => {
  try {
    const { components = [], region } = req.body || {};
    const safe = SIMULATOR_REGIONS.some((r) => r.id === region) ? region : 'australiaeast';
    res.json(quoteComponents(components, safe));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/pricing/simple/alternatives', (req, res) => {
  const name = req.query.armSkuName || req.query.sku;
  if (!name) return res.status(400).json({ error: 'armSkuName is required' });
  const region = req.query.region || getActiveRegionId();
  const safe = SIMULATOR_REGIONS.some((r) => r.id === region) ? region : 'australiaeast';
  res.json(simplifiedVmAlternatives(name, {
    region: safe,
    limit: req.query.limit ? Number(req.query.limit) : 8,
  }));
});

// VM + storage dropdowns for the Estimate tab
router.get('/pricing/resource-options', (req, res) => {
  const region = req.query.region || getActiveRegionId();
  const safe = SIMULATOR_REGIONS.some((r) => r.id === region) ? region : 'australiaeast';
  res.json(getResourceSelectOptions(safe));
});

// Saved Simulate projects (per tenant)
router.get('/sim-projects', requirePortal, (req, res) => {
  res.json({ projects: listSimProjects(tenantOf(req)) });
});

router.get('/sim-projects/:id', requirePortal, (req, res) => {
  const project = getSimProject(tenantOf(req), req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

router.post('/sim-projects', requirePortal, (req, res) => {
  try {
    const project = saveSimProject(tenantOf(req), req.body || {});
    res.status(201).json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/sim-projects/:id', requirePortal, (req, res) => {
  try {
    const project = saveSimProject(tenantOf(req), { ...(req.body || {}), id: req.params.id });
    res.json(project);
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/sim-projects/:id', requirePortal, (req, res) => {
  try {
    res.json(deleteSimProject(tenantOf(req), req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/pricing/snapshot', (_req, res) => {
  try {
    ensureSnapshotExists();
    res.json({
      ...getSnapshotInfo(),
      fullCatalog: retailCatalog.getCatalogInfo(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pricing/snapshot/export', requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body || {};
    const { filename, buffer } = await exportSnapshotZip({ notes });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pricing/snapshot/import', requireAdmin, (req, res) => {
  upload.single('pricingPackage')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'ZIP file required (field: pricingPackage)' });
    }
    try {
      const result = await importSnapshotZip(req.file.buffer, { notes: req.body?.notes });
      clearPriceCache();
      loadSnapshotFromDisk();
      await warmPriceCache();
      res.json({ ...result, pricing: getPricingConfig() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
});

router.get('/version', (_req, res) => {
  try {
    res.json(getVersionInfo());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/version/export', requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body || {};
    const { filename, buffer, manifest, previousVersion, version } = await createSystemPackage({ notes });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Package-Version', version);
    res.setHeader('X-Previous-Version', previousVersion || version);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/version/import', requireAdmin, (req, res) => {
  upload.single('package')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'ZIP file required' });
    }
    try {
      const result = await importSystemPackage(req.file.buffer, { notes: req.body?.notes });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
});

module.exports = router;
