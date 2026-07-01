'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, taskLabel } from '@/lib/format';
import type { DailyReport } from '@/lib/types';
import { Loading } from './Spinner';

const round = (n: number) => Math.round(n * 10) / 10;
const sum = (r: DailyReport) => r.entries.reduce((s, e) => s + e.hours, 0);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - days * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Popup listing a member's daily records (last 60 days). */
export function MemberDetail({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
}) {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    api
      .listReports({ memberId, from: isoDaysAgo(60), to: isoDaysAgo(0) })
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [memberId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-lg-head">
          <h3>{memberName} — recent records</h3>
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <div className="empty">No records in the last 60 days.</div>
        ) : (
          <div className="record-list">
            {reports.map((r) => (
              <div className="record-day" key={r.id}>
                <div className="record-day-head">
                  <span>{formatDate(r.date)}</span>
                  <span className="hours-pill">{round(sum(r))}h</span>
                </div>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
