// App chrome: sidebar nav, auth gate, region footer (AUD). Re-checks session on route change.
import { useEffect, useState, useRef } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { hasAcceptedDisclaimer } from '../pages/Landing';
import { pathAfterAuth } from '../pages/Login';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/cost-drivers', label: 'Cost Drivers' },
  { to: '/applications', label: 'Applications' },
  { to: '/simulate', label: 'Simulate' },
  { to: '/admin', label: 'Admin' },
];

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [regionLabel, setRegionLabel] = useState('AU East');
  const [appVersion, setAppVersion] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [gate, setGate] = useState('loading'); // loading | ok | redirect — don't flash login on every nav
  const [redirectTo, setRedirectTo] = useState('/');
  const [canAdmin, setCanAdmin] = useState(false);
  const gateOkRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const showLoading = !gateOkRef.current;
    if (showLoading) setGate('loading');

    api.getAuthStatus()
      .then((s) => {
        if (cancelled) return;
        if (!s.authenticated || s.mustChangePassword || !hasAcceptedDisclaimer()) {
          gateOkRef.current = false;
          setRedirectTo(pathAfterAuth(s, pathname));
          setGate('redirect');
          return;
        }
        const perms = Array.isArray(s.permissions) ? s.permissions : [];
        const adminUi = perms.includes('adminUi') || s.role === 'admin' || s.role === 'operator';
        setCanAdmin(adminUi);
        if (pathname.startsWith('/admin') && !adminUi) {
          setRedirectTo('/dashboard');
          setGate('redirect');
          return;
        }
        gateOkRef.current = true;
        setGate('ok');
      })
      .catch(() => {
        if (cancelled) return;
        // One blip on /auth/status shouldn't boot someone who's already in — only fail closed on first load
        if (gateOkRef.current) return;
        setRedirectTo('/');
        setGate('redirect');
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (gate !== 'ok') return;
    api.getConfig()
      .then((c) => setRegionLabel(c.pricing?.regionLabel || 'AU East'))
      .catch(() => {});
    api.getVersionInfo()
      .then((v) => setAppVersion(v.current?.version || ''))
      .catch(() => {});
  }, [gate, pathname]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    navigate('/', { replace: true });
  };

  const isActive = (to) =>
    pathname === to || (to !== '/' && pathname.startsWith(to));

  const visibleLinks = links.filter((l) => l.to !== '/admin' || canAdmin);

  if (gate === 'loading') {
    return <div className="loading">Loading…</div>;
  }
  if (gate === 'redirect') {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className={`app-layout ${navOpen ? 'nav-open' : ''}`}>
      <header className="mobile-header">
        <button
          type="button"
          className="menu-toggle"
          onClick={() => setNavOpen((o) => !o)}
          aria-expanded={navOpen}
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-header-title">
          Cloud <span>FinOps</span>
        </div>
        <div className="mobile-header-meta">{regionLabel}</div>
      </header>

      {navOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
        />
      )}

      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="logo">Cloud <span>FinOps</span></div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
        <nav>
          {visibleLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`nav-link ${isActive(l.to) ? 'active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>Azure · {regionLabel} · AUD</div>
          <button type="button" className="sidebar-signout" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <footer className="site-footnote site-footnote--app">
        Cloud FinOps - SolStak 2026{appVersion ? ` · v${appVersion}` : ''}
      </footer>
    </div>
  );
}
