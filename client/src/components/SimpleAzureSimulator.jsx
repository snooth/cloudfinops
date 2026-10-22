// Azure what-if builder — offline VM catalog, quote in AUD; can embed in app detail or run standalone
import { useEffect, useMemo, useState, useCallback } from 'react';
import { api, formatAud } from '../api';

const VM_TYPES = new Set(['vm', 'aks_node', 'aro_node']);
const STORAGE_TYPES = new Set(['storage', 'disk', 'blob']);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Break estimate line items into VM vs storage buckets for "your actual cost" comparison
function summarizeActualFromEstimate(est, appName = null) {
  if (!est) return null;
  const items = est.lineItems || [];
  const elements = items
    .filter((i) => VM_TYPES.has(i.type) || STORAGE_TYPES.has(i.type))
    .map((i) => ({
      id: i.id,
      appName,
      kind: VM_TYPES.has(i.type) ? 'vm' : 'storage',
      label: i.label || i.id,
      sku: i.sku,
      quantity: i.quantity,
      monthlyCost: money(i.monthlyCost),
    }));
  const vmMonthly = money(
    elements.filter((e) => e.kind === 'vm').reduce((s, e) => s + e.monthlyCost, 0)
  );
  const storageMonthly = money(
    elements.filter((e) => e.kind === 'storage').reduce((s, e) => s + e.monthlyCost, 0)
  );
  return {
    totalMonthly: money(est.totalMonthly),
    totalAnnual: money(est.totalAnnual ?? est.totalMonthly * 12),
    vmMonthly,
    storageMonthly,
    infraMonthly: money(vmMonthly + storageMonthly),
    applicationCount: 1,
    applicationName: appName || est.applicationName || null,
    elements,
    source: 'app',
  };
}

function summarizeActualFromDashboard(dash) {
  if (!dash) return null;
  const elements = [];
  let vmMonthly = 0;
  let storageMonthly = 0;

  for (const app of dash.applications || []) {
    const breakdown = app.breakdown || {};
    for (const [type, group] of Object.entries(breakdown)) {
      if (!group) continue;
      if (VM_TYPES.has(type)) {
        vmMonthly += group.subtotal || 0;
        for (const item of group.items || []) {
          elements.push({
            id: `${app.id}:${item.id}`,
            appName: app.name,
            kind: 'vm',
            label: item.label || item.id,
            sku: item.sku,
            quantity: item.quantity,
            monthlyCost: money(item.monthlyCost),
          });
        }
      } else if (STORAGE_TYPES.has(type)) {
        storageMonthly += group.subtotal || 0;
        for (const item of group.items || []) {
          elements.push({
            id: `${app.id}:${item.id}`,
            appName: app.name,
            kind: 'storage',
            label: item.label || item.id,
            sku: item.sku,
            quantity: item.quantity,
            monthlyCost: money(item.monthlyCost),
          });
        }
      }
    }
  }

  return {
    totalMonthly: money(dash.totalPortfolioMonthly),
    totalAnnual: money(dash.totalPortfolioAnnual),
    vmMonthly: money(vmMonthly),
    storageMonthly: money(storageMonthly),
    infraMonthly: money(vmMonthly + storageMonthly),
    applicationCount: dash.applicationCount || (dash.applications || []).length,
    applicationName: null,
    elements: elements.sort((a, b) => b.monthlyCost - a.monthlyCost),
    source: 'portfolio',
  };
}

