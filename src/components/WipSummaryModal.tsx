'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DateField } from './DateField';
import { Loading } from './Spinner';
import { formatDate, taskLabel } from '@/lib/format';
import type { DailyReport, Member } from '@/lib/types';

function today(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * The working day before `iso` - weekends are skipped, so the "yesterday"
 * of a Monday is the Friday before it.
 */
function prevWorkingDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-07-24' -> 'Jul 24', the heading style the manager's thread uses. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Renders the two days into the plain-text block the leader pastes into the
 * manager's chat:
 *
 *   WIP Summary – Jul 24
 *
 *   Tom:
 *   Yesterday: (7.75h)
 *   - Force Update (2h) => Done
 *   Today:
 *   - Mob app UI improvement
 *
 * Yesterday's status comes from each task's in-progress tick in the Add
 * report modal - unticked means it was finished, so "Done".
 */
function buildSummary(
  date: string,
  prev: string,
  reports: DailyReport[],
  members: Member[],
): string {
  const days = new Map<string, { yesterday?: DailyReport; today?: DailyReport }>();
  for (const r of reports) {
    const slot = days.get(r.member.id) ?? {};
    if (r.date === prev) slot.yesterday = r;
    else if (r.date === date) slot.today = r;
    days.set(r.member.id, slot);
  }

  // Members list order first (stable), then anyone who reported but is no
  // longer in the list.
  const ordered = [
    ...members,
    ...reports.map((r) => r.member).filter((m) => !members.some((x) => x.id === m.id)),
  ];
  const seen = new Set<string>();

  const blocks: string[] = [];
  for (const m of ordered) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const slot = days.get(m.id);
    if (!slot?.yesterday && !slot?.today) continue;

    const lines = [`${m.name}:`];

    if (slot.yesterday) {
      const total = round2(slot.yesterday.entries.reduce((s, e) => s + e.hours, 0));
      lines.push(`Yesterday:${total ? ` (${total}h)` : ''}`);
      for (const e of slot.yesterday.entries) {
        const hours = e.hours ? ` (${round2(e.hours)}h)` : '';
        const status = e.inProgress ? 'In progress' : 'Done';
        lines.push(`- ${taskLabel(e)}${hours} => ${status}`);
      }
    }
    if (slot.today) {
      lines.push('Today:');
      for (const e of slot.today.entries) lines.push(`- ${taskLabel(e)}`);
    }
    blocks.push(lines.join('\n'));
  }

  return `WIP Summary – ${shortDate(date)}\n\n${blocks.join('\n\n')}`;
}

/**
 * Popup: builds the daily WIP summary (previous working day's work + hours,
 * today's plan) as text to copy into the manager's chat.
 */
export function WipSummaryModal({
  members,
  onClose,
}: {
  members: Member[];
  onClose: () => void;
}) {
  const [date, setDate] = useState(today());
  const prev = useMemo(() => prevWorkingDay(date), [date]);
  const [text, setText] = useState('');
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .listReports({ from: prev, to: date })
      .then((reports) => {
        if (cancelled) return;
        const relevant = reports.filter((r) => r.date === prev || r.date === date);
        setText(buildSummary(date, prev, relevant, members));
        setCount(relevant.length);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, prev, members]);

  useEffect(() => load(), [load]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not reach the clipboard - select the text and copy it manually.');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-xl"
        style={{ maxWidth: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-lg-head">
          <h3 style={{ margin: 0 }}>WIP summary</h3>
          <div className="filter-inline" style={{ margin: 0 }}>
            <label>Date</label>
            <DateField value={date} onChange={setDate} />
          </div>
        </div>

        <p style={{ marginBottom: 14 }}>
          Yesterday = {formatDate(prev)} (previous working day) · Today = {formatDate(date)}
          {!loading && ` · ${count} report(s)`}
        </p>

        {error && <div className="alert error">{error}</div>}

        {loading ? (
          <Loading />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            style={{ minHeight: 380 }}
          />
        )}

        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={copy} disabled={loading || !text.trim()}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
