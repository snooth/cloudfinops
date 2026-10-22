import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

// One-time disclaimer ack — localStorage only, no PII
const DISCLAIMER_KEY = 'cloudfinops-disclaimer-accepted';

export function hasAcceptedDisclaimer() {
  try {
    return localStorage.getItem(DISCLAIMER_KEY) === 'true';
  } catch {
    return false;
  }
}

export function acceptDisclaimer() {
  try {
    localStorage.setItem(DISCLAIMER_KEY, 'true');
  } catch {
    /* private mode / quota — they'll see disclaimer again, she'll be right */
  }
}

export default function Landing() {
  const navigate = useNavigate();
  const [acknowledged, setAcknowledged] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.getVersionInfo()
      .then((v) => setAppVersion(v.current?.version || ''))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.getAuthStatus()
      .then((s) => {
        if (!s.authenticated) {
          navigate('/?next=/welcome', { replace: true });
          return;
        }
        if (s.mustChangePassword) {
          navigate('/change-password', { replace: true });
          return;
        }
        if (hasAcceptedDisclaimer()) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setReady(true);
      })
      .catch(() => navigate('/', { replace: true }));
  }, [navigate]);

  const enterPortal = () => {
    acceptDisclaimer();
    navigate('/dashboard');
  };

  if (!ready) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="landing-page">
      <div className="landing-card">
        <header className="landing-header">
          <div className="landing-logo">
            Cloud <span>FinOps</span>
          </div>
          <p className="landing-tagline">Cloud budget estimation portal</p>
        </header>

        <section className="landing-section">
          <h2>About this tool</h2>
          <p>
            Cloud FinOps is a budget estimator for Azure cloud workloads. It models
            indicative monthly and annual spend across a portfolio of applications using
            generic sizing, capacity assumptions, and cached Azure retail pricing.
          </p>
          <p>
            The figures shown are planning estimates only — not invoices, commitments,
            or binding quotes. Use them to explore scenarios and compare options before
            you validate costs against your organisation&apos;s actual rates and usage.
          </p>
        </section>

        <section className="landing-section landing-disclaimer">
          <h2>Usage disclaimer</h2>
          <ul>
            <li>
              Pricing is derived from published Azure retail rates (cached locally for
              offline use). It may not reflect your negotiated rates, reservations,
              discounts, or tax treatment.
            </li>
            <li>
              All data you enter must be <strong>generic</strong>. Use fictional or
              anonymised values only. Do <strong>not</strong> load, upload, or enter
              sensitive, confidential, or personal data.
            </li>
            <li>
              This portal does not connect to your Azure subscriptions and does not
              retrieve live billing or account information.
            </li>
            <li>
              Revalidate budgets as required before making financial or procurement
              decisions. This tool is a guide only.
            </li>
            <li>
              <strong>Use at your own risk.</strong> SolStak accepts no liability for
              decisions made based on outputs from this portal.
            </li>
          </ul>
        </section>

        <label className="landing-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>I have read and understand this disclaimer</span>
        </label>

        <button
          type="button"
          className="btn btn-primary landing-enter"
          disabled={!acknowledged}
          onClick={enterPortal}
        >
          Enter portal
        </button>
      </div>

      <footer className="site-footnote">
        Cloud FinOps - SolStak 2026{appVersion ? ` · v${appVersion}` : ''}
      </footer>
    </div>
  );
}
