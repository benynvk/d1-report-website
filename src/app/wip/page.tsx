'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { DateField } from '@/components/DateField';
import { Loading, Spinner } from '@/components/Spinner';
import { useConfirm } from '@/components/Confirm';
import { BellIcon, ChevronLeft, ChevronRight } from '@/components/icons';
import { addDays, monthLabel, todayVN } from '@/lib/format';
import type { WipDay, WipRow } from '@/lib/types';

/** A long URL as "host › last-segment", so a cell isn't one wrapped link. */
function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const host = u.hostname.replace(/^www\./, '');
    return last ? `${host} › ${decodeURIComponent(last).slice(0, 48)}` : host;
  } catch {
    return raw;
  }
}

/** Renders a WIP cell: one line per entry, URLs as short links. */
function WipCell({ text }: { text: string }) {
  if (!text.trim()) return <span className="not-filled">Not filled</span>;
  return (
    <div className="wip-lines">
      {text
        .split('\n')
        .filter((l) => l.trim())
        .map((line, i) => (
          <div key={i}>
            {line.split(/(https?:\/\/\S+)/g).map((part, j) =>
              /^https?:\/\//.test(part) ? (
                <a key={j} href={part} target="_blank" rel="noreferrer" title={part}>
                  {shortUrl(part)}
                </a>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </div>
        ))}
    </div>
  );
}

export default function WipPage() {
  const confirm = useConfirm();
  const [date, setDate] = useState(todayVN());
  const [day, setDay] = useState<WipDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .wipDay(date)
      .then(setDay)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [date]);

  const sendReminder = async () => {
    const yes = await confirm({
      title: 'Send a WIP reminder now?',
      message:
        "Posts to the team's Google Chat space, @mentioning whoever hasn't filled this morning's WIP or the previous day's evening WIP.",
      confirmLabel: 'Send reminder',
    });
    if (!yes) return;
    setNotice('');
    setError('');
    setSending(true);
    try {
      const r = await api.checkWipReminder();
      const parts = [
        r.missingPrevEvening.length && `previous evening: ${r.missingPrevEvening.join(', ')}`,
        r.missingToday.length && `this morning: ${r.missingToday.join(', ')}`,
      ].filter(Boolean);
      setNotice(parts.length ? `Reminder sent - ${parts.join(' · ')}` : 'Everyone has filled their WIP - nothing sent.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const rows: WipRow[] = day?.rows.filter((r) => r.memberId) ?? [];
  const filled = (col: 'morning' | 'evening') => rows.filter((r) => r[col].trim()).length;
  const isToday = date === todayVN();

  return (
    <>
      <div className="page-head-row">
        <div>
          <h1 className="page-title">WIP</h1>
          <p className="page-sub">Morning and evening entries from the WIP spreadsheet.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={sendReminder} disabled={sending || !isToday} title={isToday ? '' : 'Only for today'}>
            {sending ? <Spinner sm /> : <BellIcon />} Send reminder
          </button>
        </div>
      </div>

      {notice && <div className="alert ok">{notice}</div>}

      <div className="panel">
        <div className="panel-head filter-head">
          <div className="date-nav">
            <button className="icon-only" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
              <ChevronLeft />
            </button>
            <DateField value={date} onChange={setDate} />
            <button className="icon-only" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
              <ChevronRight />
            </button>
            {!isToday && (
              <button className="btn ghost sm" onClick={() => setDate(todayVN())}>
                Today
              </button>
            )}
          </div>
          <span className="date-nav-label">
            {new Date(`${date}T00:00:00Z`).toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' })}
            {isToday && <span className="badge" style={{ marginLeft: 8 }}>Today</span>}
          </span>
          {!loading && rows.length > 0 && (
            <span className="filter-head-count">
              Morning <b>{filled('morning')}/{rows.length}</b> · Evening <b>{filled('evening')}/{rows.length}</b>
            </span>
          )}
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <div className="empty">
            {error}
            {/not connected/i.test(error) && (
              <div style={{ marginTop: 8 }}>
                <Link href="/settings">Connect Google Sheets in Settings</Link>
              </div>
            )}
          </div>
        ) : !day?.configured ? (
          <div className="empty">
            No WIP sheet for {monthLabel(date.slice(0, 7))}.{' '}
            <Link href="/settings">Add it in Settings</Link>
          </div>
        ) : day.rows.length === 0 ? (
          <div className="empty">
            No tab for this day - weekend or holiday?
            {day.availableTabs && day.availableTabs.length > 0 && (
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Tabs in this sheet: {day.availableTabs.join(', ')}
              </div>
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            Nobody in this tab is matched to a member. <Link href="/members">Set WIP names in Members</Link>
          </div>
        ) : (
          <table className="wip-table">
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '41%' }} />
              <col style={{ width: '41%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Morning</th>
                <th>Evening</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.memberId}>
                  <td>
                    <div className="member-cell">
                      <Avatar name={r.memberName!} src={r.avatarUrl} size={28} />
                      <div className="member-cell-text">
                        <span className="member-cell-name">{r.memberName}</span>
                        {r.team && <span className="member-cell-sub">{r.team}</span>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <WipCell text={r.morning} />
                  </td>
                  <td>
                    <WipCell text={r.evening} />
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
