'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Loading } from '@/components/Spinner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar } from '@/components/Avatar';
import { MemberDetail } from '@/components/MemberDetail';
import { DateField } from '@/components/DateField';
import { formatDate, taskLabel } from '@/lib/format';
import type { DailyOverview, SummaryResult } from '@/lib/types';

interface SelectedMember {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const LOGO =
  'https://d1-mobile-app.s3.us-east-1.amazonaws.com/assets/d1_training_logo.png';
const DAY = 86400000;
const round = (n: number) => Math.round(n * 100) / 100;
// Line-chart reveal timing: wait for bars to grow, then connect points one at
// a time (must match the .line-tasks transition-duration in CSS).
const LINE_BASE_DELAY = 650;
const LINE_SEGMENT_MS = 150;

/** Local (VN, UTC+7) date string 'YYYY-MM-DD' for `daysAgo` days back. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - days * DAY)
    .toISOString()
    .slice(0, 10);
}

/** First day of the current (local) month, as 'YYYY-MM-DD'. */
function isoMonthStart(): string {
  return isoDaysAgo(0).slice(0, 8) + '01';
}

const PRESETS = [
  { key: 'mtd', label: 'This month' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
];

/** Range start for a preset key ('mtd' or a day count). */
function fromForPreset(key: string): string {
  return key === 'mtd' ? isoMonthStart() : isoDaysAgo(Number(key));
}

/** Defaults to month-to-date, unless we're less than a week into the month
 * (too short a range to be useful) — then last-7-days instead. */
function defaultPresetKey(): string {
  const dayOfMonth = Number(isoDaysAgo(0).slice(8, 10));
  return dayOfMonth < 7 ? '7' : 'mtd';
}

export default function HomePage() {
  const [preset, setPreset] = useState<string>(defaultPresetKey);
  const [from, setFrom] = useState<string>(() => fromForPreset(defaultPresetKey()));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [today, setToday] = useState<DailyOverview | null>(null);
  const [yesterday, setYesterday] = useState<DailyOverview | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [daysLoading, setDaysLoading] = useState(true);
  const [error, setError] = useState('');
  const [grown, setGrown] = useState(false);
  const [selected, setSelected] = useState<SelectedMember | null>(null);

  const tISO = useMemo(() => isoDaysAgo(0), []);
  const yISO = useMemo(() => isoDaysAgo(1), []);

  const applyPreset = (key: string) => {
    setPreset(key);
    setFrom(fromForPreset(key));
    setTo(isoDaysAgo(0));
  };

  // Chart depends on the selected range.
  useEffect(() => {
    setChartLoading(true);
    api
      .summary(from, to)
      .then(setSummary)
      .catch((e) => setError(e.message))
      .finally(() => setChartLoading(false));
  }, [from, to]);

  // Today / Yesterday are independent of the range — load once.
  useEffect(() => {
    setDaysLoading(true);
    Promise.all([api.daily(tISO), api.daily(yISO)])
      .then(([t, y]) => {
        setToday(t);
        setYesterday(y);
      })
      .catch((e) => setError(e.message))
      .finally(() => setDaysLoading(false));
  }, [tISO, yISO]);

  const members = (summary?.members ?? []).map((m) => ({
    ...m,
    avgPerDay: m.daysReported ? m.totalHours / m.daysReported : 0,
  }));
  const maxAvg = members.reduce((m, x) => Math.max(m, x.avgPerDay), 0) || 1;
  const N = members.length;
  const tasksArr = members.map((m) => m.taskCount);
  const minTasks = Math.min(...tasksArr, 0);
  const maxTasks = Math.max(...tasksArr, 1);
  const px = (i: number) => ((i + 0.5) / N) * 100;
  // Normalize into a band centered on the vertical middle of the bar (40..84)
  // so small variations don't look flat, without floating too high.
  const py = (val: number) =>
    maxTasks === minTasks
      ? 62
      : 40 + (1 - (val - minTasks) / (maxTasks - minTasks)) * 44;
  const tasksPts = members.map((m, i) => ({ x: px(i), y: py(m.taskCount) }));

  // Re-run the grow animation whenever the chart data changes.
  useEffect(() => {
    setGrown(false);
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, [summary]);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="home-hero">
        <div className="home-hero-toggle">
          <ThemeToggle />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} alt="D1 Training" className="brand-logo home-logo" />
        <h1 className="home-title">Workload Dashboard</h1>
      </div>

      <div className="toolbar home-toolbar">
        <div className="preset-group">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={`preset-btn${preset === p.key ? ' active' : ''}`}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="date-range">
          <DateField
            value={from}
            onChange={(v) => {
              setPreset('');
              setFrom(v);
            }}
          />
          <span className="muted">→</span>
          <DateField
            value={to}
            onChange={(v) => {
              setPreset('');
              setTo(v);
            }}
          />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="panel" style={{ marginBottom: 22, paddingTop: 8 }}>
        <div className="chart-range">
          {formatDate(from)} <span className="chart-range-arrow">→</span>{' '}
          {formatDate(to)}
        </div>
        {chartLoading ? (
          <Loading />
        ) : members.length === 0 ? (
          <div className="empty">No reports in this range.</div>
        ) : (
          <>
            <div className="bar-chart">
              {members.map((m, i) => {
                const pct = (m.avgPerDay / maxAvg) * 100;
                const open = () =>
                  setSelected({
                    id: m.memberId,
                    name: m.memberName,
                    avatarUrl: m.avatarUrl,
                  });
                return (
                  <div className="bar-col" key={m.memberId}>
                    <div className="bar-col-track">
                      <span
                        className="bar-col-value"
                        style={{
                          bottom: `calc(${grown ? pct : 0}% + 4px)`,
                          transitionDelay: `${i * 60}ms`,
                        }}
                      >
                        {round(m.avgPerDay)}
                      </span>
                      <div
                        className="bar-col-fill"
                        style={{
                          height: `${grown ? pct : 0}%`,
                          transitionDelay: `${i * 60}ms`,
                        }}
                      />
                    </div>
                    <div className="bar-col-label clickable" onClick={open}>
                      <Avatar name={m.memberName} src={m.avatarUrl} size={34} />
                      <span className="bar-name">{m.memberName}</span>
                    </div>
                    <span className="bar-mobile-tasks">{m.taskCount} tasks</span>
                  </div>
                );
              })}
              {/* Overlaid line: total tasks per member. Segments draw one at
                  a time, left to right — each starts only once the previous
                  one has finished (no overlap). */}
              <svg
                className="bar-line-overlay"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {tasksPts.slice(1).map((p, i) => {
                  const prev = tasksPts[i];
                  return (
                    <line
                      key={i}
                      className={`line-tasks${grown ? ' grown' : ''}`}
                      x1={prev.x}
                      y1={prev.y}
                      x2={p.x}
                      y2={p.y}
                      pathLength={1}
                      style={{ transitionDelay: `${LINE_BASE_DELAY + i * LINE_SEGMENT_MS}ms` }}
                    />
                  );
                })}
              </svg>
              <div className="line-labels">
                {members.map((m, i) => (
                  <span
                    key={m.memberId}
                    className={`line-dot${grown ? ' grown' : ''}`}
                    style={{
                      left: `${tasksPts[i].x}%`,
                      top: `${tasksPts[i].y}%`,
                      transitionDelay: `${LINE_BASE_DELAY + i * LINE_SEGMENT_MS}ms`,
                    }}
                  />
                ))}
                {members.map((m, i) => (
                  <span
                    key={m.memberId}
                    className={`line-label${grown ? ' grown' : ''}`}
                    style={{
                      left: `${tasksPts[i].x}%`,
                      top: `${tasksPts[i].y}%`,
                      transitionDelay: `${LINE_BASE_DELAY + i * LINE_SEGMENT_MS}ms`,
                    }}
                  >
                    {m.taskCount}
                  </span>
                ))}
              </div>
            </div>
            <div className="chart-legend">
              <span className="legend-item">
                <span className="bar-swatch" /> Avg working hours/day
              </span>
              <span className="legend-item">
                <span className="line-swatch tasks" /> Total tasks
              </span>
            </div>
          </>
        )}
      </div>

      <div className="row">
        <DayPanel
          title="Yesterday"
          date={yISO}
          data={yesterday}
          loading={daysLoading}
          onSelect={setSelected}
        />
        <DayPanel
          title="Today"
          date={tISO}
          data={today}
          loading={daysLoading}
          onSelect={setSelected}
        />
      </div>

      {selected && (
        <MemberDetail
          memberId={selected.id}
          memberName={selected.name}
          avatarUrl={selected.avatarUrl}
          onClose={() => setSelected(null)}
        />
      )}

      <Link
        href="/reports"
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--primary)',
          color: '#fff',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
          zIndex: 50,
        }}
        title="Reports"
        aria-label="Reports"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.6a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.04-1.56V4.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.56 1.04h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
        </svg>
      </Link>
    </div>
  );
}

