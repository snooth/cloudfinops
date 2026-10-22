require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes/api');
const { warmPriceCache, getRegion } = require('./services/azurePricing');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
// BASE_PATH e.g. "/finops" behind firmgate — blank when we're at the root (iamfinops.com.au)
const BASE_PATH = String(process.env.BASE_PATH || '')
  .trim()
  .replace(/\/+$/, '');
const basePath = BASE_PATH && !BASE_PATH.startsWith('/') ? `/${BASE_PATH}` : BASE_PATH;

const app = express();
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const clientDist = path.join(__dirname, '../../client/dist');
const portal = express.Router();

portal.use('/api', apiRouter);
portal.use(express.static(clientDist, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
portal.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

if (basePath) {
  app.use(basePath, portal);
  app.get(basePath, (_req, res) => {
    res.redirect(302, `${basePath}/`);
  });
} else {
  app.use(portal);
}

async function start() {
  const { ensureSnapshotExists } = require('./services/pricingSnapshot');
  const retailCatalog = require('./services/retailCatalog');
  ensureSnapshotExists();
  console.log('Warming offline Azure pricing (AUD)...');
  retailCatalog.loadCatalogFromDisk();
  await warmPriceCache();
  const catalogInfo = retailCatalog.getCatalogInfo();
  if (catalogInfo.available) {
    console.log(
      `Retail catalog loaded: ${catalogInfo.itemCount.toLocaleString()} meters, ` +
      `${catalogInfo.serviceCount} services (${catalogInfo.fileSizeMb} MB gzipped)`
    );
  } else {
    console.log('No full retail catalog on disk yet — baseline snapshot until you pull one down.');
  }

  app.listen(PORT, HOST, () => {
    const publicPath = basePath || '';
    console.log(`Cloud FinOps API up on ${HOST}:${PORT}${publicPath || '/'}`);
    if (HOST === '0.0.0.0') {
      console.log(`Local: http://localhost:${PORT}${publicPath}/`);
    }
    if (basePath) {
      console.log(`Base path: ${basePath} (e.g. https://firmgate.io${basePath}/)`);
    }
    console.log(`Currency: ${process.env.AZURE_CURRENCY || 'AUD'} | Region: ${getRegion()}`);
  });
}

start().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
