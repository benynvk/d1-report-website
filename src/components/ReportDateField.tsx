'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface ViewMonth {
  year: number;
  month: number; // 1-12
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function todayIso(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function parseViewMonth(iso: string): ViewMonth {
  const m = /^(\d{4})-(\d{2})/.exec(iso || todayIso());
  if (!m) return parseViewMonth(todayIso());
  return { year: Number(m[1]), month: Number(m[2]) };
}

function shiftMonth(v: ViewMonth, delta: number): ViewMonth {
  const idx = v.year * 12 + (v.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function monthKey(v: ViewMonth): string {
  return `${v.year}-${String(v.month).padStart(2, '0')}`;
}

function isoDay(v: ViewMonth, day: number): string {
  return `${monthKey(v)}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(v: ViewMonth): number {
  return new Date(Date.UTC(v.year, v.month, 0)).getUTCDate();
}

/** 0 = Sunday .. 6 = Saturday. */
function weekdayOf(v: ViewMonth, day: number): number {
  return new Date(Date.UTC(v.year, v.month - 1, day)).getUTCDay();
}

/**
 * Date picker for the Add report modal: colors each day by that member's
 * report status (green = met the hour target, yellow = reported but short,
 * red = nothing reported on a working day) and disables weekends / full-day
 * leave. Unlike the generic DateField, this always needs a member in
 * context, so it's specific to this modal rather than a shared component.
 */
export function ReportDateField({
  value,
  onChange,
  memberId,
  baseThreshold,
}: {
  value: string;
  onChange: (v: string) => void;
  memberId: string;
  baseThreshold?: number;
}) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<ViewMonth>(() => parseViewMonth(value));
  const [hoursByDate, setHoursByDate] = useState<Map<string, number>>(new Map());
  const [attByDate, setAttByDate] = useState<
    Map<string, { status: string; hours: number | null }>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Re-center the visible month on whatever date the field currently holds
  // each time the popover opens (e.g. after switching member/day elsewhere).
  useEffect(() => {
    if (open) setViewMonth(parseViewMonth(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !memberId) return;
    let cancelled = false;
    setLoading(true);
    const from = isoDay(viewMonth, 1);
    const to = isoDay(viewMonth, daysInMonth(viewMonth));
    Promise.all([
      api.listReports({ memberId, from, to }),
      api.listAttendance({ memberId, from, to }),
    ])
      .then(([reports, attendance]) => {
        if (cancelled) return;
        const hMap = new Map<string, number>();
        for (const r of reports) {
          const total = r.entries.reduce((s, e) => s + e.hours, 0);
          hMap.set(r.date, (hMap.get(r.date) ?? 0) + total);
        }
        setHoursByDate(hMap);
        setAttByDate(new Map(attendance.map((a) => [a.date, { status: a.status, hours: a.hours }])));
      })
      .catch(() => {
        if (!cancelled) {
          setHoursByDate(new Map());
          setAttByDate(new Map());
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, memberId, viewMonth.year, viewMonth.month]);

  const today = todayIso();
  const firstDow = weekdayOf(viewMonth, 1);
  const leadingBlanks = (firstDow + 6) % 7; // Monday-first offset

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" className="date-field" onClick={() => setOpen((o) => !o)}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{value ? formatDate(value) : 'dd/mm/yyyy'}</span>
      </button>

      {open && (
        <div className="cal-popover">
          <div className="cal-nav">
            <button type="button" onClick={() => setViewMonth((v) => shiftMonth(v, -1))}>
              ‹
            </button>
            <span>
              {MONTH_LABELS[viewMonth.month - 1]} {viewMonth.year}
            </span>
            <button type="button" onClick={() => setViewMonth((v) => shiftMonth(v, 1))}>
              ›
            </button>
          </div>
          <div className="cal-grid">
            {WEEKDAY_LABELS.map((w) => (
              <div className="cal-weekday" key={w}>
                {w}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {Array.from({ length: daysInMonth(viewMonth) }, (_, i) => i + 1).map((day) => {
              const iso = isoDay(viewMonth, day);
              const dow = weekdayOf(viewMonth, day);
              const isWeekend = dow === 0 || dow === 6;
              const att = attByDate.get(iso);
              const fullyOff =
                att?.status === 'holiday' && (att.hours == null || att.hours >= 8);
              const disabled = isWeekend || fullyOff;
              const reported = hoursByDate.has(iso);
              const hours = hoursByDate.get(iso) ?? 0;
              const isFuture = iso > today;

              let statusClass = '';
              if (memberId && !disabled) {
                if (!reported) {
                  if (!isFuture) statusClass = 'red';
                } else {
                  const effThreshold =
                    baseThreshold != null ? Math.max(0, baseThreshold - (att?.hours ?? 0)) : null;
                  statusClass = effThreshold == null || hours >= effThreshold ? 'green' : 'yellow';
                }
              }

              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  className={[
                    'cal-day',
                    statusClass,
                    disabled ? 'disabled' : '',
                    iso === value ? 'selected' : '',
                    iso === today ? 'today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={reported ? `${hours}h reported` : undefined}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          {loading && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              Loading…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