function DayPanel({
  title,
  date,
  data,
  loading,
  onSelect,
}: {
  title: string;
  date: string;
  data: DailyOverview | null;
  loading: boolean;
  onSelect: (m: SelectedMember) => void;
}) {
  return (
    <div className="col">
      <div className="panel">
        <div className="panel-head">
          {title} · {formatDate(date)}
        </div>
        {loading ? (
          <Loading />
        ) : !data || data.members.length === 0 ? (
          <div className="empty">No members.</div>
        ) : (
          <div className="yday-list">
            {data.members.map((m) => {
              const fullyOff =
                m.status === 'holiday' &&
                (m.holidayHours == null || m.holidayHours >= 8);
              return (
                <div
                  className="yday-row clickable"
                  key={m.memberId}
                  onClick={() =>
                    onSelect({
                      id: m.memberId,
                      name: m.memberName,
                      avatarUrl: m.avatarUrl,
                    })
                  }
                >
                  <span className="yday-name member-cell">
                    <Avatar name={m.memberName} src={m.avatarUrl} size={24} />
                    <span>{m.memberName}</span>
                  </span>
                  <div className="yday-body">
                    {fullyOff ? (
                      <span className="badge holiday">Holiday</span>
                    ) : (
                      <>
                        {m.status === 'holiday' && (
                          <span className="badge holiday" style={{ marginRight: 6 }}>
                            Leave {m.holidayHours}h
                          </span>
                        )}
                        {!m.reported ? (
                          m.role === 'support' ? (
                            <span className="badge">Support</span>
                          ) : (
                            <span className="badge pending">Not reported</span>
                          )
                        ) : (
                          <ul className="entries">
                            {m.entries.map((e, i) => (
                              <li key={i}>
                                <span className="task-name">
                                  {e.href ? (
                                    <a
                                      href={e.href}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(ev) => ev.stopPropagation()}
                                    >
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
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
