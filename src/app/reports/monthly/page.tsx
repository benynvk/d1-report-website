'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Loading } from '@/components/Spinner';
import { Select } from '@/components/Select';
import { LOGO_URL } from '@/lib/brand';
import { taskLabel } from '@/lib/format';
import type { DailyReport, Member } from '@/lib/types';

/** One colour per person, reused by the donut, the daily chart and the table. */
const PALETTE = [
  '#6366f1',
  '#06b6d4',
  '#f59e0b',
  '#22c55e',
  '#ec4899',
  '#8b5cf6',
  '#ef4444',
  '#0ea5e9',
  '#84cc16',
  '#f97316',
];

const HOURS_PER_PERSON_DAY = 8;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function currentMonth(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

function monthBounds(month: string): { from: string; to: string; days: Date[] } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from(
    { length: last },
    (_, i) => new Date(Date.UTC(y, m - 1, i + 1)),
  );
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
    days,
  };
}

const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Every figure in the document carries one decimal, like the reference. */
const n1 = (n: number) => n.toFixed(1);

/** '2026-08-04' -> '04/08/26', the compact form the report header uses. */
function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function generatedAt(): string {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${String(now.getUTCDate()).padStart(2, '0')} ${
    MONTHS[now.getUTCMonth()]
  } ${now.getUTCFullYear()}, ${hh}:${mm}`;
}

interface PersonTotal {
  member: Member;
  color: string;
  hours: number;
  tasks: number;
}

interface TaskRow {
  label: string;
  href: string | null;
  byMember: Map<string, number>;
  total: number;
  /** Colour of whoever put the most hours into it. */
  color: string;
}

export default function MonthlyReportPage() {
  const [month, setMonth] = useState(currentMonth);
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Read ?month= from the URL directly: useSearchParams would force a Suspense
  // boundary on this statically exported page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('month');
    if (q && /^\d{4}-\d{2}$/.test(q)) setMonth(q);
  }, []);

  useEffect(() => {
    const { from, to } = monthBounds(month);
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([api.listMembers(), api.listReports({ from, to })])
      .then(([ms, rs]) => {
        if (cancelled) return;
        setMembers(ms);
        setReports(rs);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const data = useMemo(() => {
    const { from, to, days } = monthBounds(month);
    const workingDays = days.filter(isWeekday).length;

    // People in report order, but only those who logged something this month.
    const hoursByMember = new Map<string, number>();
    const tasksByMember = new Map<string, number>();
    for (const r of reports) {
      for (const e of r.entries) {
        hoursByMember.set(r.member.id, (hoursByMember.get(r.member.id) ?? 0) + e.hours);
        tasksByMember.set(r.member.id, (tasksByMember.get(r.member.id) ?? 0) + 1);
      }
    }
    const people: PersonTotal[] = members
      .filter((m) => (hoursByMember.get(m.id) ?? 0) > 0 || tasksByMember.get(m.id))
      .map((m, i) => ({
        member: m,
        color: PALETTE[i % PALETTE.length],
        hours: hoursByMember.get(m.id) ?? 0,
        tasks: tasksByMember.get(m.id) ?? 0,
      }))
      .sort((a, b) => b.hours - a.hours);
    const colorOf = new Map(people.map((p) => [p.member.id, p.color]));

    const totalHours = people.reduce((s, p) => s + p.hours, 0);

    // Hours per weekday, split by person - the stacked daily chart.
    const daily = days.filter(isWeekday).map((d) => {
      const date = iso(d);
      const parts = people.map((p) => {
        const hours = reports
          .filter((r) => r.date === date && r.member.id === p.member.id)
          .reduce((s, r) => s + r.entries.reduce((t, e) => t + e.hours, 0), 0);
        return { color: p.color, hours };
      });
      return {
        date,
        label: `${String(d.getUTCDate()).padStart(2, '0')}/${String(
          d.getUTCMonth() + 1,
        ).padStart(2, '0')}`,
        parts,
        total: parts.reduce((s, x) => s + x.hours, 0),
      };
    });

    // One row per distinct task, with each person's hours on it.
    const rowsByKey = new Map<string, TaskRow>();
    for (const r of reports) {
      for (const e of r.entries) {
        const label = taskLabel(e);
        // Group by name, not by link: the same task shows up both as a
        // Teamwork link and as a typed-in row, and they belong on one line.
        const key = label.trim().toLowerCase();
        let row = rowsByKey.get(key);
        if (!row) {
          row = { label, href: e.href, byMember: new Map(), total: 0, color: '#94a3b8' };
          rowsByKey.set(key, row);
        }
        row.byMember.set(r.member.id, (row.byMember.get(r.member.id) ?? 0) + e.hours);
        row.total += e.hours;
      }
    }
    const rows = [...rowsByKey.values()]
      .map((row) => {
        const top = [...row.byMember.entries()].sort((a, b) => b[1] - a[1])[0];
        return { ...row, color: (top && colorOf.get(top[0])) || '#94a3b8' };
      })
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

    return {
      from,
      to,
      workingDays,
      people,
      totalHours,
      personDays: totalHours / HOURS_PER_PERSON_DAY,
      daily,
      rows,
      reportDays: new Set(reports.map((r) => r.date)).size,
    };
  }, [month, members, reports]);

  const monthOptions = useMemo(() => {
    const out: string[] = [];
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      out.push(d.toISOString().slice(0, 7));
    }
    return out;
  }, []);

  return (
    <>
      <div className="rpt-toolbar">
        <div className="filter-inline" style={{ minWidth: 190 }}>
          <label>Month</label>
          <Select
            value={month}
            onChange={setMonth}
            /* No empty option: a month is always selected. */
            placeholder=""
            options={monthOptions.map((m) => ({ value: m, label: monthTitle(m) }))}
          />
        </div>
        <button className="btn" onClick={() => window.print()} disabled={loading}>
          Save as PDF
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <Loading />
      ) : (
        <div className="rpt-doc">
          <header className="rpt-head">
            <div>
              <h1>D1 Training - Resource Report</h1>
              <div className="rpt-range">
                {shortDate(data.from)} → {shortDate(data.to)}
              </div>
            </div>
            <div className="rpt-head-right">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO_URL} alt="D1 Training" className="rpt-logo" />
              <div className="rpt-generated">Generated {generatedAt()}</div>
            </div>
          </header>

          <section className="rpt-kpis">
            <div className="rpt-kpi">
              <div className="rpt-kpi-label">Total hours</div>
              <div className="rpt-kpi-value">{n1(data.totalHours)}h</div>
              <div className="rpt-kpi-sub">
                {shortDate(data.from)} → {shortDate(data.to)}
              </div>
            </div>
            <div className="rpt-kpi">
              <div className="rpt-kpi-label">Total person-days</div>
              <div className="rpt-kpi-value">{n1(data.personDays)} PD</div>
              <div className="rpt-kpi-sub">1 PD = {HOURS_PER_PERSON_DAY}h</div>
            </div>
            <div className="rpt-kpi">
              <div className="rpt-kpi-label">Average daily effort</div>
              <div className="rpt-kpi-value">
                {n1(data.workingDays ? data.personDays / data.workingDays : 0)} PD/day
              </div>
              <div className="rpt-kpi-sub">over {data.workingDays} working days</div>
            </div>
          </section>

          <section className="rpt-row">
            <div className="rpt-card rpt-card-donut">
              <div className="rpt-card-title">Hours by person</div>
              <Donut people={data.people} total={data.totalHours} />
              <ul className="rpt-legend">
                {data.people.map((p) => (
                  <li key={p.member.id}>
                    <span className="rpt-dot" style={{ background: p.color }} />
                    {p.member.name} {n1(p.hours)}h (
                    {data.totalHours ? Math.round((p.hours / data.totalHours) * 1000) / 10 : 0}%)
                  </li>
                ))}
              </ul>
            </div>

            <div className="rpt-card rpt-card-daily">
              <div className="rpt-card-title">Daily hours by person</div>
              <DailyChart daily={data.daily} />
            </div>
          </section>

          <section className="rpt-card">
            <div className="rpt-card-title">Hours per person</div>
            <table className="rpt-people">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="c">Role</th>
                  <th />
                  <th className="r">Hours</th>
                  <th className="r">Person-days</th>
                  <th className="r">Tasks</th>
                  <th className="r">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => {
                  const max = data.people[0]?.hours || 1;
                  const share = data.totalHours ? (p.hours / data.totalHours) * 100 : 0;
                  return (
                    <tr key={p.member.id}>
                      <td>
                        <span className="rpt-dot" style={{ background: p.color }} />
                        {p.member.name}
                      </td>
                      <td className="c rpt-muted">
                        {p.member.role === 'full_time'
                          ? 'Full-time'
                          : p.member.role === 'part_time'
                            ? 'Part-time'
                            : 'Support'}
                      </td>
                      <td className="rpt-barcell">
                        <span
                          className="rpt-bar"
                          style={{
                            width: `${(p.hours / max) * 100}%`,
                            background: p.color,
                          }}
                        />
                      </td>
                      <td className="r rpt-strong">{n1(p.hours)}h</td>
                      <td className="r">{n1(p.hours / HOURS_PER_PERSON_DAY)}</td>
                      <td className="r">{p.tasks}</td>
                      <td className="r">{Math.round(share * 10) / 10}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="rpt-card rpt-flow">
            <div className="rpt-card-title">Task log detail</div>
            <table className="rpt-tasks">
              <thead>
                <tr>
                  <th>Task</th>
                  {data.people.map((p) => (
                    <th key={p.member.id} className="r" style={{ color: p.color }}>
                      {p.member.name}
                    </th>
                  ))}
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <span className="rpt-dot" style={{ background: row.color }} />
                      {row.label}
                    </td>
                    {data.people.map((p) => {
                      const h = row.byMember.get(p.member.id);
                      return (
                        <td key={p.member.id} className="r">
                          {h ? n1(h) : ""}
                        </td>
                      );
                    })}
                    <td className="r rpt-strong">{n1(row.total)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <footer className="rpt-foot">
            D1 Training · offspringdigital.com · {data.rows.length} tasks ·{' '}
            {data.reportDays} reported days
          </footer>
        </div>
      )}
    </>
  );
}

/** Ring chart: one arc per person, drawn with dash offsets on a circle. */
function Donut({ people, total }: { people: PersonTotal[]; total: number }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="rpt-donut" role="img">
      <circle cx="70" cy="70" r={R} fill="none" stroke="#eef0f4" strokeWidth="22" />
      {total > 0 &&
        people.map((p) => {
          const len = (p.hours / total) * C;
          const el = (
            <circle
              key={p.member.id}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={p.color}
              strokeWidth="22"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
    </svg>
  );
}

/** Stacked column per working day, coloured by person. */
function DailyChart({
  daily,
}: {
  daily: { date: string; label: string; parts: { color: string; hours: number }[]; total: number }[];
}) {
  const W = 560;
  const H = 190;
  const PAD_L = 26;
  const PAD_B = 22;
  const peak = Math.max(8, ...daily.map((d) => d.total));
  const step = peak > 30 ? 10 : peak > 15 ? 5 : 2;
  const ticks = Array.from({ length: Math.floor(peak / step) + 1 }, (_, i) => i * step);
  const top = ticks[ticks.length - 1] || peak;
  const plotH = H - PAD_B - 8;
  const slot = (W - PAD_L) / Math.max(daily.length, 1);
  const barW = Math.min(16, slot * 0.62);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rpt-chart" role="img">
      {ticks.map((t) => {
        const y = 8 + plotH - (t / top) * plotH;
        return (
          <g key={t}>
            <line x1={PAD_L} x2={W} y1={y} y2={y} stroke="#eef0f4" strokeWidth="1" />
            <text x={PAD_L - 5} y={y + 3} textAnchor="end" className="rpt-axis">
              {t}h
            </text>
          </g>
        );
      })}
      {daily.map((d, i) => {
        const x = PAD_L + i * slot + (slot - barW) / 2;
        let y = 8 + plotH;
        return (
          <g key={d.date}>
            {d.parts.map((part, j) => {
              if (!part.hours) return null;
              const h = (part.hours / top) * plotH;
              y -= h;
              return <rect key={j} x={x} y={y} width={barW} height={h} fill={part.color} />;
            })}
            <text
              x={x + barW / 2}
              y={H - PAD_B + 14}
              textAnchor="middle"
              className="rpt-axis"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
