'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { Avatar } from './Avatar';
import { DateField } from './DateField';
import { formatDate } from '@/lib/format';
import type { Member, MemberRole, ReportConfig } from '@/lib/types';

function today(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

type EntryType = 'teamwork' | 'other';

interface RowState {
  key: string;
  type: EntryType;
  link: string;
  otherTask: string;
  hours: string;
}

function makeRow(): RowState {
  return { key: crypto.randomUUID(), type: 'teamwork', link: '', otherTask: '', hours: '' };
}

/** A row counts as "touched" once any field has content — used to tell an
 * intentionally-filled-in row from a still-blank spare one. */
function isRowTouched(r: RowState): boolean {
  return !!r.link.trim() || !!r.otherTask.trim() || !!r.hours.trim();
}

function isRowValid(r: RowState): boolean {
  const hours = parseFloat(r.hours);
  if (!r.hours.trim() || Number.isNaN(hours) || hours <= 0) return false;
  return r.type === 'teamwork' ? !!r.link.trim() : !!r.otherTask.trim();
}

/** Serializes a valid row into the "<link or task>: <hours>" line the
 * backend's report-text parser already understands. */
function rowToLine(r: RowState): string {
  const label = r.type === 'teamwork' ? r.link.trim() : r.otherTask.trim();
  return `${label}: ${r.hours.trim()}`;
}

const HOUR_THRESHOLD: Partial<Record<MemberRole, number>> = {
  full_time: 7,
  part_time: 3.5,
};

/** Popup: build a structured task list for a member/day, prefilled with
 * whatever is already saved so re-saving intentionally overwrites it. */
export function ImportReportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [config, setConfig] = useState<ReportConfig | null>(null);
  const [memberId, setMemberId] = useState('');
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<RowState[]>([makeRow()]);
  const [holidayMode, setHolidayMode] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listMembers().then(setMembers).catch((e) => setError(e.message));
    api.reportConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load whatever is already saved for this member/day so save intentionally
  // overwrites it rather than silently clobbering unseen data.
  useEffect(() => {
    if (!memberId || !date) {
      setRows([makeRow()]);
      setHolidayMode(false);
      return;
    }
    let cancelled = false;
    setLoadingExisting(true);
    Promise.all([
      api.listReports({ date, memberId }),
      api.listAttendance(date),
    ])
      .then(([reports, attendance]) => {
        if (cancelled) return;
        const already = attendance.find((a) => a.member.id === memberId);
        setHolidayMode(already?.status === 'holiday');
        const report = reports[0];
        if (report && report.entries.length > 0) {
          setRows(
            report.entries.map((e) => ({
              key: crypto.randomUUID(),
              type: e.href ? 'teamwork' : 'other',
              link: e.href ?? '',
              otherTask: e.href ? '' : e.taskName,
              hours: String(e.hours),
            })),
          );
        } else {
          setRows([makeRow()]);
        }
      })
      .catch(() => {
        if (!cancelled) setRows([makeRow()]);
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, date]);

  const updateRow = (key: string, patch: Partial<RowState>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const touchedRows = rows.filter(isRowTouched);
  const incompleteRows = touchedRows.filter((r) => !isRowValid(r));
  const validRows = touchedRows.filter(isRowValid);
  const totalHours = validRows.reduce((s, r) => s + parseFloat(r.hours), 0);

  const selectedMember = members.find((m) => m.id === memberId);
  const threshold = selectedMember ? HOUR_THRESHOLD[selectedMember.role] : undefined;
  const underThreshold = threshold != null && totalHours < threshold;

  const canSubmit = useMemo(
    () =>
      !!memberId &&
      !saving &&
      (holidayMode || (validRows.length > 0 && incompleteRows.length === 0)),
    [memberId, saving, holidayMode, validRows.length, incompleteRows.length],
  );

  const submit = async () => {
    setError('');
    setOk('');
    if (!memberId) {
      setError('Select a member.');
      return;
    }
    if (holidayMode) {
      setSaving(true);
      try {
        await api.setAttendance(memberId, date, 'holiday');
        const who = members.find((m) => m.id === memberId)?.name ?? 'Member';
        setOk(`Marked ${who} on holiday for ${formatDate(date)}.`);
        onImported();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
      return;
    }
    if (incompleteRows.length > 0) {
      setError('Complete or remove the highlighted rows first.');
      return;
    }
    if (validRows.length === 0) {
      setError('Add at least one task.');
      return;
    }
    const text = validRows.map(rowToLine).join('\n');
    setSaving(true);
    try {
      const report = await api.importReport({ memberId, date, text });
      const total = report.entries.reduce((s, e) => s + e.hours, 0);
      setOk(
        `Saved ${report.entries.length} tasks (${total}h) for ${report.member.name} on ${formatDate(report.date)}.`,
      );
      onImported();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-lg-head" style={{ justifyContent: 'center' }}>
          <h3 style={{ margin: 0 }}>Add report</h3>
        </div>

        {error && <div className="alert error">{error}</div>}
        {ok && <div className="alert ok">{ok}</div>}

        <div className="field-row">
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label>Member</label>
            <Select
              value={memberId}
              onChange={setMemberId}
              placeholder="Select member"
              options={members.map((m) => ({
                value: m.id,
                label: `${m.name} (${m.email})`,
                icon: <Avatar name={m.name} src={m.avatarUrl} size={20} />,
              }))}
            />
          </div>
          <div className="field" style={{ flexShrink: 0 }}>
            <label>Date</label>
            <div>
              <DateField value={date} onChange={setDate} />
            </div>
          </div>
        </div>

        {loadingExisting ? (
          <div className="empty">
            <Spinner sm /> Loading current data…
          </div>
        ) : (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={holidayMode}
                onChange={(e) => setHolidayMode(e.target.checked)}
              />
              <span>Holiday (no work this day)</span>
            </label>

            {!holidayMode && (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Link / Task</th>
                      <th className="num">Hours</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const invalid = isRowTouched(r) && !isRowValid(r);
                      return (
                        <tr key={r.key} className={invalid ? 'invalid-row' : ''}>
                          <td>
                            <select
                              value={r.type}
                              onChange={(e) =>
                                updateRow(r.key, {
                                  type: e.target.value as EntryType,
                                  link: '',
                                  otherTask: '',
                                })
                              }
                            >
                              <option value="teamwork">Teamwork</option>
                              <option value="other">Other task</option>
                            </select>
                          </td>
                          <td>
                            {r.type === 'teamwork' ? (
                              <input
                                value={r.link}
                                onChange={(e) => updateRow(r.key, { link: e.target.value })}
                                placeholder={
                                  config
                                    ? `${config.taskUrlPrefix}/app/tasks/101`
                                    : 'Teamwork task link'
                                }
                                style={{ width: '100%' }}
                              />
                            ) : (
                              <select
                                value={r.otherTask}
                                onChange={(e) =>
                                  updateRow(r.key, { otherTask: e.target.value })
                                }
                                style={{ width: '100%' }}
                              >
                                <option value="">Select task</option>
                                {config?.noUrlAllowedTasks.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                                {r.otherTask &&
                                  !config?.noUrlAllowedTasks.includes(r.otherTask) && (
                                    <option value={r.otherTask}>{r.otherTask}</option>
                                  )}
                              </select>
                            )}
                          </td>
                          <td className="num">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={r.hours}
                              onChange={(e) => updateRow(r.key, { hours: e.target.value })}
                              style={{ width: 72 }}
                            />
                          </td>
                          <td>
                            <button
                              className="btn ghost sm"
                              onClick={() => removeRow(r.key)}
                              disabled={rows.length === 1}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button
                  className="btn ghost sm"
                  onClick={() => setRows((rs) => [...rs, makeRow()])}
                  style={{ marginTop: 8 }}
                >
                  + Add task
                </button>

                <div
                  className="field-row"
                  style={{ marginTop: 12, alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <strong>Total: {totalHours}h</strong>
                  {underThreshold && selectedMember && (
                    <span className="badge pending">
                      ⚠ Below {threshold}h for{' '}
                      {selectedMember.role === 'full_time' ? 'full-time' : 'part-time'}
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}

        <button
          className="btn block"
          onClick={submit}
          disabled={!canSubmit}
          style={{ marginTop: 12 }}
        >
          {saving ? (
            <span className="btn-spin">
              <Spinner sm /> Saving…
            </span>
          ) : holidayMode ? (
            'Mark holiday'
          ) : (
            'Save report'
          )}
        </button>
      </div>
    </div>
  );
}
