'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Loading } from '@/components/Spinner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatDate, taskLabel } from '@/lib/format';
import type { DailyOverview, SummaryResult } from '@/lib/types';

const LOGO =
  'https://d1-mobile-app.s3.us-east-1.amazonaws.com/assets/d1_training_logo.png';
const DAY = 86400000;
const round = (n: number) => Math.round(n * 10) / 10;

/** Local (VN, UTC+7) date string 'YYYY-MM-DD' for `daysAgo` days back. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - days * DAY)
    .toISOString()
    .slice(0, 10);
}

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

export default function HomePage() {
  const [preset, setPreset] = useState(30);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [yesterday, setYesterday] = useState<DailyOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const yISO = useMemo(() => isoDaysAgo(1), []);

  const applyPreset = (days: number) => {
    setPreset(days);
    setFrom(isoDaysAgo(days));
    setTo(isoDaysAgo(0));
  };

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([api.summary(from, to), api.daily(yISO)])
      .then(([s, y]) => {
        setSummary(s);
        setYesterday(y);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, yISO]);

  useEffect(() => {
    load();
  }, [load]);

  const members = summary?.members ?? [];
  const maxHours = members.reduce((m, x) => Math.max(m, x.totalHours), 0) || 1;
  const totalHours = members.reduce((s, m) => s + m.totalHours, 0);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="home-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} alt="D1 Training" className="brand-logo" />
        <ThemeToggle />
      </div>

      <h1 className="page-title">Team Workload</h1>
      <p className="page-sub">
        Reported hours per member for the selected range.
      </p>

      <div className="toolbar">
        <div className="preset-group">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              className={`preset-btn${preset === p.days ? ' active' : ''}`}
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setPreset(0);
            setFrom(e.target.value);
          }}
        />
        <span className="muted">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setPreset(0);
            setTo(e.target.value);
          }}
        />
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="cards">
        <div className="card">
          <div className="label">Total hours</div>
          <div className="value">{round(totalHours)}h</div>
        </div>
        <div className="card">
          <div className="label">Active members</div>
          <div className="value">{members.length}</div>
        </div>
        <div className="card">
          <div className="label">Avg / member</div>
          <div className="value">
            {members.length ? round(totalHours / members.length) : 0}h
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">Hours by member</div>
        {loading ? (
          <Loading />
        ) : members.length === 0 ? (
          <div className="empty">No reports in this range.</div>
        ) : (
          <div className="chart">
            {members.map((m) => (
              <div className="chart-row" key={m.memberId}>
                <span className="chart-name">{m.memberName}</span>
                <div className="chart-track">
                  <div
                    className="chart-fill"
                    style={{ width: `${(m.totalHours / maxHours) * 100}%` }}
                  />
                </div>
                <span className="chart-value">
                  {round(m.totalHours)}h
                  <small>{m.daysReported}d</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">Yesterday — {formatDate(yISO)}</div>
        {loading ? (
          <Loading />
        ) : !yesterday || yesterday.members.length === 0 ? (
          <div className="empty">No members.</div>
        ) : (
          <div className="yday-list">
            {yesterday.members.map((m) => (
              <div className="yday-row" key={m.memberId}>
                <span className="yday-name">{m.memberName}</span>
                <div className="yday-body">
                  {m.status === 'holiday' ? (
                    <span className="badge holiday">Holiday</span>
                  ) : !m.reported ? (
                    <span className="badge pending">Not reported</span>
                  ) : (
                    <ul className="entries">
                      {m.entries.map((e, i) => (
                        <li key={i}>
                          <span className="task-name">
                            {e.href ? (
                              <a href={e.href} target="_blank" rel="noreferrer">
                                {taskLabel(e)}
                              </a>
                            ) : (
                              taskLabel(e)
                            )}
                          </span>
                          <span className="hours-pill">{e.hours}h</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
