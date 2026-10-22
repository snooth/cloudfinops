// Export/import full app package + pricing snapshot zips — version history from server
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function actionLabel(action) {
  if (action === 'import') return 'Imported';
  if (action === 'export') return 'Exported';
  if (action === 'capture') return 'Captured';
  return action;
}

function pricingActionLabel(action) {
  if (action === 'import') return 'Pricing imported';
  if (action === 'export') return 'Pricing exported';
  if (action === 'capture') return 'Pricing captured';
  return action;
}

export default function SoftwareVersion({ embedded = false } = {}) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [exportNotes, setExportNotes] = useState('');
  const [importNotes, setImportNotes] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pricingExportNotes, setPricingExportNotes] = useState('');
  const [pricingImportNotes, setPricingImportNotes] = useState('');
  const [pricingExporting, setPricingExporting] = useState(false);
  const [pricingImporting, setPricingImporting] = useState(false);
  const [pricingDragOver, setPricingDragOver] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const pricingFileInputRef = useRef(null);

  const load = useCallback(() => {
    api.getVersionInfo()
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      const { blob, filename, version, previousVersion } = await api.exportSystemPackage(exportNotes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        version && previousVersion && version !== previousVersion
          ? `Release v${version} packaged (bumped from v${previousVersion}): ${filename}`
          : `Package downloaded: ${filename}`
      );
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Please upload a .zip release package');
      return;
    }
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.importSystemPackage(file, importNotes);
      setMessage(
        `Updated to v${result.version} (${result.appliedCount} paths applied). `
        + `Backup saved as ${result.backupFile}.`
        + (result.rebuild?.rebuilt ? ' Frontend rebuilt.' : '')
      );
      setImportNotes('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const onPricingDrop = (e) => {
    e.preventDefault();
    setPricingDragOver(false);
    handlePricingImportFile(e.dataTransfer.files?.[0]);
  };

  const handlePricingExport = async () => {
    setPricingExporting(true);
    setError(null);
    setMessage(null);
    try {
      const { blob, filename } = await api.exportPricingSnapshot(pricingExportNotes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Pricing snapshot downloaded: ${filename}`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPricingExporting(false);
    }
  };

  const handlePricingImportFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Please upload a .zip pricing package');
      return;
    }
    setPricingImporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.importPricingSnapshot(file, pricingImportNotes);
      setMessage(
        `Azure pricing updated (${result.entryCounts?.total ?? '—'} rates). `
        + 'All cost estimates now use the imported snapshot.'
      );
      setPricingImportNotes('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setPricingImporting(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleImportFile(file);
  };

  if (error && !info) return <div className="error">{error}</div>;
  if (!info) return <div className="loading">Loading version information…</div>;

  const { current, changelog, history, backups, lastImport, lastExport, pricing } = info;

  return (
    <>
      {!embedded && (
        <header className="page-header">
          <h1>Software Version</h1>
          <p>Pack releases, import updates, and manage offline Azure pricing snapshots — no internet required.</p>
        </header>
      )}

      {error && <div className="error" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>{error}</div>}
      {message && (
        <div className="version-banner success" role="status">{message}</div>
      )}

      <div className="cards">
        <div className="card">
          <div className="card-label">Current Version</div>
          <div className="card-value" style={{ fontSize: '1.5rem' }}>v{current.version}</div>
        </div>
        <div className="card">
          <div className="card-label">Updates Recorded</div>
          <div className="card-value">{history.length}</div>
        </div>
        <div className="card">
          <div className="card-label">Last Import</div>
          <div className="card-value" style={{ fontSize: '1.1rem' }}>
            {lastImport ? `v${lastImport.version}` : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Pricing Rates</div>
          <div className="card-value" style={{ fontSize: '1.1rem' }}>
            {pricing?.entryCounts?.total ?? '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Offline Ready</div>
          <div className="card-value" style={{ fontSize: '1.1rem', color: pricing?.offlineReady ? 'var(--green)' : 'var(--muted)' }}>
            {pricing?.offlineReady ? 'Yes' : 'No'}
          </div>
        </div>
      </div>

      <div className="grid-2 version-actions-grid">
        <section className="section">
          <h2>Pack Complete System</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Creates a ZIP with server source, built frontend, configuration data, scripts, and a release manifest.
            The patch version is incremented automatically with each export (e.g. v1.0.1 → v1.0.2).
          </p>
          <div className="card">
            <div className="form-group">
              <label>Release notes (optional)</label>
              <textarea
                rows={3}
                value={exportNotes}
                onChange={(e) => setExportNotes(e.target.value)}
                placeholder="Describe changes in this package…"
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Packaging…' : 'Download Release ZIP'}
            </button>
          </div>
        </section>

        <section className="section">
          <h2>Import Update Package</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Drag and drop a release ZIP exported from this portal (or another instance). A backup is created automatically before applying changes.
          </p>
          <div className="form-group">
            <label>Import notes (optional)</label>
            <textarea
              rows={2}
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              placeholder="e.g. Production rollout July 2026"
            />
          </div>
          <div
            className={`version-dropzone ${dragOver ? 'drag-over' : ''} ${importing ? 'disabled' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !importing && fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Upload release ZIP"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => handleImportFile(e.target.files?.[0])}
            />
            <div className="version-dropzone-icon">ZIP</div>
            <strong>{importing ? 'Applying update…' : 'Drop release package here'}</strong>
            <span>or click to browse · max 150 MB</span>
          </div>
        </section>
      </div>

      <section className="section">
        <h2>Azure Pricing (Offline)</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          The portal runs from a local pricing snapshot — VM, storage, and licence rates for all AU regions.
          Export the current snapshot or import an updated ZIP when you have new Azure pricing.
        </p>

        {pricing?.available && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <dl className="version-dl">
              <div><dt>Currency</dt><dd>{pricing.currency}</dd></div>
              <div><dt>Captured</dt><dd>{formatDate(pricing.capturedAt)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(pricing.updatedAt)}</dd></div>
              <div><dt>Regions</dt><dd>{pricing.regions?.join(', ')}</dd></div>
              <div><dt>Rates</dt><dd>{pricing.entryCounts?.vmCount} VM · {pricing.entryCounts?.storageCount} storage · {pricing.entryCounts?.staticCount} static</dd></div>
            </dl>
          </div>
        )}

        <div className="grid-2 version-actions-grid">
          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Export Pricing Snapshot</h3>
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea
                rows={2}
                value={pricingExportNotes}
                onChange={(e) => setPricingExportNotes(e.target.value)}
                placeholder="e.g. Q3 2026 Azure retail rates"
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={handlePricingExport} disabled={pricingExporting}>
              {pricingExporting ? 'Exporting…' : 'Download Pricing ZIP'}
            </button>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Import Pricing Update</h3>
            <div className="form-group">
              <label>Update notes (optional)</label>
              <textarea
                rows={2}
                value={pricingImportNotes}
                onChange={(e) => setPricingImportNotes(e.target.value)}
                placeholder="e.g. July 2026 rate refresh"
              />
            </div>
            <div
              className={`version-dropzone ${pricingDragOver ? 'drag-over' : ''} ${pricingImporting ? 'disabled' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setPricingDragOver(true); }}
              onDragLeave={() => setPricingDragOver(false)}
              onDrop={onPricingDrop}
              onClick={() => !pricingImporting && pricingFileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && pricingFileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload pricing ZIP"
            >
              <input
                ref={pricingFileInputRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => handlePricingImportFile(e.target.files?.[0])}
              />
              <div className="version-dropzone-icon">AUD</div>
              <strong>{pricingImporting ? 'Applying rates…' : 'Drop pricing ZIP here'}</strong>
              <span>contains azure-pricing-snapshot.json · max 20 MB</span>
            </div>
          </div>
        </div>

        {pricing?.history?.length > 0 && (
          <div className="version-timeline" style={{ marginTop: '1rem' }}>
            {pricing.history.slice(0, 5).map((entry) => (
              <div className="version-timeline-item" key={entry.id}>
                <div className="version-timeline-marker" data-action={entry.action} />
                <div className="version-timeline-body card">
                  <div className="version-timeline-header">
                    <strong>{pricingActionLabel(entry.action)}</strong>
                    <span style={{ color: 'var(--muted)', fontSize: '0.8rem', marginLeft: 'auto' }}>{formatDate(entry.timestamp)}</span>
                  </div>
                  {entry.notes && <p style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>{entry.notes}</p>}
                  {entry.entryCounts && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                      {entry.entryCounts.total} rates
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Release Info</h2>
        <div className="card">
          <dl className="version-dl">
            <div><dt>Package</dt><dd className="mono">{current.name}</dd></div>
            <div><dt>Version</dt><dd className="mono">v{current.version}</dd></div>
            {current.description && (
              <div><dt>Description</dt><dd>{current.description}</dd></div>
            )}
            <div><dt>Backups on server</dt><dd>{backups.length}</dd></div>
          </dl>
        </div>
      </section>

      <section className="section">
        <h2>Update History</h2>
        {history.length === 0 ? (
          <div className="card"><p style={{ color: 'var(--muted)' }}>No exports or imports recorded yet.</p></div>
        ) : (
          <div className="version-timeline">
            {history.map((entry) => (
              <div className="version-timeline-item" key={entry.id}>
                <div className="version-timeline-marker" data-action={entry.action} />
                <div className="version-timeline-body card">
                  <div className="version-timeline-header">
                    <strong>{actionLabel(entry.action)}</strong>
                    {entry.version && <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>v{entry.version}</span>}
                    <span style={{ color: 'var(--muted)', fontSize: '0.8rem', marginLeft: 'auto' }}>{formatDate(entry.timestamp)}</span>
                  </div>
                  {entry.previousVersion && entry.action === 'import' && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
                      {entry.previousVersion} → {entry.newVersion || entry.version}
                      {entry.appliedPaths != null && ` · ${entry.appliedPaths} paths`}
                      {entry.backupFile && ` · backup: ${entry.backupFile}`}
                    </p>
                  )}
                  {entry.notes && <p style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>{entry.notes}</p>}
                  {entry.filename && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }} className="mono">{entry.filename}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {backups.length > 0 && (
        <section className="section">
          <h2>Automatic Backups</h2>
          <div className="card">
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
              Created before each import — stored on the server under <code>server/data/backups/</code>
            </p>
            <ul className="version-backup-list">
              {backups.map((name) => (
                <li key={name} className="mono">{name}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Changelog</h2>
        {changelog.sections.length === 0 ? (
          <div className="card"><p style={{ color: 'var(--muted)' }}>No changelog entries found.</p></div>
        ) : (
          <div className="version-changelog">
            {changelog.sections.map((section) => (
              <div className="version-changelog-entry card" key={section.version}>
                <div className="version-changelog-header">
                  <strong>v{section.version}</strong>
                  {section.date && <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{section.date}</span>}
                </div>
                <pre className="version-changelog-body">{section.body}</pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
