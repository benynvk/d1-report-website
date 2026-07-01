'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SummaryResult } from '@/lib/types';

function daysAgo(n: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000)
    .toISOString()
    .slice(0, 10);
}
const round = (n: number) => Math.round(n * 10) / 10;

export default function SummaryPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [data, setData] = useState<SummaryResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .summary(from, to)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const max = data?.members.reduce((m, x) => Math.max(m, x.totalHours), 0) || 1;

  return (
    <>
      <h1 className="page-title">Summary</h1>
      <p className="page-sub">Total reported hours per member over a range.</p>

      <div className="toolbar">
        <div>
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="panel">
        <div className="panel-head">Leaderboard</div>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : !data || data.members.length === 0 ? (
          <div className="empty">No data in this range.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ width: 320 }}>Hours</th>
                <th className="num">Total</th>
                <th className="num">Days</th>
                <th className="num">Avg/day</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.memberId}>
                  <td style={{ fontWeight: 600 }}>{m.memberName}</td>
                  <td>
                    <div className="bar">
                      <span style={{ width: `${(m.totalHours / max) * 100}%` }} />
                    </div>
                  </td>
                  <td className="num">{round(m.totalHours)}h</td>
                  <td className="num">{m.daysReported}</td>
                  <td className="num">
                    {round(m.totalHours / (m.daysReported || 1))}h
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
