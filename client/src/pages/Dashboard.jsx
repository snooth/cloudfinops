// Portfolio rollup — server totals in AUD; charts use formatAud for tooltips
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api, formatAud, platformBadge, platformLabel } from '../api';
import { useMediaQuery } from '../hooks/useMediaQuery';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    api.getDashboard().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">Failed to load dashboard: {error}</div>;
  if (!data) return <div className="loading">Loading portfolio costs…</div>;

  const chartData = data.applications
    .slice()
    .sort((a, b) => b.monthly - a.monthly)
    .map((a) => ({
      name: isMobile ? a.name.split(' ')[0] : a.name.split(' ')[0],
      full: a.name,
      cost: a.monthly,
    }));

  const barHeight = isMobile ? Math.max(280, chartData.length * 36) : 300;

  const platformTotals = data.applications.reduce((acc, a) => {
    acc[a.platform] = (acc[a.platform] || 0) + a.monthly;
    return acc;
  }, {});
  const pieData = Object.entries(platformTotals).map(([name, value]) => ({
    name: platformLabel(name),
    value: Math.round(value),
  }));

  return (
    <>
      <header className="page-header">
        <h1>Portfolio Dashboard</h1>
        <p>Estimated monthly Azure spend across {data.applicationCount} applications</p>
      </header>

      <div className="cards">
        <div className="card">
          <div className="card-label">Total Monthly</div>
          <div className="card-value">{formatAud(data.totalPortfolioMonthly)}</div>
        </div>
        <div className="card">
          <div className="card-label">Total Annual</div>
          <div className="card-value">{formatAud(data.totalPortfolioAnnual)}</div>
        </div>
        <div className="card">
          <div className="card-label">Applications</div>
          <div className="card-value">{data.applicationCount}</div>
        </div>
        <div className="card">
          <div className="card-label">Currency</div>
          <div className="card-value">{data.currency}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="chart-container">
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Cost by Application</h2>
          <ResponsiveContainer width="100%" height={barHeight}>
            <BarChart data={chartData} layout="vertical" margin={{ left: isMobile ? 4 : 20, right: 8 }}>
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: isMobile ? 10 : 12 }} />
              <YAxis type="category" dataKey="name" width={isMobile ? 64 : 80} stroke="#94a3b8" tick={{ fontSize: isMobile ? 10 : 11, fill: '#64748b' }} />
              <Tooltip formatter={(v) => formatAud(v)} labelFormatter={(_, p) => p[0]?.payload?.full} />
              <Bar dataKey="cost" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Cost by Platform</h2>
          <ResponsiveContainer width="100%" height={isMobile ? 260 : 300}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={isMobile ? 72 : 100}
                label={!isMobile}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatAud(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <section className="section" style={{ marginTop: '2rem' }}>
        <h2>All Applications</h2>
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Platform</th>
                <th>Size</th>
                <th>Nodes</th>
                <th>Monthly</th>
                <th>Annual</th>
              </tr>
            </thead>
            <tbody>
              {data.applications
                .slice()
                .sort((a, b) => b.monthly - a.monthly)
                .map((a) => (
                  <tr key={a.id}>
                    <td data-label="Application">
                      <Link to={`/applications/${a.id}`} className="app-link">
                        {a.name}
                      </Link>
                    </td>
                    <td data-label="Platform">
                      <span className={`badge ${platformBadge(a.platform)}`}>{platformLabel(a.platform)}</span>
                    </td>
                    <td data-label="Size"><span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{a.tshirtSize || 'M'}</span></td>
                    <td className="mono" data-label="Nodes">{a.totalNodes ?? '—'}</td>
                    <td className="mono" data-label="Monthly">{formatAud(a.monthly)}</td>
                    <td className="mono" data-label="Annual">{formatAud(a.annual)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