export default function SimpleAzureSimulator({
  applicationId,
  estimate,
  overrides,
  tshirtSize,
  onScenario,
  standalone = false,
}) {
  const [region, setRegion] = useState('australiaeast');
  const [menu, setMenu] = useState(null);
  const [lines, setLines] = useState([]);
  const [quote, setQuote] = useState(null);
  const [resourceAlts, setResourceAlts] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState('vm');
  const [selectedOption, setSelectedOption] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [vmSeries, setVmSeries] = useState('');
  const [vmQuery, setVmQuery] = useState('');
  const [actualCost, setActualCost] = useState(null);
  const [showActualElements, setShowActualElements] = useState(false);
  const [applicationName, setApplicationName] = useState('Application 1');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState(null);
  const [savedProjects, setSavedProjects] = useState([]);
  const [saveStatus, setSaveStatus] = useState(null);
  const [dirty, setDirty] = useState(false);

  const baseMonthly = actualCost?.totalMonthly || estimate?.totalMonthly || 0;
  const baseAnnual = actualCost?.totalAnnual
    ?? (baseMonthly ? Math.round(baseMonthly * 12 * 100) / 100 : 0);
  const simMonthly = quote?.totalMonthly ?? 0;
  const simAnnual = quote?.totalAnnual ?? Math.round(simMonthly * 12 * 100) / 100;
  const deltaMonthly = quote != null
    ? Math.round((simMonthly - baseMonthly) * 100) / 100
    : 0;
  const deltaAnnual = quote != null
    ? Math.round((simAnnual - baseAnnual) * 100) / 100
    : 0;
  const isSaving = deltaMonthly < 0;
  const isIncrease = deltaMonthly > 0;
  const deltaLabel = isSaving ? 'Cost saving' : isIncrease ? 'Cost increase' : 'No change';
  const actualScopeLabel = actualCost?.source === 'portfolio'
    ? 'Applications portfolio'
    : (actualCost?.applicationName || 'This application');

  const refreshSavedProjects = useCallback(async () => {
    try {
      const data = await api.listSimProjects();
      setSavedProjects(data.projects || []);
    } catch {
      /* no saved sim projects yet — fine on first visit or offline */
    }
  }, []);


  const loadMenu = useCallback(async (regionId, series = vmSeries, q = vmQuery) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSimplePricing(regionId, {
        series: series || undefined,
        q: q || undefined,
      });
      setMenu(data);
      setRegion(data.region || regionId);
      const cat = data.categories?.find((c) => c.id === activeCategory) || data.categories?.[0];
      if (cat && !(cat.options || []).some((o) => o.id === selectedOption)) {
        setSelectedOption(cat.options?.[0]?.id || '');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, selectedOption, vmSeries, vmQuery]);

  useEffect(() => {
    loadMenu(region, '', '').catch(() => {});
    if (estimate?.lineItems?.length && !standalone) {
      const seeded = estimate.lineItems
        .filter((i) => ['vm', 'aks_node', 'aro_node', 'storage'].includes(i.type))
        .map((i) => ({
          id: i.id,
          type: ['vm', 'aks_node', 'aro_node'].includes(i.type) ? 'vm' : 'storage',
          label: i.label || i.id,
          blurb: i.sku,
          optionId: i.sku,
          armSkuName: ['vm', 'aks_node', 'aro_node'].includes(i.type) ? i.sku : undefined,
          sku: i.sku,
          storageSku: i.type === 'storage' ? i.sku : undefined,
          gb: i.type === 'storage' ? i.quantity : undefined,
          quantity: i.type === 'storage' ? 1 : i.quantity,
          locked: true,
          resourceId: i.id,
          unitMonthly: i.unitPrice,
          monthly: i.monthlyCost,
          applicationName: estimate?.applicationName || 'This application',
        }));
      const normalized = seeded.map((l) => {
        if (l.type === 'storage') {
          return {
            ...l,
            quantity: 1,
            unitMonthly: l.monthly,
            label: `${l.label} (${l.gb || '?'} GB)`,
            blurb: l.sku,
          };
        }
        return l;
      });
      setLines(normalized);
      setApplicationName(estimate?.applicationName || 'This application');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, tshirtSize, standalone]);

  useEffect(() => {
    refreshSavedProjects();
  }, [refreshSavedProjects]);

  // Baseline for delta: this app's estimate, or whole portfolio when standalone Simulate page
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!standalone && estimate) {
          if (!cancelled) {
            setActualCost(summarizeActualFromEstimate(estimate));
          }
          return;
        }
        const dash = await api.getDashboard();
        if (!cancelled) setActualCost(summarizeActualFromDashboard(dash));
      } catch {
        if (!cancelled && estimate) {
          setActualCost(summarizeActualFromEstimate(estimate));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [standalone, estimate, applicationId, tshirtSize]);


  // Don't hammer /pricing/simple on every keystroke in the VM search box
  useEffect(() => {
    if (activeCategory !== 'vm' && activeCategory !== 'software') return undefined;
    const t = setTimeout(() => {
      loadMenu(region, vmSeries, vmQuery).catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmSeries, vmQuery, activeCategory]);

  useEffect(() => {
    if (!lines.length) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
          const comps = lines.map((l) => {
          if (l.type === 'vm') {
            return {
              id: l.id,
              type: 'vm',
              armSkuName: l.armSkuName || l.optionId || l.sku,
              quantity: l.quantity,
              label: l.label,
            };
          }
          if (l.type === 'software' || l.type === 'license') {
            return {
              id: l.id,
              type: 'software',
              optionId: l.optionId,
              quantity: l.quantity,
              label: l.label,
              blurb: l.blurb,
              unitMonthly: l.unitMonthly,
            };
          }
          if (l.optionId && !l.locked) {
            return { id: l.id, optionId: l.optionId, quantity: l.quantity };
          }
          if (l.storageSku && l.gb) {
            return {
              id: l.id,
              type: 'storage',
              storageSku: l.storageSku,
              gb: l.gb,
              quantity: l.quantity,
              label: l.label,
            };
          }
          return { id: l.id, optionId: l.optionId, quantity: l.quantity, unitMonthly: l.unitMonthly, type: l.type, label: l.label };
        });
        const q = await api.quoteSimplePricing({ components: comps, region });
        setQuote(q);
      } catch (e) {
        setError(e.message);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [lines, region]);

  const category = useMemo(
    () => menu?.categories?.find((c) => c.id === activeCategory),
    [menu, activeCategory]
  );

  const selected = useMemo(
    () => category?.options?.find((o) => o.id === selectedOption),
    [category, selectedOption]
  );

  const lineMonthly = useCallback((line) => {
    const unit = line.unitMonthly ?? (quote?.lines?.find((q) => q.id === line.id)?.unitMonthly);
    if (unit != null) return money(unit * (Number(line.quantity) || 0));
    return money(line.monthly || 0);
  }, [quote]);

  const knownAppNames = useMemo(() => {
    const set = new Set();
    lines.forEach((l) => {
      const n = (l.applicationName || '').trim();
      if (n) set.add(n);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [lines]);

  const lineGroups = useMemo(() => {
    const map = new Map();
    for (const line of lines) {
      const name = (line.applicationName || 'Ungrouped').trim() || 'Ungrouped';
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(line);
    }
    return [...map.entries()].map(([name, groupLines]) => ({
      name,
      lines: groupLines,
      monthly: money(groupLines.reduce((s, l) => s + lineMonthly(l), 0)),
    }));
  }, [lines, lineMonthly]);

  const addLine = () => {
    if (!selected) return;
    const app = (applicationName || '').trim() || 'Ungrouped';
    setLines((prev) => [
      ...prev,
      {
        id: `sim_${selected.id}_${Date.now()}`,
        type: selected.type,
        label: selected.armSkuName
          ? selected.armSkuName.replace(/^Standard_/, '')
          : selected.label,
        blurb: selected.series || selected.blurb,
        optionId: selected.id,
        armSkuName: selected.armSkuName,
        storageSku: selected.storageSku,
        gb: selected.gb,
        quantity: Math.max(1, Number(quantity) || 1),
        unitMonthly: selected.unitMonthly,
        monthly: selected.unitMonthly * Math.max(1, Number(quantity) || 1),
        applicationName: app,
        locked: false,
        meterId: selected.meterId,
        productName: selected.productName,
      },
    ]);
    setDirty(true);
    setSaveStatus(null);
  };

  const updateQty = (id, qty) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const q = Math.max(0, Number(qty) || 0);
        return { ...l, quantity: q, monthly: (l.unitMonthly || 0) * q };
      })
    );
    setDirty(true);
    setSaveStatus(null);
  };

  const updateLineApp = (id, name) => {
    const app = String(name || '').trim() || 'Ungrouped';
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, applicationName: app } : l)));
    setDirty(true);
    setSaveStatus(null);
  };

  const removeLine = (id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setDirty(true);
    setSaveStatus(null);
  };

  const renameGroup = (oldName, newName) => {
    const next = String(newName || '').trim() || 'Ungrouped';
    if (next === oldName) return;
    setLines((prev) =>
      prev.map((l) =>
        (l.applicationName || 'Ungrouped') === oldName ? { ...l, applicationName: next } : l
      )
    );
    if (applicationName === oldName) setApplicationName(next);
    setDirty(true);
    setSaveStatus(null);
  };

  const changeRegion = async (regionId) => {
    setRegion(regionId);
    setDirty(true);
    await loadMenu(regionId, vmSeries, vmQuery);
  };

  const loadProject = async (id) => {
    setLoading(true);
    setError(null);
    setSaveStatus(null);
    try {
      const project = await api.getSimProject(id);
      setProjectId(project.id);
      setProjectName(project.name);
      setRegion(project.region || 'australiaeast');
      setLines(
        (project.lines || []).map((l) => ({
          ...l,
          applicationName: l.applicationName || 'Ungrouped',
        }))
      );
      const names = [...new Set((project.lines || []).map((l) => l.applicationName).filter(Boolean))];
      setApplicationName(names[0] || 'Application 1');
      setDirty(false);
      setSaveStatus(`Loaded “${project.name}”`);
      await loadMenu(project.region || 'australiaeast', vmSeries, vmQuery);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveProject = async ({ asNew = false } = {}) => {
    const name = (projectName || '').trim();
    if (!name) {
      setError('Enter a project name before saving');
      return;
    }
    if (!lines.length) {
      setError('Add at least one component before saving');
      return;
    }
    setLoading(true);
    setError(null);
    setSaveStatus(null);
    try {
      // Snapshot latest unit rates into the saved project so reopening matches what they saw
      const withPrices = lines.map((l) => {
        const qLine = quote?.lines?.find((q) => q.id === l.id);
        return {
          ...l,
          unitMonthly: qLine?.unitMonthly ?? l.unitMonthly,
          monthly: qLine?.monthly ?? l.monthly,
        };
      });
      const body = {
        name,
        region,
        lines: withPrices,
      };
      let project;
      if (projectId && !asNew) {
        project = await api.updateSimProject(projectId, body);
      } else {
        project = await api.saveSimProject(body);
      }
      setProjectId(project.id);
      setProjectName(project.name);
      setDirty(false);
      setSaveStatus(`Saved “${project.name}” · ${formatAud(project.totalMonthly)}/mo`);
      await refreshSavedProjects();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteProject = async (id, name) => {
    if (!window.confirm(`Delete saved project “${name}”? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await api.deleteSimProject(id);
      if (projectId === id) {
        setProjectId(null);
        setSaveStatus(null);
      }
      await refreshSavedProjects();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const newProject = () => {
    setProjectId(null);
    setProjectName('');
    setLines([]);
    setQuote(null);
    setResourceAlts({});
    setApplicationName('Application 1');
    setDirty(false);
    setSaveStatus(null);
  };


  const loadAlts = async (line) => {
    if (line.type !== 'vm') return;
    const sku = line.armSkuName || line.optionId || line.sku;
    if (!sku) return;
    setLoading(true);
    try {
      const alts = await api.getSimpleAlternatives(sku, region);
      setResourceAlts((m) => ({ ...m, [line.id]: alts }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const applySwap = async (line, armSkuName) => {
    if (!applicationId || !line.resourceId) {
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== line.id) return l;
          return {
            ...l,
            armSkuName,
            optionId: armSkuName,
            sku: armSkuName,
            label: armSkuName.replace('Standard_', ''),
            blurb: 'Swapped SKU',
          };
        })
      );
      setDirty(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.runScenario(applicationId, {
        overrides: { ...overrides, tshirtSize },
        swaps: [{ resourceId: line.resourceId, armSkuName, sku: armSkuName }],
      });
      onScenario?.(result);
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== line.id) return l;
          return {
            ...l,
            armSkuName,
            optionId: armSkuName,
            sku: armSkuName,
            label: `${l.label.split('(')[0].trim()} → ${armSkuName.replace('Standard_', '')}`,
          };
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="simple-sim">
      <div className="simple-sim-header">
        <div>
          {!standalone && <h2 className="simple-sim-title">Cost simulator</h2>}
          <p className="simple-sim-sub">
            Only <strong>AU East</strong> and <strong>AU Central</strong>. Full catalog of virtual machines
            (all series — Esv5, Dsv5, etc.), disks (S/E/P), and blob storage. Pick size × quantity for monthly AUD.
          </p>
          {menu?.vmTotalAvailable != null && (
            <p className="simple-sim-help" style={{ marginTop: '0.35rem' }}>
              Offline catalog: <strong>{menu.vmTotalAvailable.toLocaleString()}</strong> VM sizes
              {menu.vmMatched != null && menu.vmMatched !== menu.vmTotalAvailable
                ? ` · showing ${menu.vmMatched.toLocaleString()} after filter`
                : ''}
              {!menu.catalogReady ? ' · limited baseline (download full catalog in Admin → Configuration)' : ''}
            </p>
          )}
        </div>
        <div className="simple-sim-totals">
          <div className="simple-sim-total-card simple-sim-total-card--actual">
            <div className="card-label">Currently paying</div>
            {actualCost || baseMonthly > 0 ? (
              <>
                <div className="simple-sim-compare-row">
                  <span className="simple-sim-compare-k">Monthly</span>
                  <span className="simple-sim-total-value simple-sim-total-value--sm">
                    {formatAud(baseMonthly)}
                  </span>
                </div>
                <div className="simple-sim-compare-row">
                  <span className="simple-sim-compare-k">Yearly</span>
                  <span className="simple-sim-total-value simple-sim-total-value--sm">
                    {formatAud(baseAnnual)}
                  </span>
                </div>
                <div className="simple-sim-total-meta">
                  {actualCost?.source === 'portfolio'
                    ? `${actualCost.applicationCount} application${actualCost.applicationCount === 1 ? '' : 's'} · AUD`
                    : `${actualScopeLabel} · AUD`}
                </div>
                {actualCost?.elements?.length > 0 && (
                  <div className="simple-sim-total-meta">
                    <button
                      type="button"
                      className="simple-sim-link-btn"
                      onClick={() => setShowActualElements((v) => !v)}
                    >
                      {showActualElements ? 'Hide' : 'Show'}{' '}
                      {actualCost.elements.length} VM/storage item
                      {actualCost.elements.length === 1 ? '' : 's'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="simple-sim-total-meta">No portfolio total loaded</div>
            )}
          </div>

          <div className="simple-sim-total-card">
            <div className="card-label">Simulate (this estimate)</div>
            <div className="simple-sim-compare-row">
              <span className="simple-sim-compare-k">Monthly</span>
              <span className="simple-sim-total-value simple-sim-total-value--sm">
                {formatAud(simMonthly)}
              </span>
            </div>
            <div className="simple-sim-compare-row">
              <span className="simple-sim-compare-k">Yearly</span>
              <span className="simple-sim-total-value simple-sim-total-value--sm">
                {formatAud(simAnnual)}
              </span>
            </div>
            <div className="simple-sim-total-meta">What-if build · AUD</div>
          </div>

          {baseMonthly > 0 && quote != null && (
            <div
              className={`simple-sim-total-card simple-sim-total-card--delta ${
                isSaving ? 'is-saving' : isIncrease ? 'is-increase' : 'is-flat'
              }`}
            >
              <div className="card-label">{deltaLabel}</div>
              <div className="simple-sim-compare-row">
                <span className="simple-sim-compare-k">Monthly</span>
                <span
                  className="simple-sim-total-value simple-sim-total-value--sm"
                  style={{
                    color: isSaving ? 'var(--green)' : isIncrease ? 'var(--red)' : 'var(--text)',
                  }}
                >
                  {isSaving ? '−' : isIncrease ? '+' : ''}
                  {formatAud(Math.abs(deltaMonthly))}
                </span>
              </div>
              <div className="simple-sim-compare-row">
                <span className="simple-sim-compare-k">Yearly</span>
                <span
                  className="simple-sim-total-value simple-sim-total-value--sm"
                  style={{
                    color: isSaving ? 'var(--green)' : isIncrease ? 'var(--red)' : 'var(--text)',
                  }}
                >
                  {deltaAnnual < 0 ? '−' : deltaAnnual > 0 ? '+' : ''}
                  {formatAud(Math.abs(deltaAnnual))}
                </span>
              </div>
              <div className="simple-sim-total-meta">
                {isSaving
                  ? `Simulate is lower than ${actualScopeLabel.toLowerCase()}`
                  : isIncrease
                    ? `Simulate is higher than ${actualScopeLabel.toLowerCase()}`
                    : 'Simulate matches current total'}
              </div>
              <div className="simple-sim-total-meta simple-sim-delta-breakdown">
                Paying {formatAud(baseMonthly)}/mo ({formatAud(baseAnnual)}/yr)
                {' → '}
                estimate {formatAud(simMonthly)}/mo ({formatAud(simAnnual)}/yr)
              </div>
            </div>
          )}
        </div>
      </div>

      {showActualElements && actualCost?.elements?.length > 0 && (
        <div className="simple-sim-actual-elements card">
          <h3>
            Applications · VM &amp; storage elements
            <span className="simple-sim-help" style={{ display: 'inline', marginLeft: '0.5rem' }}>
              {formatAud(actualCost.infraMonthly)}/mo of {formatAud(actualCost.totalMonthly)} total
              (total includes licences &amp; subscriptions where modelled)
            </span>
          </h3>
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  {actualCost.source === 'portfolio' && <th>Application</th>}
                  <th>Element</th>
                  <th>Type</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Monthly</th>
                </tr>
              </thead>
              <tbody>
                {actualCost.elements.map((el) => (
                  <tr key={el.id}>
                    {actualCost.source === 'portfolio' && (
                      <td data-label="Application">{el.appName}</td>
                    )}
                    <td data-label="Element">
                      <strong>{el.label}</strong>
                    </td>
                    <td data-label="Type">{el.kind === 'vm' ? 'VM' : 'Storage'}</td>
                    <td data-label="SKU" className="mono">{el.sku || '—'}</td>
                    <td data-label="Qty" className="mono">{el.quantity}</td>
                    <td data-label="Monthly" className="mono">
                      {formatAud(el.monthlyCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}
      {saveStatus && !error && (
        <div className="simple-sim-save-toast" style={{ marginBottom: '1rem' }}>{saveStatus}</div>
      )}

      <div className="simple-sim-toolbar card">
        <div className="simple-sim-toolbar-save">
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '12rem' }}>
            <label htmlFor="sim-project-name">Project name</label>
            <input
              id="sim-project-name"
              type="text"
              placeholder="e.g. CDP redesign · AU East"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="simple-sim-toolbar-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || !lines.length}
              onClick={() => saveProject()}
            >
              {projectId ? 'Save project' : 'Save as project'}
            </button>
            {projectId && (
              <button
                type="button"
                className="btn"
                disabled={loading || !lines.length}
                onClick={() => saveProject({ asNew: true })}
              >
                Save as new
              </button>
            )}
            <button type="button" className="btn" disabled={loading} onClick={newProject}>
              New blank
            </button>
          </div>
          {projectId && (
            <p className="simple-sim-help" style={{ margin: 0 }}>
              Editing saved project{dirty ? ' · unsaved changes' : ' · up to date'}
            </p>
          )}
        </div>

        <div className="simple-sim-projects">
          <h3>Saved projects</h3>
          {!savedProjects.length && (
            <p className="simple-sim-help">No saved projects yet — build an estimate and save it.</p>
          )}
          {savedProjects.length > 0 && (
            <div className="simple-sim-project-list">
              {savedProjects.map((p) => (
                <div
                  key={p.id}
                  className={`simple-sim-project-item ${p.id === projectId ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="simple-sim-project-open"
                    disabled={loading}
                    onClick={() => loadProject(p.id)}
                  >
                    <strong>{p.name}</strong>
                    <span>
                      {formatAud(p.totalMonthly)}/mo · {p.lineCount} items ·{' '}
                      {p.applicationCount} app{p.applicationCount === 1 ? '' : 's'}
                    </span>
                    <span className="simple-sim-project-date">
                      {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={loading}
                    onClick={() => deleteProject(p.id, p.name)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="simple-sim-region">
        <span className="simple-sim-region-label">Region</span>
        <div className="simple-sim-region-pills">
          {(menu?.regions || [
            { id: 'australiaeast', label: 'AU East', short: 'Sydney / NSW' },
            { id: 'australiacentral', label: 'AU Central', short: 'Canberra' },
          ]).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`simple-sim-pill ${region === r.id ? 'active' : ''}`}
              onClick={() => changeRegion(r.id)}
              disabled={loading}
            >
              <strong>{r.label}</strong>
              <span>{r.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="simple-sim-grid">
        <div className="simple-sim-builder card">
          <h3>Add a component</h3>
          <p className="simple-sim-help">
            Group VMs and storage under an <strong>application name</strong> so costs roll up clearly.
          </p>

          <div className="form-group">
            <label htmlFor="sim-app-name">Application (cost group)</label>
            <input
              id="sim-app-name"
              type="text"
              list="sim-app-name-list"
              placeholder="e.g. Cloudera CDP, Shared storage"
              value={applicationName}
              onChange={(e) => setApplicationName(e.target.value)}
            />
            <datalist id="sim-app-name-list">
              {knownAppNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <p className="simple-sim-help">
              New components are tagged with this name. Change it before adding different apps.
            </p>
          </div>

          <div className="form-group">
            <label>Type</label>
            <div className="simple-sim-type-row">
              {(menu?.categories || []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`simple-sim-pill ${activeCategory === c.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveCategory(c.id);
                    setVmQuery('');
                    setVmSeries('');
                    setSelectedOption(c.options?.[0]?.id || '');
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {category?.help && <p className="simple-sim-help">{category.help}</p>}
          </div>

          {activeCategory === 'vm' && (
            <>
              <div className="form-group">
                <label>VM series</label>
                <select
                  value={vmSeries}
                  onChange={(e) => setVmSeries(e.target.value)}
                >
                  <option value="">All series ({menu?.vmTotalAvailable ?? '…'})</option>
                  {(menu?.vmSeries || []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Search VM</label>
                <input
                  type="search"
                  placeholder="e.g. E64s_v5, Esv5, D32s"
                  value={vmQuery}
                  onChange={(e) => setVmQuery(e.target.value)}
                />
              </div>
            </>
          )}

          {activeCategory === 'software' && (
            <div className="form-group">
              <label>Search software</label>
              <input
                type="search"
                placeholder="e.g. OpenShift, 64 vCPU, CDP, Defender"
                value={vmQuery}
                onChange={(e) => setVmQuery(e.target.value)}
              />
              {menu?.softwareTotalAvailable != null && (
                <p className="simple-sim-help">
                  {menu.softwareMatched != null && menu.softwareMatched !== menu.softwareTotalAvailable
                    ? `Showing ${menu.softwareMatched} of ${menu.softwareTotalAvailable}`
                    : `${menu.softwareTotalAvailable} software / licence options`}
                </p>
              )}
            </div>
          )}

          <div className="form-group simple-sim-option-group">
            <label>
              {activeCategory === 'software' ? 'Licence / product' : 'Size'}{' '}
              {loading ? '(loading…)' : `(${(category?.options || []).length})`}
            </label>
            <div
              className="simple-sim-option-picker"
              role="listbox"
              aria-label={activeCategory === 'software' ? 'Licence / product' : 'Size'}
            >
              {(category?.options || []).map((o) => {
                let title = o.label || o.armSkuName || o.id;
                let detail = o.blurb || '';
                if (o.type === 'vm' || o.armSkuName) {
                  title = (o.armSkuName || o.label || '').replace(/^Standard_/, '');
                  detail = [
                    o.series,
                    o.specLabel
                      || [
                        o.cores != null ? `${o.cores} vCPU` : null,
                        o.ramGb != null ? `${o.ramGb} GB` : null,
                      ].filter(Boolean).join(' · ') || null,
                    o.blurb && !String(o.blurb).includes('vCPU') && o.blurb !== o.series
                      ? o.blurb
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                } else if (o.type === 'software') {
                  title = o.label;
                  detail = o.blurb || o.productName || '';
                }
                const active = selectedOption === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`simple-sim-option-row ${active ? 'active' : ''}`}
                    onClick={() => setSelectedOption(o.id)}
                  >
                    <span className="simple-sim-option-text">
                      <span className="simple-sim-option-title">{title}</span>
                      {detail ? (
                        <span className="simple-sim-option-detail">{detail}</span>
                      ) : null}
                    </span>
                    <span className="simple-sim-option-price">
                      {o.unitMonthly != null ? `${formatAud(o.unitMonthly)}/mo` : '—'}
                    </span>
                  </button>
                );
              })}
              {!(category?.options || []).length && (
                <p className="simple-sim-help" style={{ margin: '0.75rem' }}>
                  No options match — clear search or pick another type.
                </p>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>{activeCategory === 'software' ? 'How many units' : 'How many'}</label>
            <input
              type="number"
              min={1}
              max={500}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>

          {selected && (
            <div className="simple-sim-math simple-sim-math--selected">
              <span>
                <strong style={{ display: 'block', marginBottom: '0.15rem' }}>
                  {selected.armSkuName
                    ? selected.armSkuName.replace(/^Standard_/, '')
                    : selected.label}
                </strong>
                {quantity || 1} × {formatAud(selected.unitMonthly)}
                {applicationName?.trim() ? ` · ${applicationName.trim()}` : ''}
              </span>
              <strong>= {formatAud((selected.unitMonthly || 0) * (quantity || 1))}/mo</strong>
            </div>
          )}

          <button type="button" className="btn btn-primary" onClick={addLine} disabled={!selected || loading}>
            Add to estimate
          </button>
        </div>

        <div className="simple-sim-lines">
          <div className="simple-sim-lines-header">
            <h3>Your estimate</h3>
            {lineGroups.length > 0 && (
              <span className="simple-sim-help">
                {lineGroups.length} application group{lineGroups.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {!lines.length && (
            <p className="simple-sim-help">No components yet — add virtual machines, disks, or storage.</p>
          )}

          {lineGroups.map((group) => (
            <div className="simple-sim-app-group" key={group.name}>
              <div className="simple-sim-app-group-header card">
                <div className="simple-sim-app-group-title">
                  <label className="simple-sim-app-group-label">
                    Application
                    <input
                      type="text"
                      defaultValue={group.name}
                      key={`app-name-${group.name}-${group.lines.map((l) => l.id).join(',')}`}
                      onBlur={(e) => renameGroup(group.name, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <span className="simple-sim-help">
                    {group.lines.length} component{group.lines.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="simple-sim-app-group-total">
                  <div className="card-label">Group total</div>
                  <strong className="mono">{formatAud(group.monthly)}/mo</strong>
                </div>
              </div>

              {group.lines.map((line) => {
                const alts = resourceAlts[line.id];
                const unit = line.unitMonthly ?? (quote?.lines?.find((q) => q.id === line.id)?.unitMonthly);
                const monthly = unit != null ? unit * line.quantity : line.monthly;
                return (
                  <div className="simple-sim-line card" key={line.id}>
                    <div className="simple-sim-line-top">
                      <div>
                        <div className="simple-sim-line-title">{line.label}</div>
                        <div className="simple-sim-line-blurb">
                          {line.blurb || line.armSkuName || line.optionId}
                          {line.resourceId ? ' · from this app' : ''}
                        </div>
                      </div>
                      <button type="button" className="btn" onClick={() => removeLine(line.id)}>
                        Remove
                      </button>
                    </div>

                    <div className="simple-sim-line-controls">
                      <label>
                        App
                        <input
                          type="text"
                          list="sim-app-name-list"
                          value={line.applicationName || ''}
                          onChange={(e) => updateLineApp(line.id, e.target.value)}
                        />
                      </label>
                      <label>
                        Qty
                        <input
                          type="number"
                          min={0}
                          value={line.quantity}
                          onChange={(e) => updateQty(line.id, e.target.value)}
                        />
                      </label>
                      <div className="simple-sim-math">
                        <span>
                          {line.quantity} × {formatAud(unit || 0)}
                        </span>
                        <strong>{formatAud(monthly || 0)}/mo</strong>
                      </div>
                    </div>

                    {line.type === 'vm' && (
                      <div className="simple-sim-line-actions">
                        <button type="button" className="btn" disabled={loading} onClick={() => loadAlts(line)}>
                          Cheaper same-size options
                        </button>
                      </div>
                    )}

                    {alts?.alternatives?.length > 0 && (
                      <div className="simple-sim-alts">
                        <p className="simple-sim-help">
                          Same CPU count only
                          {alts.current?.specLabel
                            ? ` (${alts.current.specLabel})`
                            : alts.current?.cores
                              ? ` (${alts.current.cores} vCPU${alts.current.ramGb != null ? ` · ${alts.current.ramGb} GB` : ''})`
                              : ''}
                          — no tiny boxes for big servers.
                        </p>
                        <div className="table-wrap">
                          <table className="responsive-table">
                            <thead>
                              <tr>
                                <th>Option</th>
                                <th>Per machine</th>
                                <th>You save</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {alts.alternatives.map((a) => (
                                <tr key={a.armSkuName}>
                                  <td>
                                    <strong>{a.label || a.armSkuName}</strong>
                                    <div className="simple-sim-line-blurb">{a.blurb || a.armSkuName}</div>
                                  </td>
                                  <td className="mono">{formatAud(a.monthly)}</td>
                                  <td
                                    className="mono"
                                    style={{ color: (a.savingsMonthly || 0) > 0 ? 'var(--green)' : 'var(--muted)' }}
                                  >
                                    {(a.savingsMonthly || 0) > 0
                                      ? `−${formatAud(a.savingsMonthly * line.quantity)}/mo`
                                      : '—'}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn"
                                      disabled={loading}
                                      onClick={() => applySwap(line, a.armSkuName)}
                                    >
                                      Try this
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {lineGroups.length > 1 && (
            <div className="simple-sim-breakdown card">
              <h3>Cost by application</h3>
              {lineGroups.map((g) => (
                <div className="simple-sim-break-row" key={g.name}>
                  <span>{g.name}</span>
                  <strong className="mono">{formatAud(g.monthly)}</strong>
                </div>
              ))}
              <div className="simple-sim-break-row simple-sim-break-row--total">
                <span>Total monthly</span>
                <strong className="mono">{formatAud(quote?.totalMonthly ?? lineGroups.reduce((s, g) => s + g.monthly, 0))}</strong>
              </div>
            </div>
          )}

          {quote?.lines?.length > 0 && (
            <div className="simple-sim-breakdown card">
              <h3>Line breakdown</h3>
              {quote.lines.map((l) => {
                const src = lines.find((x) => x.id === l.id);
                return (
                  <div className="simple-sim-break-row" key={l.id}>
                    <span>
                      {src?.applicationName ? (
                        <span className="simple-sim-app-tag">{src.applicationName}</span>
                      ) : null}
                      {l.label}
                      <span className="simple-sim-line-blurb"> · {l.formula}</span>
                    </span>
                    <strong className="mono">{formatAud(l.monthly)}</strong>
                  </div>
                );
              })}
              <div className="simple-sim-break-row simple-sim-break-row--total">
                <span>Total monthly · {quote.regionLabel}</span>
                <strong className="mono">{formatAud(quote.totalMonthly)}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
