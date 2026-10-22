// What-if drivers (ingestion, archive, etc.) — server returns line items in AUD
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAud, platformBadge, platformLabel } from '../api';

const STORAGE_MULTIPLIERS = { GB: 1, TB: 1000, PB: 1_000_000 };

const STORAGE_LIMITS = {
  GB: { min: 100, max: 1_000_000, step: 1 },
  TB: { min: 0.1, max: 1000, step: 0.1 },
  PB: { min: 0.001, max: 1, step: 0.001 },
};

function toGb(val, unit) {
  return val * (STORAGE_MULTIPLIERS[unit] ?? 1);
}

function fromGb(gb, unit) {
  return gb / (STORAGE_MULTIPLIERS[unit] ?? 1);
}

const DATASET_SIZE_LIMITS = {
  GB: { min: 1, max: 1_000_000, step: 1 },
  TB: { min: 0.001, max: 1000, step: 0.001 },
  PB: { min: 0.000001, max: 10, step: 0.000001 },
};

function formatStorageValue(val, unit) {
  const decimals = unit === 'GB' ? 0 : unit === 'TB' ? 2 : 3;
  return Math.round(val * 10 ** decimals) / 10 ** decimals;
}

export default function CostDrivers() {
  const [scenarios, setScenarios] = useState([]);
  const [activeScenario, setActiveScenario] = useState('data_ingestion');
  const [value, setValue] = useState(1);
  const [datasetSize, setDatasetSize] = useState(500);
  const [datasetSizeUnit, setDatasetSizeUnit] = useState('GB');
  const [frequency, setFrequency] = useState('monthly');
  const [storageUnit, setStorageUnit] = useState('GB');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getCostDriverScenarios()
      .then((data) => {
        setScenarios(data);
        if (data.length) {
          const first = data[0];
          setActiveScenario(first.id);
          setValue(first.defaultValue);
          setDatasetSize(first.defaultDatasetSize ?? 500);
          setDatasetSizeUnit(first.defaultDatasetSizeUnit ?? 'GB');
          setFrequency(first.defaultFrequency ?? 'monthly');
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  const current = scenarios.find((s) => s.id === activeScenario);
  const isArchive = activeScenario === 'archive_storage';
  const isIngestion = activeScenario === 'data_ingestion';
  const inputLimits = isArchive ? STORAGE_LIMITS[storageUnit] : { min: current?.min, max: current?.max, step: 1 };
  const datasetSizeLimits = DATASET_SIZE_LIMITS[datasetSizeUnit] || DATASET_SIZE_LIMITS.GB;

  const ingestionPreview = isIngestion && current ? (() => {
    const sizeGb = toGb(datasetSize, datasetSizeUnit);
    const totalGb = value * sizeGb;
    const freq = current.ingestionFrequencies?.find((f) => f.id === frequency);
    const freqMeta = {
      once: { eventsPerMonth: 0, oneTime: true },
      daily: { eventsPerMonth: 30 },
      weekly: { eventsPerMonth: 52 / 12 },
      monthly: { eventsPerMonth: 1 },
      quarterly: { eventsPerMonth: 1 / 3 },
      yearly: { eventsPerMonth: 1 / 12 },
    }[frequency] || { eventsPerMonth: 1 };
    const monthlyGb = freqMeta.oneTime ? 0 : totalGb * freqMeta.eventsPerMonth;
    return { totalGb, monthlyGb, freqLabel: freq?.label || frequency };
  })() : null;

  const selectScenario = (id) => {
    const s = scenarios.find((sc) => sc.id === id);
    setActiveScenario(id);
    setValue(s?.defaultValue ?? 1);
    setDatasetSize(s?.defaultDatasetSize ?? 500);
    setDatasetSizeUnit(s?.defaultDatasetSizeUnit ?? 'GB');
    setFrequency(s?.defaultFrequency ?? 'monthly');
    setStorageUnit(s?.defaultStorageUnit || 'GB');
    setResult(null);
    setError(null);
  };

  const handleStorageUnitChange = (newUnit) => {
    const gb = toGb(value, storageUnit);
    setValue(formatStorageValue(fromGb(gb, newUnit), newUnit));
    setStorageUnit(newUnit);
  };

  const handleDatasetSizeUnitChange = (newUnit) => {
    const gb = toGb(datasetSize, datasetSizeUnit);
    setDatasetSize(formatStorageValue(fromGb(gb, newUnit), newUnit));
    setDatasetSizeUnit(newUnit);
  };

  const runSimulation = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = { scenarioId: activeScenario, value };
      if (activeScenario === 'archive_storage') {
        payload.unit = storageUnit;
      }
      if (activeScenario === 'data_ingestion') {
        payload.datasetCount = value;
        payload.datasetSize = datasetSize;
        payload.datasetSizeUnit = datasetSizeUnit;
        payload.frequency = frequency;
      }
      const data = await api.simulateCostDriver(payload);
      setResult(data);
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  if (!scenarios.length && !error) {
    return <div className="loading">Loading simulation scenarios…</div>;
  }

  return (
    <>
      <header className="page-header">
        <h1>Cost Drivers</h1>
        <p>
          Simulate portfolio-wide impact from data ingestion, user growth, or archive storage.
          Enter a value to see what increases and how much it costs.
        </p>
      </header>

      <div className="sim-scenario-tabs">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`sim-scenario-tab ${activeScenario === s.id ? 'active' : ''}`}
            onClick={() => selectScenario(s.id)}
          >
            <strong>{s.label}</strong>
            <span>
              {s.inputMode === 'ingestion'
                ? 'count · size · freq'
                : s.storageUnits
                  ? s.storageUnits.join('/')
                  : s.inputUnit}
            </span>
          </button>
        ))}
      </div>

      {current && (
        <section className="section">
          <div className="card sim-input-card">
            <h2>{current.label}</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>{current.description}</p>

            {isIngestion ? (
              <div className="sim-input-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Number of datasets</label>
                  <input
                    type="number"
                    min={current.min}
                    max={current.max}
                    step={1}
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Size per dataset</label>
                  <div className="sim-input-with-unit">
                    <input
                      type="number"
                      min={datasetSizeLimits.min}
                      max={datasetSizeLimits.max}
                      step={datasetSizeLimits.step}
                      value={datasetSize}
                      onChange={(e) => setDatasetSize(Number(e.target.value))}
                      onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
                    />
                    <select
                      className="sim-unit-select"
                      value={datasetSizeUnit}
                      onChange={(e) => handleDatasetSizeUnitChange(e.target.value)}
                      aria-label="Dataset size unit"
                    >
                      {['GB', 'TB', 'PB'].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Ingestion frequency</label>
                  <select
                    className="sim-frequency-select"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                  >
                    {(current.ingestionFrequencies || []).map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary sim-run-btn" onClick={runSimulation} disabled={loading}>
                  {loading ? 'Simulating…' : 'Simulate Impact'}
                </button>
              </div>
            ) : (
              <div className="sim-input-row">
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label>{current.inputLabel}</label>
                  <input
                    type="number"
                    min={inputLimits.min}
                    max={inputLimits.max}
                    step={inputLimits.step}
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
                  />
                </div>
                {isArchive ? (
                  <select
                    className="sim-unit-select"
                    value={storageUnit}
                    onChange={(e) => handleStorageUnitChange(e.target.value)}
                    aria-label="Storage unit"
                  >
                    {(current.storageUnits || ['GB', 'TB', 'PB']).map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                ) : (
                  <span className="sim-unit">{current.inputUnit}</span>
                )}
                <button className="btn btn-primary" onClick={runSimulation} disabled={loading}>
                  {loading ? 'Simulating…' : 'Simulate Impact'}
                </button>
              </div>
            )}

            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
              Affects: {current.affectedApplications?.map((id) => id.replace(/-/g, ' ')).join(', ')}
              {isArchive && (
                <> · Equivalent: <strong>{toGb(value, storageUnit).toLocaleString()} GB</strong></>
              )}
              {isIngestion && ingestionPreview && (
                <>
                  {' · '}
                  {frequency === 'once' ? (
                    <>Footprint: <strong>{Math.round(ingestionPreview.totalGb).toLocaleString()} GB</strong></>
                  ) : (
                    <>
                      ~<strong>{Math.round(ingestionPreview.monthlyGb).toLocaleString()} GB/mo</strong> ingested
                      ({ingestionPreview.freqLabel.toLowerCase()})
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </section>
      )}

      {error && <div className="error" style={{ padding: '1rem', marginBottom: '1rem' }}>{error}</div>}

      {result && (
        <>
          <div className="cards">
            <div className="card">
              <div className="card-label">Portfolio Impact</div>
              <div className="card-value positive">+{formatAud(result.portfolioIncrementalMonthly)}<span style={{ fontSize: '0.9rem', fontWeight: 500 }}>/mo</span></div>
            </div>
            <div className="card">
              <div className="card-label">Annual Increase</div>
              <div className="card-value">+{formatAud(result.portfolioIncrementalAnnual)}</div>
            </div>
            <div className="card">
              <div className="card-label">Azure Infra</div>
              <div className="card-value" style={{ fontSize: '1.35rem' }}>+{formatAud(result.portfolioBreakdown?.azure)}</div>
            </div>
            <div className="card">
              <div className="card-label">Subscription + Licence</div>
              <div className="card-value" style={{ fontSize: '1.35rem' }}>
                +{formatAud((result.portfolioBreakdown?.subscription || 0) + (result.portfolioBreakdown?.license || 0))}
              </div>
            </div>
            {result.portfolioSystemCostsOneTime > 0 && (
              <div className="card">
                <div className="card-label">One-Time System Cost</div>
                <div className="card-value impact">+{formatAud(result.portfolioSystemCostsOneTime)}</div>
              </div>
            )}
          </div>

          <section className="section">
            <h2>Impact by Application</h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Simulating <strong>{result.inputDisplay ?? `${result.inputValue.toLocaleString()} ${result.scenario.inputUnit}`}</strong> — {result.scenario.label}
            </p>

            <div className="sim-results">
              {result.results.map((r) => (
                <div className="sim-result-card" key={r.applicationId}>
                  <div className="sim-result-header">
                    <div>
                      <Link to={`/applications/${r.applicationId}`} className="app-link" style={{ fontSize: '1.05rem' }}>
                        {r.applicationName}
                      </Link>
                      <span className={`badge ${platformBadge(r.platform)}`} style={{ marginLeft: '0.5rem' }}>
                        {platformLabel(r.platform)}
                      </span>
                    </div>
                    <div className="sim-result-cost">
                      {r.error ? (
                        <span className="negative">{r.error}</span>
                      ) : (
                        <>
                          <span className="positive">+{formatAud(r.incrementalMonthly)}/mo</span>
                          <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>+{formatAud(r.incrementalAnnual)}/yr</span>
                        </>
                      )}
                    </div>
                  </div>

                  {!r.error && (
                    <>
                      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0.5rem 0' }}>
                        <strong>{r.driverName}</strong>
                        {r.units != null && ` · ${r.units} ${r.unitLabel || 'units'}`}
                        {r.note && ` · ${r.note}`}
                      </p>
                      {r.driverDescription && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>{r.driverDescription}</p>
                      )}

                      {r.incrementalBreakdown && (
                        <div className="sim-breakdown">
                          <span>Azure <strong className="mono">+{formatAud(r.incrementalBreakdown.azure)}</strong></span>
                          <span>Subscription <strong className="mono">+{formatAud(r.incrementalBreakdown.subscription)}</strong></span>
                          <span>Licence <strong className="mono">+{formatAud(r.incrementalBreakdown.license)}</strong></span>
                        </div>
                      )}

                      {r.systemCostsOneTime > 0 && (
                        <p className="impact" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                          +{formatAud(r.systemCostsOneTime)} one-time system cost
                        </p>
                      )}

                      {r.impacts?.length > 0 && (
                        <div className="sim-impacts">
                          <div className="sim-impacts-label">What increases</div>
                          <ul>
                            {r.impacts.map((imp, i) => (
                              <li key={i}>
                                <span className={`cost-type-badge cost-type-${imp.type}`}>{imp.type}</span>
                                <span>{imp.resource}</span>
                                <span className="mono" style={{ color: 'var(--muted)' }}>{imp.change}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
