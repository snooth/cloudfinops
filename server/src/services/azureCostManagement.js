// Optional hook to real Azure spend — needs SP env vars or DefaultAzureCredential (az login / MI).

const { DefaultAzureCredential, ClientSecretCredential } = require('@azure/identity');

const COST_API = 'https://management.azure.com';

function getCredential() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET) {
    return new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
  }
  try {
    return new DefaultAzureCredential();
  } catch {
    return null;
  }
}

async function getAccessToken() {
  const credential = getCredential();
  if (!credential) return null;
  const token = await credential.getToken('https://management.azure.com/.default');
  return token?.token;
}

async function queryActualCosts(options = {}) {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    return { configured: false, message: 'Set AZURE_SUBSCRIPTION_ID to query actual Azure costs' };
  }

  const token = await getAccessToken();
  if (!token) {
    return { configured: false, message: 'Azure credentials not configured. Use service principal or az login.' };
  }

  const { from, to, granularity = 'Monthly' } = options;
  const endDate = to || new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  const startDate = from || start.toISOString().slice(0, 10);

  const body = {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: startDate, to: endDate },
    dataset: {
      granularity,
      aggregation: {
        totalCost: { name: 'Cost', function: 'Sum' },
      },
      grouping: [
        { type: 'Dimension', name: 'ResourceGroup' },
        { type: 'Dimension', name: 'ServiceName' },
      ],
    },
  };

  const url = `${COST_API}/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { configured: true, error: true, message: `Cost Management API: ${res.status}`, detail: errText };
    }

    const data = await res.json();
    const rows = data.properties?.rows || [];
    const columns = data.properties?.columns || [];

    const parsed = rows.map((row) => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });

    const total = parsed.reduce((s, r) => s + (r.Cost || r.PreTaxCost || 0), 0);

    return {
      configured: true,
      currency: process.env.AZURE_CURRENCY || 'AUD',
      period: { from: startDate, to: endDate },
      totalCost: Math.round(total * 100) / 100,
      rows: parsed,
      source: 'Azure Cost Management API',
    };
  } catch (err) {
    return { configured: true, error: true, message: err.message };
  }
}

function getAzureConfigStatus() {
  return {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID ? '***configured***' : null,
    tenantId: process.env.AZURE_TENANT_ID ? '***configured***' : null,
    clientId: process.env.AZURE_CLIENT_ID ? '***configured***' : null,
    clientSecret: process.env.AZURE_CLIENT_SECRET ? '***configured***' : null,
    currency: process.env.AZURE_CURRENCY || 'AUD',
    region: process.env.AZURE_REGION || 'australiaeast',
    costManagementEnabled: Boolean(process.env.AZURE_SUBSCRIPTION_ID),
  };
}

module.exports = { queryActualCosts, getAzureConfigStatus, getAccessToken };
