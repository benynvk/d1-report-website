'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { todayVN } from '@/lib/format';
import { DatePicker, type ViewMonth, daysInMonth, isoDay, parseViewMonth } from './Calendar';

/**
 * The Add report date picker: the app's calendar, with each day colored by
 * the member's report status (green = hour target met, yellow = reported but
 * short, red = nothing on a past working day); weekends and full days off are
 * disabled.
 */
export function ReportDateField({
  value,
  onChange,
  memberId,
  baseThreshold,
  refreshKey,
}: {
  value: string;
  onChange: (v: string) => void;
  memberId: string;
  baseThreshold?: number;
  /** Bump after a save so the saved day's color updates. */
  refreshKey?: number;
}) {
  const [view, setView] = useState<ViewMonth>(() => parseViewMonth(value));
  const [hoursByDate, setHoursByDate] = useState<Map<string, number>>(new Map());
  const [leaveByDate, setLeaveByDate] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(false);

  // Loaded as soon as a member is known, so the calendar opens already colored.
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    setLoading(true);
    const from = isoDay(view, 1);
    const to = isoDay(view, daysInMonth(view));
    Promise.all([api.listReports({ memberId, from, to }), api.listAttendance({ memberId, from, to })])
      .then(([reports, attendance]) => {
        if (cancelled) return;
        const hours = new Map<string, number>();
        for (const r of reports) hours.set(r.date, (hours.get(r.date) ?? 0) + r.entries.reduce((s, e) => s + e.hours, 0));
        setHoursByDate(hours);
        setLeaveByDate(new Map(attendance.filter((a) => a.status === 'holiday').map((a) => [a.date, a.hours])));
      })
      .catch(() => {
        if (cancelled) return;
        setHoursByDate(new Map());
        setLeaveByDate(new Map());
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [memberId, view.year, view.month, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayVN();
  return (
    <DatePicker
      value={value}
      onChange={onChange}
      onMonthChange={setView}
      footer={loading ? <span className="muted">Loading…</span> : <span />}
      dayProps={(iso, dow) => {
        const leave = leaveByDate.has(iso) ? (leaveByDate.get(iso) ?? 8) : 0;
        if (dow === 0 || dow === 6 || leave >= 8) return { disabled: true };
        if (!memberId) return {};
        if (!hoursByDate.has(iso)) return iso > today ? {} : { className: 'red' };
        const hours = hoursByDate.get(iso)!;
        const target = baseThreshold != null ? Math.max(0, baseThreshold - leave) : null;
        return {
          className: target == null || hours >= target ? 'green' : 'yellow',
          title: hours ? `${hours}h reported` : 'Reported, no hours yet',
        };
      }}
    />
  );
}
