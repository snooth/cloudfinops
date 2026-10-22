// Single-app estimator — overrides, t-shirt sizes, drivers, embedded simulator tab
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, formatAud, platformBadge, platformLabel, sumLineItems } from '../api';
import SimpleAzureSimulator from '../components/SimpleAzureSimulator';

function ensureSkuOption(list, sku) {
  if (!sku) return list || [];
  const arr = list || [];
  if (arr.some((o) => o.id === sku)) return arr;
  return [{ id: sku, label: String(sku).replace(/^Standard_/, ''), group: 'Current' }, ...arr];
}

function groupSelectOptions(options) {
  const groups = [];
  const index = new Map();
  for (const o of options || []) {
    const g = o.group || 'Other';
    if (!index.has(g)) {
      const entry = { group: g, options: [] };
      index.set(g, entry);
      groups.push(entry);
    }
    index.get(g).options.push(o);
  }
  return groups;
}

function storageOptionById(list, sku) {
  return (list || []).find((o) => o.id === sku) || null;
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [tshirtComparison, setTshirtComparison] = useState([]);
  const [tshirtSize, setTshirtSize] = useState('M');
  const [overrides, setOverrides] = useState({});
  const [tab, setTab] = useState('estimate');
  const [driverProjections, setDriverProjections] = useState({});
  const [driverUnits, setDriverUnits] = useState({});
  const [augmentResult, setAugmentResult] = useState(null);
  const [nodeResources, setNodeResources] = useState([]);
  const [editableResources, setEditableResources] = useState([]);
  const [resourceSelectOptions, setResourceSelectOptions] = useState({ vm: [], storage: [] });
  const [saveMessage, setSaveMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scenarioResult, setScenarioResult] = useState(null);

  const loadApp = useCallback(async (size) => {
    const data = await api.getApplication(id, size);
    setApp(data);
    setEstimate(data.estimate);
    setTshirtComparison(data.tshirtComparison || []);
    setNodeResources(data.nodeResources || []);
    setEditableResources(data.editableResources || []);
    if (data.resourceSelectOptions) {
      setResourceSelectOptions(data.resourceSelectOptions);
    }
    const sizeKey = data.estimate?.tshirtSize || data.defaultTshirtSize || 'M';
    setTshirtSize(sizeKey);
    const defaults = { tshirtSize: sizeKey, ...(data.savedOverrides || {}) };
    data.variables
      .filter((v) => v.type !== 'tshirt')
      .forEach((v) => {
        if (defaults[v.key] === undefined) {
          defaults[v.key] = data.estimate?.variables?.[v.key] ?? v.default;
        }
      });
    (data.editableResources || data.nodeResources || []).forEach((n) => {
      if (defaults[n.id] === undefined) defaults[n.id] = n.quantity;
      if (n.skuKey && defaults[n.skuKey] === undefined) defaults[n.skuKey] = n.sku;
    });
    // Subscription + licence lines — pull from saved overrides or fall back to template defaults
    if (!Array.isArray(defaults.commercialLines) || !defaults.commercialLines.length) {
      const fromEstimate = data.estimate?.variables?.commercialLines || data.estimate?.commercialLines;
      if (Array.isArray(fromEstimate) && fromEstimate.length) {
        defaults.commercialLines = fromEstimate.map((l) => ({ ...l }));
      } else {
        const commercial = data.commercialCosts || {};
        defaults.commercialLines = [
          {
            id: 'subscription_default',
            kind: 'subscription',
            label: commercial.subscription?.label || 'Subscription',
            monthlyCost: Number(defaults.subscriptionCostMonthly) || commercial.subscription?.defaultMonthly || 0,
          },
          {
            id: 'license_default',
            kind: 'license',
            label: commercial.license?.label || 'Licence',
            monthlyCost: Number(defaults.licenseCostMonthly) || 0,
          },
        ];
      }
    }
    setOverrides(defaults);
  }, [id]);

  useEffect(() => {
    loadApp().catch((e) => setError(e.message));
  }, [loadApp]);

  const recalculate = useCallback(async (sizeOverride) => {
    const size = sizeOverride ?? tshirtSize;
    setLoading(true);
    try {
      const est = await api.estimate(id, { overrides: { ...overrides, tshirtSize: size } });
      setEstimate(est);
      if (est.editableResources) {
        setEditableResources(est.editableResources);
        setNodeResources(est.nodeResources || est.editableResources.filter((r) => r.fieldType === 'compute'));
      } else {
        setEditableResources((prev) =>
          prev.map((r) => {
            const line = (est.lineItems || []).find((i) => i.id === r.id);
            if (!line) return r;
            return { ...r, quantity: line.quantity, sku: line.sku };
          })
        );
      }
      const comparison = await api.getTshirtSizes(id);
      setTshirtComparison(comparison.sizes || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id, overrides, tshirtSize]);

  const selectSize = async (size) => {
    setTshirtSize(size);
    const sizeMeta = app?.tshirtSizes?.[size];
    const newOverrides = { ...overrides, tshirtSize: size };
    // Bumping t-shirt size resets node counts from the size profile; extras you added stay put
    if (sizeMeta?.variableDefaults) {
      Object.assign(newOverrides, sizeMeta.variableDefaults);
    }
    if (sizeMeta?.resources) {
      sizeMeta.resources
        .filter((r) => ['vm', 'aks_node', 'aro_node', 'storage'].includes(r.type))
        .forEach((r) => {
          if ((newOverrides.removedResources || []).includes(r.id)) return;
          newOverrides[r.id] = r.quantity;
          newOverrides[`${r.id}__sku`] = r.sku;
        });
    }
    setOverrides(newOverrides);
    setLoading(true);
    try {
      const est = await api.estimate(id, { overrides: newOverrides });
      setEstimate(est);
      if (est.editableResources) {
        setEditableResources(est.editableResources);
        setNodeResources(est.nodeResources || []);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const syncExtraResourceFields = (prev, resourceId, patch) => {
    const extras = Array.isArray(prev.extraResources) ? prev.extraResources : [];
    if (!extras.some((r) => r.id === resourceId)) return prev;
    return {
      ...prev,
      extraResources: extras.map((r) => (r.id === resourceId ? { ...r, ...patch } : r)),
    };
  };

  const updateResourceQty = (resourceId, value) => {
    const qty = Number(value);
    setOverrides((prev) =>
      syncExtraResourceFields({ ...prev, [resourceId]: qty }, resourceId, { quantity: qty })
    );
  };

  const updateResourceSku = (resourceId, skuKey, sku) => {
    setOverrides((prev) =>
      syncExtraResourceFields({ ...prev, [skuKey]: sku }, resourceId, { sku })
    );
  };

  // Switching disk vs blob vs per-GB SKU — qty field means different things, so convert carefully
  const updateStorageSku = (resourceId, skuKey, sku) => {
    const opt = storageOptionById(storageSkuOptions, sku);
    setOverrides((prev) => {
      let next = { ...prev, [skuKey]: sku };
      const currentQty = Number(prev[resourceId]);
      const prevSku = prev[skuKey];
      const prevOpt = storageOptionById(storageSkuOptions, prevSku);

      if (opt?.mode === 'disk') {
        if (prevOpt?.mode === 'disk') {
          // disk → disk: leave count alone
        } else if (prevOpt?.mode === 'per_gb' && Number.isFinite(currentQty) && currentQty > 0 && opt.gb) {
          next[resourceId] = Math.max(1, Math.round(currentQty / opt.gb));
        } else if (prevOpt?.mode === 'blob_pack') {
          next[resourceId] = 1;
        } else if (!Number.isFinite(currentQty) || currentQty <= 0 || currentQty > 256) {
          next[resourceId] = 1;
        }
      } else if (opt?.mode === 'blob_pack') {
        next[resourceId] = prevOpt?.mode === 'blob_pack' && Number.isFinite(currentQty) && currentQty > 0
          ? currentQty
          : 1;
      } else if (opt?.mode === 'per_gb') {
        if (prevOpt?.mode === 'disk' && prevOpt.gb && Number.isFinite(currentQty)) {
          next[resourceId] = Math.max(opt.gb || 100, Math.round(currentQty * prevOpt.gb));
        } else if (prevOpt?.mode === 'blob_pack' && prevOpt.gb) {
          next[resourceId] = prevOpt.gb * (Number.isFinite(currentQty) ? currentQty : 1);
        }
      }

      next = syncExtraResourceFields(next, resourceId, {
        sku,
        quantity: next[resourceId] !== undefined ? next[resourceId] : currentQty,
      });
      return next;
    });
  };

  const updateResourceLabel = (resourceId, label) => {
    setOverrides((prev) => {
      let next = syncExtraResourceFields(prev, resourceId, { label });
      // Built-in rows aren't in extraResources — stash label overrides so rename survives save
      const extras = Array.isArray(next.extraResources) ? next.extraResources : [];
      if (!extras.some((r) => r.id === resourceId)) {
        next = {
          ...next,
          resourceLabels: { ...(next.resourceLabels || {}), [resourceId]: label },
        };
      }
      return next;
    });
    setEditableResources((prev) =>
      prev.map((r) => (r.id === resourceId ? { ...r, label } : r))
    );
  };

  const addResource = (kind) => {
    const isStorage = kind === 'storage';
    const platform = String(app?.platform || 'vm').toLowerCase();
    const type = isStorage
      ? 'storage'
      : platform === 'aro'
        ? 'aro_node'
        : platform === 'aks'
          ? 'aks_node'
          : 'vm';
    const extras = overrides.extraResources || [];
    const n =
      extras.filter((r) => (isStorage ? r.type === 'storage' : r.type !== 'storage')).length + 1;
    // Extra storage starts as P30-style disk so quantity = number of disks like the rest of the UI
    const resource = {
      id: isStorage ? `extra_storage_${Date.now()}` : `extra_vm_${Date.now()}`,
      type,
      sku: isStorage ? 'P30' : 'Standard_D8s_v5',
      quantity: isStorage ? 1 : 1,
      unit: isStorage ? 'disks' : 'nodes',
      label: isStorage ? `Storage ${n}` : `VM group ${n}`,
      role: isStorage ? undefined : 'worker',
    };
    const skuKey = `${resource.id}__sku`;
    setOverrides((prev) => ({
      ...prev,
      [resource.id]: resource.quantity,
      [skuKey]: resource.sku,
      extraResources: [...(prev.extraResources || []), resource],
    }));
    setEditableResources((prev) => [
      ...prev,
      {
        id: resource.id,
        label: resource.label,
        type: resource.type,
        role: resource.role || null,
        sku: resource.sku,
        defaultSku: resource.sku,
        skuKey,
        quantity: resource.quantity,
        defaultQuantity: resource.quantity,
        min: 0,
        max: isStorage ? 10_000_000 : 256,
        unit: resource.unit,
        fieldType: isStorage ? 'storage' : 'compute',
        canChangeSku: true,
        isAdded: true,
        canRemove: true,
      },
    ]);
    setSaveMessage(null);
  };

  const removeResource = (resource) => {
    const ok = window.confirm(
      resource.isAdded
        ? `Remove “${resource.label}” from this application estimate?`
        : `Remove “${resource.label}” from this estimate?\n\nYou can add a replacement with Add VM / Add storage.`
    );
    if (!ok) return;

    setOverrides((prev) => {
      const next = { ...prev };
      delete next[resource.id];
      delete next[resource.skuKey || `${resource.id}__sku`];
      if (resource.isAdded) {
        next.extraResources = (prev.extraResources || []).filter((r) => r.id !== resource.id);
      } else {
        const removed = new Set(prev.removedResources || []);
        removed.add(resource.id);
        next.removedResources = [...removed];
      }
      return next;
    });
    setEditableResources((prev) => prev.filter((r) => r.id !== resource.id));
    setSaveMessage(null);
  };

  const saveToPortfolio = async () => {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const payload = { ...overrides, tshirtSize };
      const result = await api.saveAppOverrides(id, payload);
      setEstimate(result.estimate);
      setNodeResources(result.nodeResources || []);
      setEditableResources(result.editableResources || []);
      setSaveMessage('Saved to portfolio — commercial lines, resources, and SKUs will apply for this user only.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteApplication = async () => {
    if (!app) return;
    const ok = window.confirm(
      `Delete “${app.name}” from your portfolio?\n\n` +
        (app.custom
          ? 'This permanently removes the custom application.'
          : 'This removes the built-in application from lists and cost totals. It cannot be restored from the UI.')
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteApplication(id);
      navigate('/applications', { replace: true });
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  };

  const renameApplication = async () => {
    if (!app) return;
    const next = window.prompt('Rename application', app.name);
    if (next == null) return;
    const cleaned = next.trim();
    if (!cleaned) {
      setError('Name is required');
      return;
    }
    if (cleaned === app.name) return;
    setRenaming(true);
    setError(null);
    try {
      const result = await api.renameApplication(id, cleaned);
      setApp((prev) => (prev ? { ...prev, name: result.name } : prev));
    } catch (e) {
      setError(e.message);
    } finally {
      setRenaming(false);
    }
  };

  const editDescription = async () => {
    if (!app) return;
    const next = window.prompt('Edit description', app.description || '');
    if (next == null) return;
    const cleaned = next.trim();
    if (cleaned === (app.description || '').trim()) return;
    setRenaming(true);
    setError(null);
    try {
      const result = await api.updateApplicationMeta(id, { description: cleaned });
      setApp((prev) => (prev ? { ...prev, description: result.description } : prev));
    } catch (e) {
      setError(e.message);
    } finally {
      setRenaming(false);
    }
  };

  const projectDriver = async (driverId) => {
    const units = driverUnits[driverId] || 1;
    try {
      const proj = await api.projectDriver(id, driverId, { units, overrides: { ...overrides, tshirtSize } });
      setDriverProjections((p) => ({ ...p, [driverId]: proj }));
    } catch (e) {
      setError(e.message);
    }
  };

  const augmentVm = async (resourceId) => {
    try {
      const result = await api.augment(id, { resourceId, delta: 1, overrides: { ...overrides, tshirtSize } });
      setAugmentResult(result);
    } catch (e) {
      setError(e.message);
    }
  };

  const computeResources = useMemo(
    () => (editableResources.length
      ? editableResources.filter((r) => r.fieldType === 'compute' || ['vm', 'aks_node', 'aro_node'].includes(r.type))
      : nodeResources),
    [editableResources, nodeResources]
  );
  const storageResources = useMemo(
    () => editableResources.filter((r) => r.fieldType === 'storage' || r.type === 'storage'),
    [editableResources]
  );
  const vmSkuOptions = resourceSelectOptions.vm || [];
  const storageSkuOptions = resourceSelectOptions.storage || [];

  if (error && !app) return <div className="error">{error}</div>;
  if (!app) return <div className="loading">Loading application…</div>;

  const commercialLines = Array.isArray(overrides.commercialLines) ? overrides.commercialLines : [];
  const syncCommercialTotals = (lines) => {
    const sub = lines
      .filter((l) => l.kind === 'subscription')
      .reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0);
    const lic = lines
      .filter((l) => l.kind === 'license')
      .reduce((s, l) => s + (Number(l.monthlyCost) || 0), 0);
    return {
      commercialLines: lines,
      subscriptionCostMonthly: Math.round(sub * 100) / 100,
      licenseCostMonthly: Math.round(lic * 100) / 100,
    };
  };

  const updateCommercialLine = (lineId, patch) => {
    setOverrides((prev) => {
      const list = Array.isArray(prev.commercialLines) ? prev.commercialLines : [];
      const next = list.map((l) => (l.id === lineId ? { ...l, ...patch } : l));
      return { ...prev, ...syncCommercialTotals(next) };
    });
    setSaveMessage(null);
  };

  const addCommercialLine = (kind) => {
    const isLicense = kind === 'license';
    const n = (commercialLines.filter((l) => l.kind === (isLicense ? 'license' : 'subscription')).length || 0) + 1;
    const line = {
      id: `commercial_${isLicense ? 'license' : 'sub'}_${Date.now()}`,
      kind: isLicense ? 'license' : 'subscription',
      label: '',
      monthlyCost: '',
    };
    setOverrides((prev) => {
      const list = Array.isArray(prev.commercialLines) ? prev.commercialLines : [];
      const enriched = {
        ...line,
        label: isLicense ? `Licence ${n}` : `Subscription ${n}`,
        monthlyCost: 0,
      };
      return { ...prev, ...syncCommercialTotals([...list, enriched]) };
    });
    setSaveMessage(null);
  };

  const removeCommercialLine = (lineId) => {
    setOverrides((prev) => {
      const list = Array.isArray(prev.commercialLines) ? prev.commercialLines : [];
      return { ...prev, ...syncCommercialTotals(list.filter((l) => l.id !== lineId)) };
    });
    setSaveMessage(null);
  };

  const licenseLines = commercialLines.filter((l) => l.kind === 'license');
  const subscriptionLines = commercialLines.filter((l) => l.kind === 'subscription');
  const hasSkuLicences = (estimate?.lineItems || []).some((i) => i.costCategory === 'resource_license');
  const lineItemsTotal = sumLineItems(estimate?.lineItems);
  const licenceMonthly = (estimate?.costSummary?.resourceLicenseMonthly || 0)
    + (estimate?.costSummary?.licenseMonthly || 0);
  const vmResources = (estimate?.lineItems || []).filter((i) =>
    ['vm', 'aks_node', 'aro_node'].includes(i.type)
  );

  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <p style={{ marginBottom: '0.5rem' }}>
            <Link to="/applications" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>← Applications</Link>
          </p>
          <h1>{app.name}</h1>
          <p>
            <span className={`badge ${platformBadge(app.platform)}`}>{platformLabel(app.platform)}</span>
            {' · '}{app.region}
            {app.description ? <> · {app.description}</> : null}
          </p>
        </div>
        <div className="app-detail-actions">
          <button
            type="button"
            className="btn"
            onClick={renameApplication}
            disabled={deleting || renaming || loading || saving}
          >
            {renaming ? 'Saving…' : 'Rename'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={editDescription}
            disabled={deleting || renaming || loading || saving}
          >
            Edit description
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost"
            onClick={deleteApplication}
            disabled={deleting || renaming || loading || saving}
          >
            {deleting ? 'Deleting…' : 'Delete application'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error" style={{ padding: '0.75rem', marginBottom: '1rem' }}>{error}</div>
      )}

      <div className="cards">
        <div className="card">
          <div className="card-label">Azure Infra</div>
          <div className="card-value">{formatAud(estimate?.costSummary?.azureInfraMonthly)}</div>
        </div>
        <div className="card">
          <div className="card-label">Licences</div>
          <div className="card-value">{formatAud(licenceMonthly)}</div>
        </div>
        <div className="card">
          <div className="card-label">Subscription</div>
          <div className="card-value">{formatAud(estimate?.costSummary?.subscriptionMonthly)}</div>
        </div>
        <div className="card">
          <div className="card-label">Total Monthly</div>
          <div className="card-value">{formatAud(lineItemsTotal)}</div>
        </div>
      </div>

      <div className="tabs">
        {['estimate', 'commercial', 'triggers', 'sizes', 'drivers', 'resources', 'simulate', 'augment'].map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'sizes' ? 'Size Compare'
              : t === 'commercial' ? 'Subscription & Licence'
                : t === 'triggers' ? 'Cost Triggers'
                  : t === 'simulate' ? 'Simulate'
                    : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'commercial' && (
        <div className="grid-2">
          <div className="card">
            <div className="resource-section-head" style={{ marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Subscription &amp; Licence Costs</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
                  Add, edit, or remove subscription and licence lines (AUD/month). Available to all
                  portal users for this application estimate.
                </p>
              </div>
            </div>
            {hasSkuLicences && (
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem' }}>
                Per-node SKU licence costs still come from worker counts in the estimate. Extra
                licence lines below are contract / fixed monthly add-ons.
              </p>
            )}

            <div className="resource-section-head" style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Subscriptions</h3>
              <button type="button" className="btn btn-sm" onClick={() => addCommercialLine('subscription')}>
                + Add subscription
              </button>
            </div>
            {subscriptionLines.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                No subscription lines — use + Add subscription.
              </p>
            ) : (
              subscriptionLines.map((line) => (
                  <div className="form-group resource-edit-row commercial-line-row" key={line.id}>
                    <div className="resource-edit-head">
                      <span className="commercial-line-kind">Subscription</span>
                      <button
                        type="button"
                        className="btn-danger-ghost resource-remove-btn"
                        onClick={() => removeCommercialLine(line.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="resource-edit-fields commercial-line-fields">
                      <div>
                        <span className="resource-field-label">Name</span>
                        <input
                          className="resource-label-input"
                          type="text"
                          value={line.label || ''}
                          maxLength={120}
                          placeholder="e.g. Cloudera CDS Support"
                          onChange={(e) => updateCommercialLine(line.id, { label: e.target.value })}
                          aria-label="Subscription name"
                        />
                      </div>
                      <div>
                        <span className="resource-field-label">Monthly cost (AUD)</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={line.monthlyCost ?? 0}
                          onChange={(e) =>
                            updateCommercialLine(line.id, { monthlyCost: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))
            )}

            <div className="resource-section-head" style={{ margin: '1.25rem 0 0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', margin: 0 }}>Licences</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.25rem 0 0' }}>
                  Name each licence and set its monthly cost. Add as many as you need.
                </p>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => addCommercialLine('license')}>
                + Add licence
              </button>
            </div>
            {licenseLines.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                No licence lines yet — click <strong>+ Add licence</strong> to name one and set a monthly amount.
              </p>
            ) : (
              licenseLines.map((line) => (
                  <div className="form-group resource-edit-row commercial-line-row" key={line.id}>
                    <div className="resource-edit-head">
                      <span className="commercial-line-kind">Licence</span>
                      <button
                        type="button"
                        className="btn-danger-ghost resource-remove-btn"
                        onClick={() => removeCommercialLine(line.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="resource-edit-fields commercial-line-fields">
                      <div>
                        <span className="resource-field-label">Licence name</span>
                        <input
                          className="resource-label-input"
                          type="text"
                          value={line.label || ''}
                          maxLength={120}
                          placeholder="e.g. Cloudera CDP Private Cloud licence"
                          onChange={(e) => updateCommercialLine(line.id, { label: e.target.value })}
                          aria-label="Licence name"
                        />
                      </div>
                      <div>
                        <span className="resource-field-label">Monthly cost (AUD)</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={line.monthlyCost ?? 0}
                          onChange={(e) =>
                            updateCommercialLine(line.id, { monthlyCost: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))
            )}

            <button
              type="button"
              className="btn btn-sm"
              style={{ marginBottom: '0.75rem' }}
              onClick={() => addCommercialLine('license')}
            >
              + Add another licence
            </button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={() => recalculate()} disabled={loading}>
                {loading ? 'Calculating…' : 'Recalculate Cost'}
              </button>
              <button className="btn" onClick={saveToPortfolio} disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save to Portfolio'}
              </button>
            </div>
            {saveMessage && (
              <p style={{ fontSize: '0.85rem', color: 'var(--green)', marginTop: '0.75rem' }}>{saveMessage}</p>
            )}
          </div>
          <div className="card">
            <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Commercial Cost Split</h2>
            <div className="line-items">
              <div className="row"><span>Azure Infrastructure</span><span className="mono">{formatAud(estimate?.costSummary?.azureInfraMonthly)}</span></div>
              {subscriptionLines
                .filter((l) => Number(l.monthlyCost) > 0)
                .map((l) => (
                  <div className="row" key={`sub-${l.id}`}>
                    <span>{l.label || 'Subscription'}</span>
                    <span className="mono">{formatAud(l.monthlyCost)}</span>
                  </div>
                ))}
              <div className="row">
                <span>Subscription total</span>
                <span className="mono">{formatAud(estimate?.costSummary?.subscriptionMonthly)}</span>
              </div>
              {licenseLines
                .filter((l) => Number(l.monthlyCost) > 0)
                .map((l) => (
                  <div className="row" key={`lic-${l.id}`}>
                    <span>{l.label || 'Licence'} (contract)</span>
                    <span className="mono">{formatAud(l.monthlyCost)}</span>
                  </div>
                ))}
              <div className="row"><span>Licence (contract total)</span><span className="mono">{formatAud(estimate?.costSummary?.licenseMonthly)}</span></div>
              <div className="row"><span>Licence (resource SKU estimate)</span><span className="mono">{formatAud(estimate?.costSummary?.resourceLicenseMonthly)}</span></div>
              {estimate?.costSummary?.licenseSource === 'contract' && (
                <div className="row" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}><span>Using contract licence in total</span><span>SKU shown for reference</span></div>
              )}
              <div className="row"><span>Total Commercial</span><span className="mono">{formatAud(estimate?.costSummary?.totalCommercialMonthly)}</span></div>
              <div className="row"><span>Grand Total</span><span className="mono">{formatAud(lineItemsTotal)}</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'triggers' && (
        <section>
          <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            When additional costs occur — map events to Azure infra, subscription, licence, or one-time system costs.
          </p>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Cost Type</th>
                  <th>Trigger</th>
                  <th>When It Occurs</th>
                  <th>Incremental</th>
                  <th>Linked Driver</th>
                </tr>
              </thead>
              <tbody>
                {(app.costTriggers || []).map((t, i) => (
                  <tr key={i}>
                    <td data-label="Cost Type"><span className={`cost-type-badge cost-type-${t.costType}`}>{t.costType}</span></td>
                    <td data-label="Trigger">{t.trigger}</td>
                    <td data-label="When" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{t.when}</td>
                    <td className="mono" data-label="Incremental">{t.incremental || t.note || '—'}</td>
                    <td data-label="Driver" style={{ fontSize: '0.85rem' }}>{t.driverIds?.length ? t.driverIds.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'estimate' && (
        <div className="grid-2">
          <div className="card">
            <div className="resource-section-head">
              <div>
                <h2 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>Compute Nodes &amp; VMs</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
                  Add or remove VM groups, set size and count, then recalculate or save.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => addResource('vm')}>
                + Add VM
              </button>
            </div>
            {computeResources.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                No compute nodes yet — use + Add VM to include compute.
              </p>
            ) : (
              computeResources.map((n) => {
                const skuKey = n.skuKey || `${n.id}__sku`;
                const selectedSku = overrides[skuKey] ?? n.sku;
                const options = ensureSkuOption(vmSkuOptions, selectedSku);
                return (
                  <div className="form-group resource-edit-row" key={n.id}>
                    <div className="resource-edit-head">
                      <input
                        className="resource-label-input"
                        value={n.label}
                        onChange={(e) => updateResourceLabel(n.id, e.target.value)}
                        aria-label="VM group name"
                      />
                      {n.canRemove !== false && (
                        <button
                          type="button"
                          className="btn-danger-ghost resource-remove-btn"
                          onClick={() => removeResource(n)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="resource-edit-fields">
                      <div>
                        <span className="resource-field-label">VM size / SKU</span>
                        <select
                          value={selectedSku || ''}
                          onChange={(e) => updateResourceSku(n.id, skuKey, e.target.value)}
                        >
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label || o.id}
                              {o.specLabel
                                ? ` · ${o.specLabel}`
                                : [
                                    o.cores != null ? ` · ${o.cores} vCPU` : '',
                                    o.ramGb != null ? ` · ${o.ramGb} GB` : '',
                                  ].join('')}
                              {o.unitMonthly != null ? ` · ${formatAud(o.unitMonthly)}/mo` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span className="resource-field-label">Quantity ({n.unit || 'nodes'})</span>
                        <input
                          type="number"
                          min={n.min ?? 0}
                          max={n.max ?? 256}
                          value={overrides[n.id] ?? n.quantity}
                          onChange={(e) => updateResourceQty(n.id, e.target.value)}
                        />
                      </div>
                    </div>
                    {!n.isAdded && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                        Default: {n.defaultQuantity} × {n.defaultSku || n.sku}
                      </p>
                    )}
                  </div>
                );
              })
            )}

            <div className="resource-section-head" style={{ marginTop: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>Storage</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
                  Add or remove storage elements (managed disks, blob packs, or capacity per GB). Set
                  tier and quantity, then recalculate or save.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => addResource('storage')}>
                + Add storage
              </button>
            </div>
            {storageResources.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                No storage elements — use + Add storage for disks or capacity.
              </p>
            ) : (
              storageResources.map((n) => {
                const skuKey = n.skuKey || `${n.id}__sku`;
                const selectedSku = overrides[skuKey] ?? n.sku;
                const options = ensureSkuOption(storageSkuOptions, selectedSku);
                const selectedOpt = storageOptionById(options, selectedSku);
                const grouped = groupSelectOptions(options);
                const qtyUnit =
                  selectedOpt?.unitLabel ||
                  (selectedOpt?.mode === 'disk' ? 'disks' : selectedOpt?.mode === 'blob_pack' ? 'packs' : 'GB');
                const qtyStep = selectedOpt?.mode === 'per_gb' ? 100 : 1;
                const qtyMax =
                  selectedOpt?.mode === 'disk' || selectedOpt?.mode === 'blob_pack'
                    ? 1000
                    : n.max ?? 10_000_000;
                return (
                  <div className="form-group resource-edit-row" key={n.id}>
                    <div className="resource-edit-head">
                      <input
                        className="resource-label-input"
                        value={n.label}
                        onChange={(e) => updateResourceLabel(n.id, e.target.value)}
                        aria-label="Storage element name"
                      />
                      {n.canRemove !== false && (
                        <button
                          type="button"
                          className="btn-danger-ghost resource-remove-btn"
                          onClick={() => removeResource(n)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="resource-edit-fields">
                      <div>
                        <span className="resource-field-label">Storage tier</span>
                        <select
                          className="storage-tier-select"
                          value={selectedSku || ''}
                          onChange={(e) => updateStorageSku(n.id, skuKey, e.target.value)}
                        >
                          {grouped.map((g) => (
                            <optgroup key={g.group} label={g.group}>
                              {g.options.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label || o.id}
                                  {o.unitMonthly != null ? ` · ${formatAud(o.unitMonthly)}/mo` : ''}
                                  {o.mode === 'per_gb' && o.perGb != null
                                    ? ` · ${formatAud(o.perGb)}/GB`
                                    : ''}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span className="resource-field-label">
                          {selectedOpt?.mode === 'disk'
                            ? 'How many disks'
                            : selectedOpt?.mode === 'blob_pack'
                              ? 'How many packs'
                              : 'Capacity (GB)'}
                        </span>
                        <input
                          type="number"
                          min={n.min ?? 0}
                          max={qtyMax}
                          step={qtyStep}
                          value={overrides[n.id] ?? n.quantity}
                          onChange={(e) => updateResourceQty(n.id, e.target.value)}
                        />
                      </div>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                      {selectedOpt?.mode === 'disk' && selectedOpt.gb
                        ? `${selectedOpt.gb} GB per disk · qty in ${qtyUnit}`
                        : selectedOpt?.mode === 'blob_pack' && selectedOpt.gb
                          ? `${selectedOpt.gb.toLocaleString()} GB per pack · qty in ${qtyUnit}`
                          : !n.isAdded
                            ? `Default: ${n.defaultQuantity} ${n.unit || 'GB'} · ${n.defaultSku || n.sku}`
                            : `Qty unit: ${qtyUnit}`}
                    </p>
                  </div>
                );
              })
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={() => recalculate()} disabled={loading}>
                {loading ? 'Calculating…' : 'Recalculate Cost'}
              </button>
              <button className="btn" onClick={saveToPortfolio} disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save to Portfolio'}
              </button>
            </div>
            {saveMessage && (
              <p style={{ fontSize: '0.85rem', color: 'var(--green)', marginTop: '0.75rem' }}>{saveMessage}</p>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Cost Breakdown</h2>
            <div className="line-items">
              {estimate?.lineItems?.map((item) => (
                <div className="row" key={item.id}>
                  <span>
                    {item.label || item.id} ({item.quantity} × {item.sku})
                    {item.unitPrice != null && (
                      <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                        {' '}@ {formatAud(item.unitPrice)}
                      </span>
                    )}
                  </span>
                  <span className="mono">{formatAud(item.monthlyCost)}</span>
                </div>
              ))}
              <div className="row">
                <span>Total Monthly</span>
                <span className="mono">{formatAud(lineItemsTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'sizes' && (
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Size</th>
                <th>Profile</th>
                <th>Description</th>
                <th>Monthly</th>
                <th>Annual</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tshirtComparison.map((row) => (
                <tr key={row.size} style={row.size === tshirtSize ? { background: 'var(--accent-dim)' } : {}}>
                  <td data-label="Size"><strong>{row.size}</strong></td>
                  <td data-label="Profile">{row.label}</td>
                  <td data-label="Description" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{row.description}</td>
                  <td className="mono" data-label="Monthly">{formatAud(row.monthly)}</td>
                  <td className="mono" data-label="Annual">{formatAud(row.annual)}</td>
                  <td className="actions-cell">
                    {row.size !== tshirtSize && (
                      <button className="btn" onClick={() => selectSize(row.size)}>Select</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'drivers' && (
        <section>
          <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Cost drivers for <strong>{tshirtSize}</strong> deployment — usage events that scale resources and incur system costs.
          </p>
          {app.drivers.map((d) => (
            <div className="driver-card" key={d.id}>
              <h3>{d.name}</h3>
              <p>{d.description}</p>
              {d.perUnit && (
                <div className="form-group" style={{ maxWidth: 200 }}>
                  <label>Units ({d.unitLabel || 'events'})</label>
                  <input
                    type="number"
                    min={1}
                    value={driverUnits[d.id] || 1}
                    onChange={(e) => setDriverUnits({ ...driverUnits, [d.id]: Number(e.target.value) })}
                  />
                </div>
              )}
              <button className="btn btn-primary" onClick={() => projectDriver(d.id)}>Project Cost Impact</button>

              {driverProjections[d.id] && (
                <div className="driver-projection">
                  <div className="impact">
                    +{formatAud(driverProjections[d.id].incrementalMonthly)}/month total
                    {' · '}+{formatAud(driverProjections[d.id].incrementalAnnual)}/year
                  </div>
                  {driverProjections[d.id].incrementalBreakdown && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <span>Azure: <strong className="mono">+{formatAud(driverProjections[d.id].incrementalBreakdown.azure)}</strong></span>
                      <span>Subscription: <strong className="mono">+{formatAud(driverProjections[d.id].incrementalBreakdown.subscription)}</strong></span>
                      <span>Licence: <strong className="mono">+{formatAud(driverProjections[d.id].incrementalBreakdown.license)}</strong></span>
                    </div>
                  )}
                  {driverProjections[d.id].systemCostsOneTime > 0 && (
                    <div className="impact" style={{ marginTop: '0.35rem' }}>
                      +{formatAud(driverProjections[d.id].systemCostsOneTime)} one-time system cost
                    </div>
                  )}
                  <ul style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--muted)', paddingLeft: '1.25rem' }}>
                    {driverProjections[d.id].resourceChanges?.map((c, i) => (
                      <li key={i}>
                        {c.costType === 'subscription' && `Subscription: ${c.from} → ${c.to} AUD/mo`}
                        {c.costType === 'license' && `Licence: ${c.from} → ${c.to} AUD/mo`}
                        {c.resourceId && `${c.resourceId}: ${c.from ?? '?'} → ${c.to ?? c.note}`}
                        {c.variable && `${c.variable}: ${c.from} → ${c.to}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {tab === 'resources' && (
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Resource</th>
                <th>Type</th>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Monthly</th>
              </tr>
            </thead>
            <tbody>
              {estimate?.lineItems?.map((item) => (
                <tr key={item.id}>
                  <td data-label="Category"><span className={`cost-type-badge cost-type-${item.costCategory || item.type}`}>{item.costCategory || item.type}</span></td>
                  <td data-label="Resource">{item.label || item.id}</td>
                  <td data-label="Type">{item.type}</td>
                  <td className="mono" data-label="SKU">{item.sku}</td>
                  <td className="mono" data-label="Qty">{item.quantity}</td>
                  <td className="mono" data-label="Unit">{formatAud(item.unitPrice)}</td>
                  <td className="mono" data-label="Monthly">{formatAud(item.monthlyCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'simulate' && (
        <section>
          {scenarioResult && (
            <div className="card" style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>What-if result (applied to this app)</h3>
              <p>
                Base {formatAud(scenarioResult.base.totalMonthly)}/mo → Projected{' '}
                {formatAud(scenarioResult.projected.totalMonthly)}/mo
              </p>
              <p
                style={{
                  marginTop: '0.5rem',
                  fontWeight: 600,
                  color: scenarioResult.savingsMonthly >= 0 ? 'var(--green)' : 'var(--red)',
                }}
              >
                {scenarioResult.savingsMonthly >= 0 ? 'Saves' : 'Costs extra'}{' '}
                {formatAud(Math.abs(scenarioResult.savingsMonthly))}/month
                {' '}({formatAud(Math.abs(scenarioResult.savingsAnnual))}/year)
                {scenarioResult.savingsPct != null && ` · ${scenarioResult.savingsPct}%`}
              </p>
            </div>
          )}
          <SimpleAzureSimulator
            applicationId={id}
            estimate={estimate}
            overrides={overrides}
            tshirtSize={tshirtSize}
            onScenario={setScenarioResult}
          />
        </section>
      )}

      {tab === 'augment' && (
        <section>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
            Simulate adding capacity on the current <strong>{tshirtSize}</strong> deployment.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {vmResources.map((r) => (
              <button key={r.id} className="btn" onClick={() => augmentVm(r.id)}>
                +1 {r.id} ({r.sku})
              </button>
            ))}
          </div>
          {augmentResult && (
            <div className="card">
              <h3 style={{ marginBottom: '0.75rem' }}>Augmentation Result</h3>
              <p>Base: {formatAud(augmentResult.baseMonthly)}/mo → Augmented: {formatAud(augmentResult.augmentedMonthly)}/mo</p>
              <p className="positive" style={{ marginTop: '0.5rem', fontWeight: 600 }}>
                Incremental: +{formatAud(augmentResult.incrementalMonthly)}/month (+{formatAud(augmentResult.incrementalAnnual)}/year)
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
