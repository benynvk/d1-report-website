'use client';

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
  const [today, setToday] = useState<DailyOverview | null>(null);
  const [yesterday, setYesterday] = useState<DailyOverview | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [daysLoading, setDaysLoading] = useState(true);
  const [error, setError] = useState('');
  const [grown, setGrown] = useState(false);
  const [selected, setSelected] = useState<SelectedMember | null>(null);

  const tISO = useMemo(() => isoDaysAgo(0), []);
  const yISO = useMemo(() => isoDaysAgo(1), []);

  const applyPreset = (days: number) => {
    setPreset(days);
    setFrom(isoDaysAgo(days));
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
  const maxTasks = members.reduce((m, x) => Math.max(m, x.taskCount), 0) || 1;
  const maxTotal = members.reduce((m, x) => Math.max(m, x.totalHours), 0) || 1;
  const N = members.length;
  // Points for the overlaid line charts (viewBox 0..100, top-padded to 8).
  const px = (i: number) => ((i + 0.5) / N) * 100;
  const py = (val: number, max: number) => 8 + (1 - val / max) * 84;
  const tasksPts = members.map((m, i) => `${px(i)},${py(m.taskCount, maxTasks)}`);
  const hoursPts = members.map((m, i) => `${px(i)},${py(m.totalHours, maxTotal)}`);

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

      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
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
        <div className="date-range">
          <DateField
            value={from}
            onChange={(v) => {
              setPreset(0);
              setFrom(v);
            }}
          />
          <span className="muted">→</span>
          <DateField
            value={to}
            onChange={(v) => {
              setPreset(0);
              setTo(v);
            }}
          />
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="panel" style={{ marginBottom: 22, paddingTop: 8 }}>
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
                  <div className="bar-col clickable" key={m.memberId} onClick={open}>
                    <div className="bar-col-track">
                      <span
                        className="bar-col-value"
                        style={{
                          bottom: `calc(${grown ? pct : 0}% + 7px)`,
                          transitionDelay: `${i * 60}ms`,
                        }}
                      >
                        {round(m.avgPerDay)}h
                      </span>
                      <div
                        className="bar-col-fill"
                        style={{
                          height: `${grown ? pct : 0}%`,
                          transitionDelay: `${i * 60}ms`,
                        }}
                      >
                        <span className="bar-col-onbar">
                          {m.taskCount} tasks
                          <br />
                          {round(m.totalHours)}h
                        </span>
                      </div>
                    </div>
                    <div className="bar-col-label">
                      <Avatar name={m.memberName} src={m.avatarUrl} size={34} />
                      <span className="bar-name">{m.memberName}</span>
                    </div>
                  </div>
                );
              })}
              {/* Overlaid line charts: tasks & total hours */}
              <svg
                className="bar-line-overlay"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polyline className="line-hours" points={hoursPts.join(' ')} />
                <polyline className="line-tasks" points={tasksPts.join(' ')} />
              </svg>
            </div>
            <div className="chart-legend">
              <span className="legend-item">
                <span className="bar-swatch" /> Avg working hours / day
              </span>
              <span className="legend-item">
                <span className="line-swatch hours" /> Total hours
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
            {data.members.map((m) => (
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
                  {m.status === 'holiday' ? (
                    <span className="badge holiday">Holiday</span>
                  ) : !m.reported ? (
                    m.isSupport ? (
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
