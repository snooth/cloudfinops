// Same-origin fetch helper. Local dev: /api. firmgate mirror: /finops/api (follows Vite base).
function apiBase() {
  const base = import.meta.env.BASE_URL || '/';
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  return `${withSlash}api`;
}

const API = apiBase();

// Cookie session — credentials always on so we don't fight the server auth middleware
export async function fetchJson(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    ...rest,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.mustChangePassword = err.mustChangePassword;
    throw error;
  }
  return res.json();
}

export const api = {
  getAuthStatus: () => fetchJson('/auth/status'),
  login: (username, password) =>
    fetchJson('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => fetchJson('/auth/logout', { method: 'POST', body: '{}' }),
  changePassword: (currentPassword, newPassword) =>
    fetchJson('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listUsers: () => fetchJson('/auth/users'),
  createUser: (body) =>
    fetchJson('/auth/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUserRole: (username, role) =>
    fetchJson(`/auth/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  updateUser: (username, body) =>
    fetchJson(`/auth/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteUser: (username) =>
    fetchJson(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  resetUserPassword: (username, password, mustChangePassword = true) =>
    fetchJson(`/auth/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password, mustChangePassword }),
    }),
  getDashboard: () => fetchJson('/dashboard'),
  getApplications: () => fetchJson('/applications'),
  getApplicationTemplates: () => fetchJson('/applications/templates'),
  createApplication: (body) => fetchJson('/applications', { method: 'POST', body: JSON.stringify(body) }),
  deleteApplication: (id) => fetchJson(`/applications/${id}`, { method: 'DELETE' }),
  renameApplication: (id, name) =>
    fetchJson(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateApplicationMeta: (id, body) =>
    fetchJson(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  saveAppOverrides: (id, overrides) =>
    fetchJson(`/applications/${id}/overrides`, { method: 'PUT', body: JSON.stringify({ overrides }) }),
  getApplication: (id, tshirtSize) =>
    fetchJson(`/applications/${id}${tshirtSize ? `?tshirtSize=${tshirtSize}` : ''}`),
  getTshirtSizes: (id) => fetchJson(`/applications/${id}/tshirt-sizes`),
  estimate: (id, body) => fetchJson(`/applications/${id}/estimate`, { method: 'POST', body: JSON.stringify(body) }),
  projectDriver: (id, driverId, body) =>
    fetchJson(`/applications/${id}/drivers/${driverId}/project`, { method: 'POST', body: JSON.stringify(body) }),
  augment: (id, body) => fetchJson(`/applications/${id}/augment`, { method: 'POST', body: JSON.stringify(body) }),
  runScenario: (id, body) =>
    fetchJson(`/applications/${id}/scenario`, { method: 'POST', body: JSON.stringify(body) }),
  getSavingsSuggestions: (id, tshirtSize) =>
    fetchJson(`/applications/${id}/savings${tshirtSize ? `?tshirtSize=${tshirtSize}` : ''}`),
  getSimplePricing: (region, params = {}) => {
    const qs = new URLSearchParams();
    if (region) qs.set('region', region);
    if (params.series) qs.set('series', params.series);
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return fetchJson(`/pricing/simple${q ? `?${q}` : ''}`);
  },
  quoteSimplePricing: (body) =>
    fetchJson('/pricing/simple/quote', { method: 'POST', body: JSON.stringify(body) }),
  getSimpleAlternatives: (armSkuName, region) => {
    const qs = new URLSearchParams({ armSkuName });
    if (region) qs.set('region', region);
    return fetchJson(`/pricing/simple/alternatives?${qs.toString()}`);
  },
  getResourceSelectOptions: (region) => {
    const qs = new URLSearchParams();
    if (region) qs.set('region', region);
    const q = qs.toString();
    return fetchJson(`/pricing/resource-options${q ? `?${q}` : ''}`);
  },
  listSimProjects: () => fetchJson('/sim-projects'),
  getSimProject: (id) => fetchJson(`/sim-projects/${id}`),
  saveSimProject: (body) =>
    fetchJson('/sim-projects', { method: 'POST', body: JSON.stringify(body) }),
  updateSimProject: (id, body) =>
    fetchJson(`/sim-projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSimProject: (id) => fetchJson(`/sim-projects/${id}`, { method: 'DELETE' }),
  getConfig: () => fetchJson('/config'),
  getAzureCosts: () => fetchJson('/azure/costs'),
  refreshPrices: () => fetchJson('/azure/refresh-prices', { method: 'POST' }),
  setRegion: (region) => fetchJson('/config/region', { method: 'POST', body: JSON.stringify({ region }) }),
  getCatalog: () => fetchJson('/pricing/catalog'),
  getCatalogStatus: () => fetchJson('/pricing/catalog/status'),
  downloadFullCatalog: (body) =>
    fetchJson('/pricing/catalog/download', { method: 'POST', body: JSON.stringify(body || {}) }),
  searchCatalog: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return fetchJson(`/pricing/catalog/search?${qs.toString()}`);
  },
  listCatalogServices: () => fetchJson('/pricing/catalog/services'),
  listVmSkus: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return fetchJson(`/pricing/catalog/vm-skus?${qs.toString()}`);
  },
  getCostDriverScenarios: () => fetchJson('/cost-drivers/scenarios'),
  simulateCostDriver: (body) => fetchJson('/cost-drivers/simulate', { method: 'POST', body: JSON.stringify(body) }),
  getVersionInfo: () => fetchJson('/version'),
  exportSystemPackage: async (notes) => {
    const res = await fetch(`${API}/version/export`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes || '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || 'cloud-finops-export.zip';
    const version = res.headers.get('X-Package-Version');
    const previousVersion = res.headers.get('X-Previous-Version');
    return { blob, filename, version, previousVersion };
  },
  importSystemPackage: async (file, notes) => {
    const form = new FormData();
    form.append('package', file);
    if (notes) form.append('notes', notes);
    const res = await fetch(`${API}/version/import`, { method: 'POST', credentials: 'include', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  getPricingSnapshot: () => fetchJson('/pricing/snapshot'),
  exportPricingSnapshot: async (notes) => {
    const res = await fetch(`${API}/pricing/snapshot/export`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes || '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || 'azure-pricing-export.zip';
    return { blob, filename };
  },
  importPricingSnapshot: async (file, notes) => {
    const form = new FormData();
    form.append('pricingPackage', file);
    if (notes) form.append('notes', notes);
    const res = await fetch(`${API}/pricing/snapshot/import`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
};

// Quick monthly total from estimate rows — same rounding we use everywhere else
export function sumLineItems(lineItems) {
  return Math.round((lineItems || []).reduce((s, i) => s + (i.monthlyCost || 0), 0) * 100) / 100;
}

// Everything in the portal is shown as AUD — en-AU formatting, whole dollars on charts
export function formatAud(amount, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount ?? 0);
}

export function platformBadge(platform) {
  const map = { aks: 'badge-aks', aro: 'badge-aro', vm: 'badge-vm', components: 'badge-components' };
  return map[platform] || 'badge-vm';
}

export function platformLabel(platform) {
  const map = { aks: 'AKS', aro: 'ARO', vm: 'VM', components: 'Components' };
  return map[platform] || platform.toUpperCase();
}
