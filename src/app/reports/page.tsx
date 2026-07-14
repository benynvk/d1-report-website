'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '@/components/Select';
import { Loading } from '@/components/Spinner';
import { useConfirm } from '@/components/Confirm';
import { Avatar } from '@/components/Avatar';
import { DateField } from '@/components/DateField';
import { ImportReportModal } from '@/components/ImportReportModal';
import { formatDate, taskLabel } from '@/lib/format';
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
  const [visible, setVisible] = useState(20);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [editTarget, setEditTarget] = useState<{ memberId: string; date: string } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  const openAdd = () => {
    setEditTarget(null);
    setShowImport(true);
  };

  const openEdit = (r: DailyReport) => {
    setEditTarget({ memberId: r.member.id, date: r.date });
    setShowImport(true);
  };

  useEffect(() => {
    api.listMembers().then(setMembers).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .listReports({ from, to, memberId: memberId || undefined })
      .then((r) => {
        setReports(r);
        setVisible(20);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, memberId]);

  useEffect(() => {
    load();
  }, [load]);

  // Infinite scroll: reveal 20 more when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible((v) => v + 20);
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reports]);

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
      <div className="page-head-row">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Browse submitted daily reports.
          </p>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="filter-inline">
            <label>From</label>
            <DateField value={from} onChange={setFrom} />
          </div>
          <div className="filter-inline">
            <label>To</label>
            <DateField value={to} onChange={setTo} />
          </div>
          <div className="filter-inline" style={{ minWidth: 240 }}>
            <label>Member</label>
            <Select
              value={memberId}
              onChange={setMemberId}
              placeholder="All members"
              options={members.map((m) => ({
                value: m.id,
                label: m.name,
                icon: <Avatar name={m.name} src={m.avatarUrl} size={20} />,
              }))}
            />
          </div>
          <button className="btn" onClick={openAdd}>
            + Add
          </button>
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
          <table className="rpt">
            <thead>
              <tr>
                <th className="c">Date</th>
                <th className="c">Member</th>
                <th className="c">Hours</th>
                <th className="c">Tasks</th>
                <th className="c">Source</th>
                <th className="c"></th>
              </tr>
            </thead>
            <tbody>
              {reports.slice(0, visible).map((r) => (
                <tr key={r.id}>
                  <td className="c mid">{formatDate(r.date)}</td>
                  <td className="mid">
                    <div className="member-cell">
                      <Avatar name={r.member.name} src={r.member.avatarUrl} size={28} />
                      <span style={{ fontWeight: 600 }}>{r.member.name}</span>
                    </div>
                  </td>
                  <td className="c mid">{round(sum(r))}h</td>
                  <td className="mid">
                    <ul className="entries">
                      {r.entries.map((e) => (
                        <li key={e.id}>
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
                  </td>
                  <td className="c mid">
                    <span className="badge gray">{r.source}</span>
                  </td>
                  <td className="c mid">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button className="btn ghost sm" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button className="btn danger sm" onClick={() => remove(r.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visible < reports.length && (
          <div ref={sentinel} style={{ padding: 16, textAlign: 'center' }}>
            <span className="muted">Loading more…</span>
          </div>
        )}
      </div>

      {showImport && (
        <ImportReportModal
          initialMemberId={editTarget?.memberId}
          initialDate={editTarget?.date}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </>
  );
}
