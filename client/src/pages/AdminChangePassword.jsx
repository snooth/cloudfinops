// Forced password change gate — also embedded from Admin when mustChangePassword is set
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { pathAfterAuth } from './Login';

export default function AdminChangePassword({ onChanged }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getAuthStatus()
      .then((s) => {
        if (!s.authenticated) {
          navigate('/?next=/change-password', { replace: true });
          return;
        }
        if (!s.mustChangePassword && !onChanged) {
          navigate(pathAfterAuth({ ...s, mustChangePassword: false }), { replace: true });
          return;
        }
        setReady(true);
      })
      .catch(() => navigate('/', { replace: true }));
  }, [navigate, onChanged]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (!newPassword) {
      setError('New password is required');
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      if (onChanged) {
        onChanged();
      } else {
        const s = await api.getAuthStatus();
        navigate(pathAfterAuth(s), { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Could not change password');
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="admin-auth-page">
      <div className="admin-auth-card card">
        <div className="admin-auth-brand">
          Cloud <span>FinOps</span>
        </div>
        <h1>Change password</h1>
        <p className="muted">
          You must set a new password before continuing. The default password cannot be kept.
        </p>

        <form onSubmit={onSubmit} className="admin-auth-form">
          <div className="form-group">
            <label htmlFor="current-pass">Current password</label>
            <input
              id="current-pass"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-pass">New password</label>
            <input
              id="new-pass"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirm-pass">Confirm new password</label>
            <input
              id="confirm-pass"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && <div className="error-inline" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : 'Save new password'}
          </button>
        </form>

        <p className="admin-auth-back">
          <Link to="/">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
