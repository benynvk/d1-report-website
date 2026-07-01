'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Loading } from '@/components/Spinner';
import type { AttendanceStatus, DailyOverview } from '@/lib/types';

function today(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
const round = (n: number) => Math.round(n * 10) / 10;

export default function DashboardPage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<DailyOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .daily(date)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const shift = (days: number) => {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const toggle = async (memberId: string, status: AttendanceStatus) => {
    const current = data?.members.find((m) => m.memberId === memberId)?.status;
    const next = current === status ? 'none' : status;
    try {
      await api.setAttendance(memberId, date, next);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Daily Overview</h1>
      <p className="page-sub">
        Team workload for the day. Tick WFH / Holiday for a member; people on
        holiday are skipped by the reminder.
      </p>

      <div className="toolbar">
        <button className="btn ghost sm" onClick={() => shift(-1)}>
          ← Prev
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button className="btn ghost sm" onClick={() => shift(1)}>
          Next →
        </button>
        <button className="btn ghost sm" onClick={() => setDate(today())}>
          Today
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="cards">
        <div className="card">
          <div className="label">Reported</div>
          <div className="value">
            {data ? `${data.reportedCount}/${data.memberCount}` : '—'}
          </div>
        </div>
        <div className="card">
          <div className="label">Pending</div>
          <div className="value">{data?.pendingCount ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">On leave</div>
          <div className="value">{data?.onLeaveCount ?? '—'}</div>
        </div>
        <div className="card">
          <div className="label">Total hours</div>
          <div className="value">{data ? round(data.totalHours) : '—'}h</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">Members</div>
        {loading ? (
          <Loading />
        ) : !data || data.members.length === 0 ? (
          <div className="empty">No members yet. Add them in Members.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>State</th>
                <th style={{ width: 170 }}>Utilization</th>
                <th className="num">Hours</th>
                <th>Work</th>
                <th style={{ width: 170 }}>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.memberId}>
                  <td style={{ fontWeight: 600 }}>{m.memberName}</td>
                  <td>
                    {m.status === 'holiday' ? (
                      <span className="badge holiday">Holiday</span>
                    ) : m.reported ? (
                      <span className="badge ok">Reported</span>
                    ) : (
                      <span className="badge pending">Pending</span>
                    )}
                    {m.status === 'wfh' && (
                      <span className="badge wfh" style={{ marginLeft: 6 }}>
                        WFH
                      </span>
                    )}
                  </td>
                  <td>
                    {m.status === 'holiday' ? (
                      <span className="muted">—</span>
                    ) : (
                      <UtilBar util={m.utilization} />
                    )}
                  </td>
                  <td className="num">{m.reported ? `${round(m.totalHours)}h` : '—'}</td>
                  <td>
                    {m.entries.length === 0 ? (
                      <span className="muted">
                        {m.status === 'holiday' ? 'On leave' : 'No report'}
                      </span>
                    ) : (
                      <ul className="entries">
                        {m.entries.map((e, i) => (
                          <li key={i}>
                            {e.href ? (
                              <a href={e.href} target="_blank" rel="noreferrer">
                                {e.taskName}
                              </a>
                            ) : (
                              e.taskName
                            )}
                            <span className="muted"> — {e.hours}h</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <div className="status-toggle">
                      <button
                        className={`chip-btn wfh${m.status === 'wfh' ? ' active' : ''}`}
                        onClick={() => toggle(m.memberId, 'wfh')}
                      >
                        WFH
                      </button>
                      <button
                        className={`chip-btn holiday${m.status === 'holiday' ? ' active' : ''}`}
                        onClick={() => toggle(m.memberId, 'holiday')}
                      >
                        Holiday
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function UtilBar({ util }: { util: number }) {
  const pct = Math.min(100, Math.round(util * 100));
  const cls = util >= 1 ? 'over' : util < 0.6 ? 'under' : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className={`bar ${cls}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="muted">{Math.round(util * 100)}%</span>
    </div>
  );
}
