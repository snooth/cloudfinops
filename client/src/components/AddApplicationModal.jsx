// New workload wizard — templates per platform, components mode hits catalog search
import { useEffect, useState, useCallback } from 'react';
import { api, formatAud } from '../api';

const PLATFORMS = [
  { id: 'vm', label: 'Virtual Machines (VM)' },
  { id: 'aks', label: 'Azure Kubernetes (AKS)' },
  { id: 'aro', label: 'Azure Red Hat OpenShift (ARO)' },
  { id: 'components', label: 'Azure Components (full catalog)' },
];

export default function AddApplicationModal({ onClose, onCreated }) {
  const [templates, setTemplates] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogService, setCatalogService] = useState('');
  const [services, setServices] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [components, setComponents] = useState([]);
  const [form, setForm] = useState({
    name: '',
    platform: 'vm',
    description: '',
    defaultTshirtSize: 'M',
    nodeCount: 2,
    vmSku: 'Standard_D4s_v5',
    storageGb: 1000,
    subscriptionCostMonthly: 0,
    licenseCostMonthly: 0,
    subscriptionLabel: 'Subscription Cost',
    licenseLabel: 'License Cost',
  });

  useEffect(() => {
    api.getApplicationTemplates().then(setTemplates).catch(() => {});
    api.listCatalogServices()
      .then((r) => setServices(r.services || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!templates?.defaults?.[form.platform]) return;
    if (form.platform === 'components') return;
    const d = templates.defaults[form.platform];
    setForm((f) => ({
      ...f,
      nodeCount: d.nodeCount,
      vmSku: d.vmSku || f.vmSku,
      storageGb: d.storageGb,
    }));
  }, [form.platform, templates]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const runSearch = useCallback(async () => {
    setSearching(true);
    try {
      const result = await api.searchCatalog({
        q: catalogQuery,
        serviceName: catalogService || undefined,
        limit: 30,
      });
      setSearchResults(result.items || []);
      if (!result.catalogReady) {
        setError('Full catalog not downloaded yet. Go to Admin → Configuration → Download Full Azure Catalog.');
      } else {
        setError(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }, [catalogQuery, catalogService]);

  const addComponent = (item) => {
    const isVm = item.serviceName === 'Virtual Machines' && item.armSkuName;
    setComponents((list) => {
      if (list.some((c) => c.meterId === item.meterId)) return list;
      return [
        ...list,
        {
          id: `c_${item.meterId?.slice(0, 8) || list.length + 1}`,
          meterId: item.meterId,
          armSkuName: item.armSkuName || null,
          sku: item.armSkuName || item.skuName,
          skuName: item.skuName,
          serviceName: item.serviceName,
          productName: item.productName,
          type: isVm ? 'vm' : 'azure_component',
          quantity: 1,
          label: item.productName || item.skuName,
          monthlyUnit: item.monthlyEstimate,
        },
      ];
    });
  };

  const updateQty = (id, quantity) => {
    setComponents((list) =>
      list.map((c) => (c.id === id ? { ...c, quantity: Math.max(1, Number(quantity) || 1) } : c))
    );
  };

  const removeComponent = (id) => {
    setComponents((list) => list.filter((c) => c.id !== id));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...form };
      if (form.platform === 'components' || components.length) {
        body.components = components;
      }
      await api.createApplication(body);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isComponents = form.platform === 'components';
  const selectedMonthly = components.reduce(
    (s, c) => s + (c.monthlyUnit || 0) * (c.quantity || 1),
    0
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Application</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={submit}>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Model a workload from platform templates and/or Azure retail catalog components.
            Costs use your offline AUD price book.
          </p>

          {error && (
            <div className="error" style={{ padding: '0.75rem', marginBottom: '1rem', textAlign: 'left' }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label>Application Name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Databricks Lakehouse"
            />
          </div>

          <div className="form-group">
            <label>Platform *</label>
            <select value={form.platform} onChange={(e) => set('platform', e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Description</label>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Brief description of the workload"
            />
          </div>

          {!isComponents && (
            <>
              <h3 className="form-section-title">Medium (M) deployment baseline</h3>
              <div className="grid-2" style={{ gap: '1rem' }}>
                <div className="form-group">
                  <label>{form.platform === 'vm' ? 'VM Count' : 'Node Count'}</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.nodeCount}
                    onChange={(e) => set('nodeCount', Number(e.target.value))}
                  />
                </div>
                <div className="form-group">
                  <label>VM / Node SKU</label>
                  <select value={form.vmSku} onChange={(e) => set('vmSku', e.target.value)}>
                    {(templates?.vmSkus || ['Standard_D4s_v5', 'Standard_D8s_v5']).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Storage (GB)</label>
                  <input
                    type="number"
                    min={100}
                    value={form.storageGb}
                    onChange={(e) => set('storageGb', Number(e.target.value))}
                  />
                </div>
                <div className="form-group">
                  <label>Default T-Shirt Size</label>
                  <select value={form.defaultTshirtSize} onChange={(e) => set('defaultTshirtSize', e.target.value)}>
                    {['S', 'M', 'L', 'XL'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          <h3 className="form-section-title">
            {isComponents ? 'Azure catalog components *' : 'Optional extra Azure components'}
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Search the offline retail catalog and add the meters you actually use (VMs, SQL, storage, networking…).
            {!templates?.catalogReady && (
              <span style={{ color: 'var(--amber)' }}>
                {' '}Catalog not ready — download it in Admin → Configuration first.
              </span>
            )}
          </p>

          <div className="grid-2" style={{ gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div className="form-group">
              <label>Search</label>
              <input
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="e.g. Standard_D8s, Premium SSD, SQL Database"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runSearch();
                  }
                }}
              />
            </div>
            <div className="form-group">
              <label>Service filter</label>
              <select value={catalogService} onChange={(e) => setCatalogService(e.target.value)}>
                <option value="">All services</option>
                {services.slice(0, 80).map((s) => (
                  <option key={s.name} value={s.name}>{s.name} ({s.count})</option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" className="btn" onClick={runSearch} disabled={searching} style={{ marginBottom: '0.75rem' }}>
            {searching ? 'Searching…' : 'Search Catalog'}
          </button>

          {searchResults.length > 0 && (
            <div className="catalog-results" style={{ marginBottom: '1rem' }}>
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Product / SKU</th>
                      <th>Unit</th>
                      <th>~/mo unit</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((item) => (
                      <tr key={item.meterId}>
                        <td data-label="Service" style={{ fontSize: '0.8rem' }}>{item.serviceName}</td>
                        <td data-label="Product" style={{ fontSize: '0.8rem' }}>
                          <div>{item.productName}</div>
                          <div className="mono" style={{ color: 'var(--muted)' }}>
                            {item.armSkuName || item.skuName}
                          </div>
                        </td>
                        <td data-label="Unit" className="mono" style={{ fontSize: '0.75rem' }}>{item.unitOfMeasure}</td>
                        <td data-label="Monthly" className="mono">{formatAud(item.monthlyEstimate)}</td>
                        <td>
                          <button type="button" className="btn" onClick={() => addComponent(item)}>Add</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {components.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                Selected components · estimated {formatAud(selectedMonthly)}/mo (unit × qty)
              </p>
              {components.map((c) => (
                <div key={c.id} className="component-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: '0.85rem' }}>{c.label || c.productName}</strong>
                    <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                      {c.serviceName} · {c.armSkuName || c.sku}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={c.quantity}
                    onChange={(e) => updateQty(c.id, e.target.value)}
                    style={{ width: 72 }}
                  />
                  <span className="mono" style={{ width: 88, textAlign: 'right' }}>
                    {formatAud((c.monthlyUnit || 0) * c.quantity)}
                  </span>
                  <button type="button" className="btn" onClick={() => removeComponent(c.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          <h3 className="form-section-title">Commercial costs (AUD/month)</h3>
          <div className="grid-2" style={{ gap: '1rem' }}>
            <div className="form-group">
              <label>Subscription Cost</label>
              <input
                type="number"
                min={0}
                step={100}
                value={form.subscriptionCostMonthly}
                onChange={(e) => set('subscriptionCostMonthly', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>Licence Cost</label>
              <input
                type="number"
                min={0}
                step={100}
                value={form.licenseCostMonthly}
                onChange={(e) => set('licenseCostMonthly', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Add Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
