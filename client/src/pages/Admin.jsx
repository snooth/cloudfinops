// Admin shell — tabbed config / software version / users; permissions from server role
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import Config from './Config';
import SoftwareVersion from './SoftwareVersion';
import AdminChangePassword from './AdminChangePassword';
import AdminUsers from './AdminUsers';

const ALL_TABS = [
  { id: 'configuration', label: 'Configuration', permission: 'config' },
  { id: 'software-version', label: 'Software Version', permission: 'version' },
  { id: 'users', label: 'Users', permission: 'users' },
];

// Mirror server roles until permissions array is always populated
function hasPerm(auth, permission) {
  if (!auth) return false;
  if (Array.isArray(auth.permissions)) return auth.permissions.includes(permission);
  if (auth.role === 'admin') return true;
  if (auth.role === 'operator') return permission !== 'users';
  return false;
}

export default function Admin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

  const [auth, setAuth] = useState(null);
  const [error, setError] = useState(null);

  const tabs = useMemo(
    () => ALL_TABS.filter((t) => hasPerm(auth, t.permission)),
    [auth]
  );
  const activeTab = tabs.some((t) => t.id === tabParam)
    ? tabParam
    : (tabs[0]?.id || 'configuration');

  const refreshAuth = useCallback(() => {
    return api.getAuthStatus()
      .then(setAuth)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!auth || !tabs.length) return;
    if (tabParam && !tabs.some((t) => t.id === tabParam)) {
      setSearchParams({ tab: tabs[0].id }, { replace: true });
    }
  }, [auth, tabs, tabParam, setSearchParams]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    navigate('/', { replace: true });
  };

  if (error && !auth) {
    return <div className="error">Could not load admin session: {error}</div>;
  }

  if (!auth) {
    return <div className="loading">Checking admin session…</div>;
  }

  if (!auth.authenticated) {
    return <Navigate to="/?next=/admin" replace />;
  }

  if (auth.mustChangePassword) {
    return (
      <AdminChangePassword
        onChanged={() => {
          refreshAuth().then(() => navigate('/admin', { replace: true }));
        }}
      />
    );
  }

  if (!hasPerm(auth, 'adminUi')) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="admin-page">
      <div className="page-header admin-page-header">
        <div>
          <h1>Admin</h1>
          <p className="subtitle">
            Signed in as{' '}
            <strong>
              {auth.displayName || auth.name || auth.username}
              {(auth.displayName || auth.name) && auth.username
                ? ` (${auth.username})`
                : ''}
            </strong>
            {auth.roleLabel || auth.role ? (
              <> ({auth.roleLabel || auth.role})</>
            ) : null}
            . Configuration, software version, and users.
          </p>
        </div>
        <div className="admin-page-actions">
          <Link to="/dashboard" className="btn">Portal</Link>
          <button type="button" className="btn" onClick={logout}>Sign out</button>
        </div>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setSearchParams({ tab: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="admin-tab-panel" role="tabpanel">
        {activeTab === 'configuration' && <Config embedded />}
        {activeTab === 'software-version' && <SoftwareVersion embedded />}
        {activeTab === 'users' && hasPerm(auth, 'users') && (
          <AdminUsers currentUsername={auth.username} />
        )}
      </div>
    </div>
  );
}
