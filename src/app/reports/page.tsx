'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '@/components/Select';
import { Loading } from '@/components/Spinner';
import { useConfirm } from '@/components/Confirm';
import type { DailyReport, Member } from '@/lib/types';

function daysAgo(n: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000)
    .toISOString()
    .slice(0, 10);
}
const round = (n: number) => Math.round(n * 10) / 10;
const sum = (r: DailyReport) => r.entries.reduce((s, e) => s + e.hours, 0);

export default function ReportsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState('');
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(daysAgo(0));
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    api.listMembers().then(setMembers).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .listReports({ from, to, memberId: memberId || undefined })
      .then(setReports)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, memberId]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    const ok = await confirm({
      title: 'Delete report',
      message: 'Delete this report? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteReport(id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Reports</h1>
      <p className="page-sub">Browse submitted daily reports.</p>

      <div className="toolbar">
        <div>
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label>Member</label>
          <Select
            value={memberId}
            onChange={setMemberId}
            placeholder="All members"
            options={members.map((m) => ({ value: m.id, label: m.name }))}
          />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="panel">
        <div className="panel-head">{reports.length} report(s)</div>
        {loading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <div className="empty">No reports in this range.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Member</th>
                <th className="num">Hours</th>
                <th>Tasks</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td style={{ fontWeight: 600 }}>{r.member.name}</td>
                  <td className="num">{round(sum(r))}h</td>
                  <td>
                    <ul className="entries">
                      {r.entries.map((e) => (
                        <li key={e.id}>
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
                  </td>
                  <td>
                    <span className="badge gray">{r.source}</span>
                  </td>
                  <td>
                    <button className="btn danger sm" onClick={() => remove(r.id)}>
                      Delete
                    </button>
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
