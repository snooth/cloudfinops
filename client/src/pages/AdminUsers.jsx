// User admin — temp passwords masked until you hit Show; reload clears reveal state
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

const DEFAULT_ROLES = [
  {
    id: 'admin',
    label: 'Admin',
    description: 'Full access — portal, configuration, software version, and user management',
  },
  {
    id: 'operator',
    label: 'Operator',
    description: 'Portal plus configuration and software version (no user management)',
  },
  {
    id: 'user',
    label: 'User',
    description: 'Portal only — dashboard, applications, cost drivers, and simulate',
  },
];

export default function AdminUsers({ currentUsername }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forceChange, setForceChange] = useState(true);
  const [role, setRole] = useState('user');
  const [resetFor, setResetFor] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [updatingRole, setUpdatingRole] = useState(null);
  const [nameDrafts, setNameDrafts] = useState({});
  const [savingName, setSavingName] = useState(null);
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [updatingMustChange, setUpdatingMustChange] = useState(null);
  const [resetForceChange, setResetForceChange] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return api.listUsers()
      .then((data) => {
        const list = data.users || [];
        setUsers(list);
        if (data.roles?.length) setRoles(data.roles);
        setNameDrafts(Object.fromEntries(list.map((u) => [u.username, u.displayName || u.name || ''])));
        setRevealedPasswords({}); // fresh list — don't leave old passwords on screen
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setCreating(true);
    try {
      const user = await api.createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        mustChangePassword: forceChange,
        role,
      });
      const label = user.displayName || user.username;
      setMessage(`Created ${user.roleLabel || user.role} “${label}” (${user.username}).`);
      setDisplayName('');
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setForceChange(true);
      setRole('user');
      await load();
      if (user.password) {
        setRevealedPasswords((prev) => ({ ...prev, [user.username]: true }));
      }
    } catch (err) {
      setError(err.message || 'Could not create user');
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (name) => {
    if (!window.confirm(`Delete user “${name}”? This cannot be undone.`)) return;
    setError(null);
    setMessage(null);
    try {
      await api.deleteUser(name);
      setMessage(`Deleted user “${name}”.`);
      if (resetFor === name) {
        setResetFor(null);
        setResetPassword('');
      }
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete user');
    }
  };

  const onRoleChange = async (name, nextRole) => {
    setError(null);
    setMessage(null);
    setUpdatingRole(name);
    try {
      const user = await api.updateUserRole(name, nextRole);
      const label = user.displayName || user.username;
      setMessage(`Updated “${label}” to ${user.roleLabel || user.role}.`);
      await load();
    } catch (err) {
      setError(err.message || 'Could not update role');
      await load();
    } finally {
      setUpdatingRole(null);
    }
  };

  const onSaveName = async (u) => {
    const next = (nameDrafts[u.username] ?? '').trim();
    const prev = (u.displayName || u.name || '').trim();
    if (next === prev) return;
    setError(null);
    setMessage(null);
    setSavingName(u.username);
    try {
      const user = await api.updateUser(u.username, { displayName: next });
      setMessage(
        next
          ? `Set name for “${user.username}” to ${user.displayName}.`
          : `Cleared name for “${user.username}”.`
      );
      await load();
    } catch (err) {
      setError(err.message || 'Could not update name');
      setNameDrafts((d) => ({ ...d, [u.username]: u.displayName || u.name || '' }));
    } finally {
      setSavingName(null);
    }
  };

  const onMustChangeToggle = async (u, next) => {
    setError(null);
    setMessage(null);
    setUpdatingMustChange(u.username);
    try {
      const user = await api.updateUser(u.username, { mustChangePassword: next });
      const label = user.displayName || user.username;
      setMessage(
        next
          ? `“${label}” must change password on next login.`
          : `Cleared must-change for “${label}”.`
      );
      await load();
    } catch (err) {
      setError(err.message || 'Could not update password policy');
      await load();
    } finally {
      setUpdatingMustChange(null);
    }
  };

  const onReset = async (e) => {
    e.preventDefault();
    if (!resetFor) return;
    setError(null);
    setMessage(null);
    setResetting(true);
    try {
      const user = await api.resetUserPassword(resetFor, resetPassword, resetForceChange);
      setMessage(
        resetForceChange
          ? `Password reset for “${resetFor}”. They must change it on next login.`
          : `Password reset for “${resetFor}”.`
      );
      const who = resetFor;
      setResetFor(null);
      setResetPassword('');
      setResetForceChange(true);
      await load();
      if (user?.password || resetPassword) {
        setRevealedPasswords((prev) => ({ ...prev, [who]: true }));
      }
    } catch (err) {
      setError(err.message || 'Could not reset password');
    } finally {
      setResetting(false);
    }
  };

  const selectedRole = roles.find((r) => r.id === role) || roles[0];
  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <div className="admin-users">
      {error && <div className="error-inline" role="alert" style={{ marginBottom: '1rem' }}>{error}</div>}
      {message && (
        <div className="version-banner success" role="status" style={{ marginBottom: '1rem' }}>
          {message}
        </div>
      )}

      <section className="section">
        <h2>Create user</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Set a display name for people (e.g. full name). Username is the login id and tenant key
          (short codes are fine). Each account is its own tenancy.
        </p>
        <form className="admin-user-form card" onSubmit={onCreate}>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="new-display-name">Name</label>
              <input
                id="new-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                maxLength={80}
                placeholder="e.g. Jane Smith"
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-username">Username (login)</label>
              <input
                id="new-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                pattern="[a-zA-Z0-9._\-]{3,32}"
                title="3–32 characters: letters, numbers, dots, underscores, hyphens"
                required
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="new-role">Role</label>
              <select
                id="new-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              {selectedRole?.description && (
                <p className="form-hint">{selectedRole.description}</p>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="new-password">Temporary password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="new-password-confirm">Confirm password</label>
              <input
                id="new-password-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label className="checkbox-label" style={{ marginBottom: '0.55rem' }}>
                <input
                  type="checkbox"
                  checked={forceChange}
                  onChange={(e) => setForceChange(e.target.checked)}
                />
                Require password change on first login
              </label>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>
      </section>

      <section className="section">
        <h2>Users</h2>
        {loading ? (
          <div className="loading" style={{ padding: '1.5rem' }}>Loading users…</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Password</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.username.toLowerCase() === String(currentUsername || '').toLowerCase();
                  const isLastAdmin = u.role === 'admin' && adminCount <= 1;
                  const draft = nameDrafts[u.username] ?? (u.displayName || u.name || '');
                  const dirty = draft.trim() !== (u.displayName || u.name || '').trim();
                  return (
                    <tr key={u.username}>
                      <td>
                        <div className="admin-user-name-cell">
                          <input
                            className="resource-label-input"
                            type="text"
                            value={draft}
                            maxLength={80}
                            placeholder="Display name"
                            aria-label={`Name for ${u.username}`}
                            onChange={(e) =>
                              setNameDrafts((d) => ({ ...d, [u.username]: e.target.value }))
                            }
                            onBlur={() => dirty && onSaveName(u)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                onSaveName(u);
                              }
                            }}
                          />
                          {dirty && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={savingName === u.username}
                              onClick={() => onSaveName(u)}
                            >
                              {savingName === u.username ? '…' : 'Save'}
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <strong className="mono">{u.username}</strong>
                        {isSelf ? <span className="badge" style={{ marginLeft: '0.5rem' }}>you</span> : null}
                      </td>
                      <td>
                        <select
                          className="role-select"
                          value={u.role || 'user'}
                          disabled={updatingRole === u.username || (isSelf && isLastAdmin)}
                          title={isSelf && isLastAdmin ? 'Cannot demote the last admin' : 'Change role'}
                          onChange={(e) => onRoleChange(u.username, e.target.value)}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="admin-password-cell">
                          {/* Server only returns plaintext right after create/reset — masked until Show */}
                          {u.password ? (
                            <div className="admin-password-reveal">
                              <code className="mono admin-password-value" aria-label={`Password for ${u.username}`}>
                                {revealedPasswords[u.username]
                                  ? u.password
                                  : '•'.repeat(Math.max(8, Math.min(u.password.length, 16)))}
                              </code>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() =>
                                  setRevealedPasswords((prev) => ({
                                    ...prev,
                                    [u.username]: !prev[u.username],
                                  }))
                                }
                              >
                                {revealedPasswords[u.username] ? 'Hide' : 'Show'}
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>Not stored</span>
                          )}
                          <label
                            className="checkbox-label admin-must-change-toggle"
                            title="Require password change on next login"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(u.mustChangePassword)}
                              disabled={updatingMustChange === u.username}
                              onChange={(e) => onMustChangeToggle(u, e.target.checked)}
                            />
                            Change on first login
                          </label>
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: '0.85rem' }}>{formatDate(u.createdAt)}</td>
                      <td>
                        <div className="admin-user-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setResetFor(u.username);
                              setResetPassword('');
                              setResetForceChange(true);
                              setMessage(null);
                              setError(null);
                            }}
                          >
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={isSelf || isLastAdmin || users.length <= 1}
                            title={
                              isSelf
                                ? 'Cannot delete yourself'
                                : isLastAdmin
                                  ? 'Cannot delete the last admin'
                                  : `Delete ${u.username}`
                            }
                            onClick={() => onDelete(u.username)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {resetFor && (
          <form className="card admin-user-form" style={{ marginTop: '1rem' }} onSubmit={onReset}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Reset password for <strong>{resetFor}</strong>
            </h3>
            <div className="form-group">
              <label htmlFor="reset-password">New temporary password</label>
              <input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <label className="checkbox-label" style={{ marginBottom: '0.75rem' }}>
              <input
                type="checkbox"
                checked={resetForceChange}
                onChange={(e) => setResetForceChange(e.target.checked)}
              />
              Require password change on next login
            </label>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              They will be signed out of existing sessions.
            </p>
            <div className="admin-user-actions">
              <button type="submit" className="btn btn-primary" disabled={resetting}>
                {resetting ? 'Saving…' : 'Save temporary password'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setResetFor(null);
                  setResetPassword('');
                  setResetForceChange(true);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
