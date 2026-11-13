'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '@/components/Select';
import { Loading } from '@/components/Spinner';
import { useConfirm } from '@/components/Confirm';
import { Avatar } from '@/components/Avatar';
import { DateField } from '@/components/DateField';
import { ImportReportModal } from '@/components/ImportReportModal';
import { WipSummaryModal } from '@/components/WipSummaryModal';
import { ChatIcon, EditIcon, TrashIcon } from '@/components/icons';
import { addDays, formatDayLong, formatHours, taskLabel, todayVN } from '@/lib/format';
import type { DailyReport, Member } from '@/lib/types';

const sum = (r: DailyReport) => r.entries.reduce((s, e) => s + e.hours, 0);
const round = (h: number) => Math.round(h * 100) / 100;

/** Quick ranges: [key, label, from, to]. Weeks start on Monday. */
function presets(): { key: string; label: string; from: string; to: string }[] {
  const today = todayVN();
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: 'week', label: 'This week', from: addDays(today, -weekday), to: today },
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'lastmonth', label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
  ];
}

const DAYS_PAGE = 7;

export default function ReportsPage() {
  const initial = presets()[1];
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [visibleDays, setVisibleDays] = useState(DAYS_PAGE);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ message: string; warning?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showWip, setShowWip] = useState(false);
  const [editTarget, setEditTarget] = useState<{ memberId: string; date: string } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  useEffect(() => {
    api.listMembers().then(setMembers).catch(() => {});
  }, []);
  const avatarOf = useMemo(() => new Map(members.map((m) => [m.id, m.avatarUrl])), [members]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .listReports({ from, to, memberId: memberId || undefined })
      .then((r) => {
        setReports(r);
        setVisibleDays(DAYS_PAGE);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, memberId]);
  useEffect(load, [load]);

  // Newest day first; within a day, the order the API returned.
  const days = useMemo(() => {
    const map = new Map<string, DailyReport[]>();
    for (const r of reports) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return [...map.entries()];
  }, [reports]);

  // Infinite scroll by day groups.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver((e) => e[0].isIntersecting && setVisibleDays((v) => v + DAYS_PAGE), {
      rootMargin: '300px',
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [days, visibleDays]);

  const openAdd = () => {
    setNotice(null);
    setEditTarget(null);
    setShowImport(true);
  };
  const openEdit = (r: DailyReport) => {
    setNotice(null);
    setEditTarget({ memberId: r.member.id, date: r.date });
    setShowImport(true);
  };
  const remove = async (r: DailyReport) => {
    const yes = await confirm({
      title: 'Delete this report?',
      message: `${r.member.name}'s report for ${formatDayLong(r.date)}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.deleteReport(r.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const activePreset = presets().find((p) => p.from === from && p.to === to)?.key;
  const totalHours = round(reports.reduce((s, r) => s + sum(r), 0));

  return (
    <>
      <div className="page-head-row">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">What everyone worked on, day by day.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => setShowWip(true)}>
            WIP summary
          </button>
          <Link className="btn ghost" href={`/reports/monthly?month=${to.slice(0, 7)}`}>
            Monthly report
          </Link>
          <button className="btn" onClick={openAdd}>
            + Add report
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice.message}</div>}
      {notice?.warning && <div className="alert warn">{notice.warning}</div>}

      <div className="panel">
        <div className="panel-head filter-head">
          <div className="preset-group">
            {presets().map((p) => (
              <button
                key={p.key}
                className={`preset-btn${activePreset === p.key ? ' active' : ''}`}
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="date-range">
            <DateField value={from} onChange={setFrom} />
            <span className="muted">→</span>
            <DateField value={to} onChange={setTo} />
          </div>
          <div style={{ minWidth: 200 }}>
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
          {!loading && (
            <span className="filter-head-count">
              {reports.length} report{reports.length === 1 ? '' : 's'} · {totalHours}h
            </span>
          )}
        </div>

        {loading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <div className="empty">
            No reports in this range.{' '}
            <button className="link-btn" onClick={openAdd}>
              Add one
            </button>
          </div>
        ) : (
          <div className="day-groups">
            {days.slice(0, visibleDays).map(([date, list]) => (
              <section key={date} className="day-group">
                <div className="day-group-head">
                  <span className="day-group-date">{formatDayLong(date)}</span>
                  <span className="muted">
                    {list.length} report{list.length === 1 ? '' : 's'} · {round(list.reduce((s, r) => s + sum(r), 0))}h
                  </span>
                </div>
                {list.map((r) => {
                  const hours = sum(r);
                  return (
                    <div key={r.id} className="report-row">
                      <div className="member-cell report-row-member">
                        <Avatar name={r.member.name} src={avatarOf.get(r.member.id)} size={28} />
                        <span className="member-cell-name">{r.member.name}</span>
                        {r.source === 'google-chat' && (
                          <span className="source-chip" title="Sent from Google Chat">
                            <ChatIcon />
                          </span>
                        )}
                      </div>
                      <ul className="report-tasks">
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
                            {e.inProgress && <span className="wip-chip">In progress</span>}
                            {e.hours > 0 && <span className="task-hours">{formatHours(e.hours)}</span>}
                          </li>
                        ))}
                      </ul>
                      <div className="report-row-total">
                        {hours > 0 ? <strong>{formatHours(hours)}</strong> : <span className="muted">-</span>}
                      </div>
                      <div className="row-actions">
                        <button className="icon-only" onClick={() => openEdit(r)} title="Edit" aria-label="Edit report">
                          <EditIcon />
                        </button>
                        <button className="icon-only danger" onClick={() => remove(r)} title="Delete" aria-label="Delete report">
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
            {visibleDays < days.length && (
              <div ref={sentinel} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                Loading more…
              </div>
            )}
          </div>
        )}
      </div>

      {showImport && (
        <ImportReportModal
          initialMemberId={editTarget?.memberId}
          initialDate={editTarget?.date}
          onClose={() => setShowImport(false)}
          onImported={(result) => {
            load();
            setNotice(result);
          }}
        />
      )}

      {showWip && <WipSummaryModal members={members} onClose={() => setShowWip(false)} />}
    </>
  );
}
