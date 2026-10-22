import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { hasAcceptedDisclaimer } from './Landing';

// Where to send 'em after login or when we find an existing cookie (password change / disclaimer first)
export function pathAfterAuth(status, preferred = '/dashboard') {
  // login POST shape differs from GET /auth/status — treat either as "they're in"
  const authed = Boolean(
    status?.authenticated || status?.ok || status?.username
  );
  if (!authed) return '/';
  if (status.mustChangePassword) return '/change-password';
  if (!hasAcceptedDisclaimer()) return '/welcome';
  if (preferred === '/' || preferred === '/login' || preferred === '/admin/login') {
    return '/dashboard';
  }
  return preferred || '/dashboard';
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const preferred = searchParams.get('next') || '/dashboard';

  // Already got a session cookie? Skip the form and bounce through pathAfterAuth
  useEffect(() => {
    api.getAuthStatus()
      .then((s) => {
        if (s.authenticated) {
          navigate(pathAfterAuth(s, preferred), { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [navigate, preferred]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login(username.trim(), password);
      navigate(pathAfterAuth(result, preferred), { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="admin-auth-page">
      <div className="admin-auth-card card">
        <div className="admin-auth-brand">
          Cloud <span>FinOps</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">
          Enter your username and password to open the portal.
        </p>

        <form onSubmit={onSubmit} className="admin-auth-form">
          <div className="form-group">
            <label htmlFor="login-user">Username</label>
            <input
              id="login-user"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-pass">Password</label>
            <input
              id="login-pass"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className="error-inline" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
