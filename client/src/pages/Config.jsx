// Pricing region + catalog download — polls while Azure retail ingest runs (AUD consumption meters)
import { useEffect, useState, useRef } from 'react';
import { api, formatAud } from '../api';

export default function Config({ embedded = false } = {}) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [regionSaving, setRegionSaving] = useState(false);
  const [regionMessage, setRegionMessage] = useState(null);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [allRegions, setAllRegions] = useState(false);
  const [completeMode, setCompleteMode] = useState(false);
  const pollRef = useRef(null);

  const loadConfig = () => api.getConfig().then(setConfig);

  useEffect(() => {
    loadConfig().catch((e) => setError(e.message));
    api.getCatalogStatus().then(setDownloadStatus).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollDownload = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getCatalogStatus();
        setDownloadStatus(status);
        if (status.status === 'complete' || status.status === 'error') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setDownloading(false);
          await loadConfig();
        }
      } catch {
        /* transient error while download running — keep polling */
      }
    }, 1500);
  };

  const refreshPrices = async () => {
    await api.refreshPrices();
    await loadConfig();
  };

  const startFullDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      const result = await api.downloadFullCatalog({
        allRegions,
        mode: completeMode ? 'complete' : 'regional',
        notes: completeMode
          ? 'Complete primary-meter Azure retail catalog (AUD Consumption)'
          : 'Regional + Global Azure retail catalog (AUD Consumption)',
      });
      setDownloadStatus(result.status || result);
      pollDownload();
    } catch (e) {
      setError(e.message);
      setDownloading(false);
    }
  };

  const selectRegion = async (regionId) => {
    if (regionId === config?.activeRegion) return;
    setRegionSaving(true);
    setRegionMessage(null);
    setError(null);
    try {
      const result = await api.setRegion(regionId);
      await loadConfig();
      setRegionMessage(`Pricing updated for ${result.regionLabel}. Refresh dashboards to see recalculated costs.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setRegionSaving(false);
    }
  };

  if (error && !config) return <div className="error">{error}</div>;
  if (!config) return <div className="loading">Loading configuration…</div>;

  const activeRegion = config.activeRegion || config.pricing?.region;
  const catalog = config.catalog || config.pricing?.fullCatalog || {};
  const job = downloadStatus || catalog.download || {};
  const isRunning = downloading || job.status === 'running';
  const pct = job.percent || 0;

  return (
    <>
      {!embedded && (
        <header className="page-header">
          <h1>Configuration</h1>
          <p>Environment variables, offline Azure retail catalog, and billing integration</p>
        </header>
      )}

      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <section className="section">
        <h2>Full Offline Azure Pricing Catalog</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Download every Azure Consumption meter for your region(s) in <strong>AUD</strong> from Microsoft&apos;s
          Retail Prices API. Stored locally (compressed) so you can model true component cost offline and
          switch SKUs to find savings. Expect ~5–20 minutes and tens of MB depending on region count.
        </p>

        <div className="cards" style={{ marginBottom: '1rem' }}>
          <div className="card">
            <div className="card-label">Catalog Status</div>
            <div className="card-value" style={{ fontSize: '1.15rem' }}>
              {catalog.available ? 'Ready (offline)' : 'Not downloaded'}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Meters</div>
            <div className="card-value" style={{ fontSize: '1.15rem' }}>
              {(catalog.itemCount || 0).toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Services</div>
            <div className="card-value" style={{ fontSize: '1.15rem' }}>
              {(catalog.serviceCount || 0).toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="card-label">VM SKUs</div>
            <div className="card-value" style={{ fontSize: '1.15rem' }}>
              {(catalog.vmSkuCount || 0).toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Size</div>
            <div className="card-value" style={{ fontSize: '1.15rem' }}>
              {catalog.fileSizeMb ? `${catalog.fileSizeMb} MB` : '—'}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Downloaded</div>
            <div className="card-value" style={{ fontSize: '0.95rem' }}>
              {catalog.downloadedAt
                ? new Date(catalog.downloadedAt).toLocaleString('en-AU')
                : '—'}
            </div>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={completeMode}
              onChange={(e) => setCompleteMode(e.target.checked)}
              disabled={isRunning}
            />
            <span>
              Complete primary-meter catalog (every Azure service in AUD — largest, slowest, best for true component modelling)
            </span>
          </label>
        </div>
        <div className="form-group" style={{ marginBottom: '0.75rem' }}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allRegions}
              onChange={(e) => setAllRegions(e.target.checked)}
              disabled={isRunning || completeMode}
            />
            <span>
              Download all AU regions (East + Central + Central 2) + Global — larger than active region only
            </span>
          </label>
        </div>

        {(isRunning || job.status === 'complete' || job.status === 'error') && (
          <div className="download-progress" style={{ marginBottom: '1rem' }}>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <p style={{ fontSize: '0.85rem', color: job.status === 'error' ? 'var(--red)' : 'var(--muted)', marginTop: '0.5rem' }}>
              {job.message || job.status}
              {job.itemsKept != null && isRunning && (
                <> · {job.itemsKept.toLocaleString()} meters so far</>
              )}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            className="btn btn-primary"
            onClick={startFullDownload}
            disabled={isRunning || regionSaving}
          >
            {isRunning
              ? `Downloading… ${pct}%`
              : catalog.available
                ? 'Re-download Full Catalog (AUD)'
                : 'Download Full Azure Catalog (AUD)'}
          </button>
          <button className="btn" onClick={refreshPrices} disabled={isRunning || regionSaving}>
            Reload Offline Cache
          </button>
        </div>

        {!catalog.available && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--amber)' }}>
            Until the full catalog is downloaded, estimates use a small baseline snapshot (~12 VM SKUs).
            That is not enough for true bill-matching component modelling.
          </p>
        )}
      </section>

      <section className="section">
        <h2>Azure Region</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Active region for retail pricing look-ups. Costs recalculate when you change region.
        </p>
        <div className="region-grid">
          {(config.regions || []).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`region-card ${activeRegion === r.id ? 'active' : ''}`}
              onClick={() => selectRegion(r.id)}
              disabled={regionSaving || isRunning}
            >
              <div className="region-card-label">{r.label}</div>
              <div className="region-card-id">{r.id}</div>
              <div className="region-card-desc">{r.description}</div>
            </button>
          ))}
        </div>
        {regionMessage && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--green)' }}>{regionMessage}</p>
        )}
      </section>

      <section className="section">
        <h2>Environment Variables</h2>
        <div className="table-wrap">
          <table className="config-table responsive-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Description</th>
                <th>Default</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {config.envVariables.map((v) => (
                <tr key={v.key}>
                  <td data-label="Variable">{v.key}</td>
                  <td data-label="Description">{v.description}</td>
                  <td className="mono" data-label="Default">{v.default || '—'}</td>
                  <td data-label="Status">
                    {v.key === 'AZURE_REGION'
                      ? `${config.pricing?.regionLabel || activeRegion} (active)`
                      : config.azure.costManagementEnabled && v.key === 'AZURE_SUBSCRIPTION_ID'
                        ? '✓ configured'
                        : v.default ? `default: ${v.default}` : 'optional'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Azure Integration</h2>
        <div className="cards">
          <div className="card">
            <div className="card-label">Region</div>
            <div className="card-value" style={{ fontSize: '1.25rem' }}>{config.pricing?.regionLabel || activeRegion}</div>
          </div>
          <div className="card">
            <div className="card-label">Currency</div>
            <div className="card-value" style={{ fontSize: '1.25rem' }}>{config.pricing.currency}</div>
          </div>
          <div className="card">
            <div className="card-label">Pricing Source</div>
            <div className="card-value" style={{ fontSize: '0.95rem' }}>{config.pricing.source}</div>
          </div>
          <div className="card">
            <div className="card-label">Cost Management</div>
            <div className="card-value" style={{ fontSize: '1.25rem' }}>
              {config.azure.costManagementEnabled ? 'Enabled' : 'Not configured'}
            </div>
          </div>
        </div>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Optional: configure Cost Management credentials in <code>.env</code> to compare modelled app cost
          against actual billed spend. Retail catalogue = rate card; billed totals need metering/quantity truth.
        </p>
      </section>
    </>
  );
}
