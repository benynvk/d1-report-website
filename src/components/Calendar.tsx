'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, todayVN } from '@/lib/format';

/**
 * The app's date picker: a dd/mm/yyyy button that opens a month calendar
 * (Monday first). Every date field uses it, so pickers look and behave the
 * same everywhere; `dayProps` lets a caller color or disable days.
 */

export interface ViewMonth {
  year: number;
  month: number; // 1-12
}

export interface DayProps {
  className?: string;
  disabled?: boolean;
  title?: string;
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const POPOVER_WIDTH = 260;

export function parseViewMonth(iso: string): ViewMonth {
  const m = /^(\d{4})-(\d{2})/.exec(iso || todayVN()) ?? /^(\d{4})-(\d{2})/.exec(todayVN())!;
  return { year: Number(m[1]), month: Number(m[2]) };
}
const shift = (v: ViewMonth, delta: number): ViewMonth => {
  const idx = v.year * 12 + (v.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};
export const isoDay = (v: ViewMonth, day: number) =>
  `${v.year}-${String(v.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
export const daysInMonth = (v: ViewMonth) => new Date(Date.UTC(v.year, v.month, 0)).getUTCDate();
/** 0 = Sunday .. 6 = Saturday. */
export const weekdayOf = (v: ViewMonth, day: number) => new Date(Date.UTC(v.year, v.month - 1, day)).getUTCDay();

export function DatePicker({
  value,
  onChange,
  dayProps,
  onMonthChange,
  footer,
}: {
  value: string;
  onChange: (iso: string) => void;
  /** Per-day styling/disabling, e.g. report status colors. */
  dayProps?: (iso: string, dayOfWeek: number) => DayProps;
  /** Called with the month on screen (to load data for it). */
  onMonthChange?: (v: ViewMonth) => void;
  /** Shown under the grid (e.g. a loading note). */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMonth>(() => parseViewMonth(value));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => onMonthChange?.(view), [view.year, view.month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the selected date's month whenever the picker opens.
  useEffect(() => {
    if (open) setView(parseViewMonth(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on an outside click or Esc (Esc stops here so a host modal stays open).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Portaled to <body> so no container clips it; positioned from the trigger.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - POPOVER_WIDTH - 8);
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const today = todayVN();
  const leadingBlanks = (weekdayOf(view, 1) + 6) % 7; // Monday-first
  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }} ref={triggerRef}>
      <button type="button" className="date-field" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{value ? formatDate(value) : 'dd/mm/yyyy'}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div className="cal-popover" ref={popoverRef} style={{ top: pos.top, left: pos.left }} role="dialog">
            <div className="cal-nav">
              <button type="button" onClick={() => setView((v) => shift(v, -1))} aria-label="Previous month">
                ‹
              </button>
              <span>
                {MONTH_LABELS[view.month - 1]} {view.year}
              </span>
              <button type="button" onClick={() => setView((v) => shift(v, 1))} aria-label="Next month">
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
              {Array.from({ length: daysInMonth(view) }, (_, i) => i + 1).map((day) => {
                const iso = isoDay(view, day);
                const p = dayProps?.(iso, weekdayOf(view, day)) ?? {};
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={p.disabled}
                    title={p.title}
                    className={['cal-day', p.className, p.disabled && 'disabled', iso === value && 'selected', iso === today && 'today']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => pick(iso)}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="cal-foot">
              {footer ?? <span />}
              <button type="button" className="link-btn" onClick={() => pick(today)}>
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
