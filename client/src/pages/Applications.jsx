// App list — click column headers to sort (toggle asc/desc); costs are AUD via formatAud
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAud, platformBadge, platformLabel } from '../api';
import AddApplicationModal from '../components/AddApplicationModal';

const SIZE_ORDER = { S: 1, M: 2, L: 3, XL: 4, XXL: 5 };

// Header sort keys — handleSort flips direction when you click the same column again
const SORT_COLUMNS = [
  { key: 'name', label: 'Name', type: 'string', get: (a) => a.name || '' },
  { key: 'platform', label: 'Platform', type: 'string', get: (a) => platformLabel(a.platform) || a.platform || '' },
  { key: 'size', label: 'Size', type: 'size', get: (a) => a.tshirtSize || a.defaultTshirtSize || 'M' },
  { key: 'nodes', label: 'Nodes', type: 'number', get: (a) => Number(a.totalNodes) || 0 },
  { key: 'monthly', label: 'Monthly', type: 'number', get: (a) => Number(a.monthlyEstimate) || 0 },
  { key: 'yearly', label: 'Yearly', type: 'number', get: (a) => (Number(a.monthlyEstimate) || 0) * 12 },
  { key: 'description', label: 'Description', type: 'string', get: (a) => a.description || '' },
];

function compareApps(a, b, column, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  if (column.type === 'number') {
    return (column.get(a) - column.get(b)) * mul;
  }
  if (column.type === 'size') {
    const av = SIZE_ORDER[String(column.get(a)).toUpperCase()] ?? 99;
    const bv = SIZE_ORDER[String(column.get(b)).toUpperCase()] ?? 99;
    if (av !== bv) return (av - bv) * mul;
    return String(column.get(a)).localeCompare(String(column.get(b))) * mul;
  }
  return String(column.get(a)).localeCompare(String(column.get(b)), undefined, {
    sensitivity: 'base',
    numeric: true,
  }) * mul;
}

export default function Applications() {
  const [apps, setApps] = useState([]);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const loadApps = useCallback(() => {
    api.getApplications().then(setApps).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  // Click same header again to flip asc/desc; money columns default to high-first
  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'monthly' || key === 'yearly' || key === 'nodes' ? 'desc' : 'asc');
    }
  };

  const sortedApps = useMemo(() => {
    const col = SORT_COLUMNS.find((c) => c.key === sortKey) || SORT_COLUMNS[0];
    return [...apps].sort((a, b) => compareApps(a, b, col, sortDir));
  }, [apps, sortKey, sortDir]);

  const handleDelete = async (app) => {
    const ok = window.confirm(
      `Delete “${app.name}” from your portfolio?\n\n` +
        (app.custom
          ? 'This permanently removes the custom application.'
          : 'This removes the built-in application from lists and cost totals.')
    );
    if (!ok) return;
    setDeleting(app.id);
    try {
      await api.deleteApplication(app.id);
      loadApps();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const startRename = (app) => {
    setRenamingId(app.id);
    setRenameValue(app.name);
    setError(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const submitRename = async (app) => {
    const next = renameValue.trim();
    if (!next) {
      setError('Name is required');
      return;
    }
    if (next === app.name) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    setError(null);
    try {
      await api.renameApplication(app.id, next);
      cancelRename();
      loadApps();
    } catch (e) {
      setError(e.message);
    } finally {
      setRenameSaving(false);
    }
  };

  if (error && !apps.length) return <div className="error">{error}</div>;
  if (!apps.length && !showAdd) return <div className="loading">Loading applications…</div>;

  const customCount = apps.filter((a) => a.custom).length;
  const monthlyTotal = apps.reduce((sum, a) => sum + (Number(a.monthlyEstimate) || 0), 0);
  const yearlyTotal = monthlyTotal * 12;

  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>Applications</h1>
          <p>
            {apps.length} workloads
            {customCount > 0 && ` (${customCount} custom)`}
            {' — '}set node counts per application — costs update across the portfolio
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Add Application
        </button>
      </header>

      {error && <div className="error" style={{ padding: '0.75rem', marginBottom: '1rem' }}>{error}</div>}

      <div className="table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              {SORT_COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th key={col.key} aria-sort={ariaSort}>
                    <button
                      type="button"
                      className={`th-sort-btn${active ? ' is-active' : ''}`}
                      onClick={() => handleSort(col.key)}
                      title={`Sort by ${col.label}`}
                    >
                      <span>{col.label}</span>
                      <span className="th-sort-icon" aria-hidden="true">
                        {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th className="th-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sortedApps.map((a) => (
              <tr key={a.id}>
                <td data-label="Name">
                  {renamingId === a.id ? (
                    <div className="app-rename-inline">
                      <input
                        type="text"
                        value={renameValue}
                        autoFocus
                        maxLength={120}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename(a);
                          if (e.key === 'Escape') cancelRename();
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={renameSaving}
                        onClick={() => submitRename(a)}
                      >
                        {renameSaving ? '…' : 'Save'}
                      </button>
                      <button type="button" className="btn" disabled={renameSaving} onClick={cancelRename}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <Link to={`/applications/${a.id}`} className="app-link">
                        {a.name}
                      </Link>
                      {a.custom && (
                        <span className="badge" style={{ marginLeft: '0.5rem', background: '#f0fdf4', color: '#15803d' }}>Custom</span>
                      )}
                    </>
                  )}
                </td>
                <td data-label="Platform">
                  <span className={`badge ${platformBadge(a.platform)}`}>{platformLabel(a.platform)}</span>
                </td>
                <td data-label="Size">
                  <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                    {a.tshirtSize || a.defaultTshirtSize || 'M'}
                  </span>
                </td>
                <td className="mono" data-label="Nodes">{a.totalNodes ?? '—'}</td>
                <td className="mono" data-label="Monthly">{a.monthlyEstimate != null ? formatAud(a.monthlyEstimate) : '—'}</td>
                <td className="mono" data-label="Yearly">
                  {a.monthlyEstimate != null ? formatAud(Number(a.monthlyEstimate) * 12) : '—'}
                </td>
                <td data-label="Description" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{a.description}</td>
                <td className="actions-cell">
                  <div className="app-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost-link"
                      onClick={() => startRename(a)}
                      disabled={renamingId === a.id || deleting === a.id}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      onClick={() => handleDelete(a)}
                      disabled={deleting === a.id || renamingId === a.id}
                    >
                      {deleting === a.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="table-totals-row">
              <td colSpan={3} data-label="Totals"><strong>Portfolio total</strong></td>
              <td className="mono" data-label="Nodes">
                {apps.reduce((s, a) => s + (Number(a.totalNodes) || 0), 0)}
              </td>
              <td className="mono" data-label="Monthly total">
                <strong>{formatAud(monthlyTotal)}</strong>
              </td>
              <td className="mono" data-label="Yearly total">
                <strong>{formatAud(yearlyTotal)}</strong>
              </td>
              <td colSpan={2} className="hide-mobile" />
            </tr>
          </tfoot>
        </table>
      </div>

      {showAdd && (
        <AddApplicationModal
          onClose={() => setShowAdd(false)}
          onCreated={loadApps}
        />
      )}
    </>
  );
}
