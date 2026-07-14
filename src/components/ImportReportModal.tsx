'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from './Select';
import { Loading, Spinner } from './Spinner';
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
  note: string;
  hours: string;
  /** Resolved Teamwork task title, previewed in place of the raw link once
   * known. undefined = not looked up yet; null = looked up, not found. */
  previewTitle?: string | null;
}

function makeRow(): RowState {
  return {
    key: crypto.randomUUID(),
    type: 'teamwork',
    link: '',
    otherTask: '',
    note: '',
    hours: '',
    previewTitle: undefined,
  };
}

/** A row counts as "touched" once any field has content — used to tell an
 * intentionally-filled-in row from a still-blank spare one. */
function isRowTouched(r: RowState): boolean {
  return !!r.link.trim() || !!r.otherTask.trim() || !!r.note.trim() || !!r.hours.trim();
}

/** A Teamwork link must be on the configured domain and look like an
 * actual task link (".../app/tasks/<id>"), not just any URL. */
function isValidTeamworkLink(link: string, taskUrlPrefix?: string): boolean {
  if (!taskUrlPrefix || !link.startsWith(taskUrlPrefix)) return false;
  return /\/app\/tasks\/\d+/.test(link);
}

function isRowValid(r: RowState, taskUrlPrefix?: string): boolean {
  const hours = parseFloat(r.hours);
  if (!r.hours.trim() || Number.isNaN(hours) || hours <= 0) return false;
  if (r.type === 'teamwork') return isValidTeamworkLink(r.link.trim(), taskUrlPrefix);
  return !!r.otherTask.trim();
}

/** Serializes a valid row into the "<link or task>: <hours>" line the
 * backend's report-text parser already understands. A note (if any) rides
 * along in the task-name text ("<link/task> - <note>") — there's no
 * dedicated note column server-side, so it round-trips through taskName. */
function rowToLine(r: RowState): string {
  const base = r.type === 'teamwork' ? r.link.trim() : r.otherTask.trim();
  const label = r.note.trim() ? `${base} - ${r.note.trim()}` : base;
  return `${label}: ${r.hours.trim()}`;
}

/** Recovers {otherTask, note} from a saved "other" entry's taskName. */
function splitOtherTaskName(
  taskName: string,
  allowed: string[],
): { otherTask: string; note: string } {
  for (const opt of allowed) {
    if (taskName === opt) return { otherTask: opt, note: '' };
    if (taskName.startsWith(`${opt} - `)) {
      return { otherTask: opt, note: taskName.slice(opt.length + 3) };
    }
  }
  return { otherTask: taskName, note: '' };
}

/** Recovers the note (if any) from a saved Teamwork entry's taskName. */
function splitTeamworkNote(taskName: string): string {
  return (taskName ?? '').trim().replace(/^[-–]\s*/, '');
}

const HOUR_THRESHOLD: Partial<Record<MemberRole, number>> = {
  full_time: 7,
  part_time: 3.5,
};

const LEAVE_HOUR_OPTIONS = [2, 4, 8] as const;

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
  const [leaveHours, setLeaveHours] = useState<number | null>(null);
  const [hadExistingLeave, setHadExistingLeave] = useState(false);
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
  // overwrites it rather than silently clobbering unseen data. Waits on
  // `config` so "other task" rows can be split back into task + note.
  useEffect(() => {
    if (!memberId || !date) {
      setRows([makeRow()]);
      setLeaveHours(null);
      setHadExistingLeave(false);
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
        const isLeave = already?.status === 'holiday';
        setHadExistingLeave(isLeave);
        setLeaveHours(isLeave ? already?.hours ?? 8 : null);

        const allowed = config?.noUrlAllowedTasks ?? [];
        const report = reports[0];
        if (report && report.entries.length > 0) {
          setRows(
            report.entries.map((e) => {
              if (e.href) {
                return {
                  key: crypto.randomUUID(),
                  type: 'teamwork' as const,
                  link: e.href,
                  otherTask: '',
                  note: splitTeamworkNote(e.taskName),
                  hours: String(e.hours),
                  previewTitle: e.resolvedTitle ?? null,
                };
              }
              const { otherTask, note } = splitOtherTaskName(e.taskName, allowed);
              return {
                key: crypto.randomUUID(),
                type: 'other' as const,
                link: '',
                otherTask,
                note,
                hours: String(e.hours),
              };
            }),
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
  }, [memberId, date, config]);

  const updateRow = (key: string, patch: Partial<RowState>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const resolveLinkPreview = async (key: string, url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      updateRow(key, { previewTitle: undefined });
      return;
    }
    try {
      const { title } = await api.resolveTaskTitle(trimmed);
      updateRow(key, { previewTitle: title });
    } catch {
      updateRow(key, { previewTitle: null });
    }
  };

  const touchedRows = rows.filter(isRowTouched);
  const incompleteRows = touchedRows.filter((r) => !isRowValid(r, config?.taskUrlPrefix));
  const validRows = touchedRows.filter((r) => isRowValid(r, config?.taskUrlPrefix));
  const totalHours = validRows.reduce((s, r) => s + parseFloat(r.hours), 0);

  const selectedMember = members.find((m) => m.id === memberId);
  const baseThreshold = selectedMember ? HOUR_THRESHOLD[selectedMember.role] : undefined;
  // Leave hours count toward the day, so a partial leave lowers how much
  // work is still expected (e.g. full-time 7h base - 4h leave = 3h).
  const threshold =
    baseThreshold != null ? Math.max(0, baseThreshold - (leaveHours ?? 0)) : undefined;
  const underThreshold = threshold != null && totalHours < threshold;
  const fullDayOff = leaveHours === 8;

  const canSubmit = useMemo(() => {
    if (!memberId || saving) return false;
    if (fullDayOff) return true;
    if (incompleteRows.length > 0) return false;
    return validRows.length > 0 || leaveHours != null;
  }, [memberId, saving, fullDayOff, incompleteRows.length, validRows.length, leaveHours]);

  const submit = async () => {
    setError('');
    setOk('');
    if (!memberId) {
      setError('Select a member.');
      return;
    }
    if (!fullDayOff) {
      if (incompleteRows.length > 0) {
        setError('Complete or remove the highlighted rows first.');
        return;
      }
      if (validRows.length === 0 && leaveHours == null) {
        setError('Add at least one task.');
        return;
      }
    }
    setSaving(true);
    try {
      if (leaveHours != null) {
        await api.setAttendance(memberId, date, 'holiday', leaveHours);
      } else if (hadExistingLeave) {
        await api.setAttendance(memberId, date, 'none');
      }
      const who = members.find((m) => m.id === memberId)?.name ?? 'Member';
      if (fullDayOff) {
        setOk(`Marked ${who} on holiday for ${formatDate(date)}.`);
      } else if (validRows.length > 0) {
        const text = validRows.map(rowToLine).join('\n');
        const report = await api.importReport({ memberId, date, text });
        const total = report.entries.reduce((s, e) => s + e.hours, 0);
        setOk(
          `Saved ${report.entries.length} tasks (${total}h)` +
            (leaveHours ? ` + ${leaveHours}h leave` : '') +
            ` for ${report.member.name} on ${formatDate(report.date)}.`,
        );
      } else {
        setOk(`Saved ${leaveHours}h leave for ${who} on ${formatDate(date)}.`);
      }
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
          <Loading />
        ) : (
          <div
            style={{
              opacity: memberId ? 1 : 0.45,
              pointerEvents: memberId ? 'auto' : 'none',
              transition: 'opacity 150ms',
            }}
          >
            <div className="field-row" style={{ alignItems: 'center', marginBottom: 14 }}>
              <label className="checkbox-row" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={leaveHours != null}
                  onChange={(e) => setLeaveHours(e.target.checked ? 8 : null)}
                />
                <span>Leave/Holiday</span>
              </label>
              <div
                style={{ width: 160, visibility: leaveHours != null ? 'visible' : 'hidden' }}
              >
                <Select
                  value={String(leaveHours ?? 8)}
                  onChange={(v) => setLeaveHours(Number(v))}
                  options={LEAVE_HOUR_OPTIONS.map((h) => ({
                    value: String(h),
                    label: `${h}h${h === 8 ? ' (full day)' : ''}`,
                  }))}
                />
              </div>
            </div>

            {
              <div
                style={{
                  opacity: fullDayOff ? 0.45 : 1,
                  pointerEvents: fullDayOff ? 'none' : 'auto',
                  transition: 'opacity 150ms',
                }}
              >
                <div className="table-frame">
                  <table className="report-table">
                    <colgroup>
                      <col style={{ width: 140 }} />
                      <col />
                      <col style={{ width: 200 }} />
                      <col style={{ width: 96 }} />
                      <col style={{ width: 44 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Link / Task</th>
                        <th>Note</th>
                        <th>Hours</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const invalid =
                          isRowTouched(r) && !isRowValid(r, config?.taskUrlPrefix);
                        return (
                          <tr key={r.key} className={invalid ? 'invalid-row' : ''}>
                            <td>
                              <Select
                                value={r.type}
                                onChange={(v) =>
                                  updateRow(r.key, {
                                    type: v as EntryType,
                                    link: '',
                                    otherTask: '',
                                  })
                                }
                                options={[
                                  { value: 'teamwork', label: 'Teamwork' },
                                  { value: 'other', label: 'Other task' },
                                ]}
                              />
                            </td>
                            <td>
                              {r.type === 'teamwork' ? (
                                r.previewTitle ? (
                                  <div className="link-preview">
                                    <span className="link-preview-title">
                                      {r.previewTitle}
                                    </span>
                                    <button
                                      type="button"
                                      className="row-remove-btn"
                                      onClick={() =>
                                        updateRow(r.key, { link: '', previewTitle: undefined })
                                      }
                                      title="Clear"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <input
                                    value={r.link}
                                    onChange={(e) =>
                                      updateRow(r.key, {
                                        link: e.target.value,
                                        previewTitle: undefined,
                                      })
                                    }
                                    onBlur={(e) => resolveLinkPreview(r.key, e.target.value)}
                                    placeholder={
                                      config
                                        ? `${config.taskUrlPrefix}/app/tasks/101`
                                        : 'Teamwork task link'
                                    }
                                    style={{ width: '100%' }}
                                  />
                                )
                              ) : (
                                <Select
                                  value={r.otherTask}
                                  onChange={(v) => updateRow(r.key, { otherTask: v })}
                                  placeholder="Select task"
                                  options={(config?.noUrlAllowedTasks ?? [])
                                    .concat(
                                      r.otherTask &&
                                        !config?.noUrlAllowedTasks.includes(r.otherTask)
                                        ? [r.otherTask]
                                        : [],
                                    )
                                    .map((t) => ({ value: t, label: t }))}
                                />
                              )}
                            </td>
                            <td>
                              <input
                                value={r.note}
                                onChange={(e) => updateRow(r.key, { note: e.target.value })}
                                placeholder="Optional note"
                                style={{ width: '100%' }}
                              />
                            </td>
                            <td className="num">
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={r.hours}
                                onChange={(e) => updateRow(r.key, { hours: e.target.value })}
                                style={{ width: '100%', textAlign: 'right' }}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                className="btn ghost row-remove-btn"
                                onClick={() => removeRow(r.key)}
                                disabled={rows.length === 1}
                                title="Remove row"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  className="btn ghost sm"
                  onClick={() => setRows((rs) => [...rs, makeRow()])}
                  style={{ marginTop: 10 }}
                >
                  + Add task
                </button>

                <div
                  className="field-row"
                  style={{ marginTop: 14, alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <strong>Total: {totalHours}h</strong>
                  {underThreshold && selectedMember && (
                    <span className="badge pending">
                      ⚠ Below {threshold}h for{' '}
                      {selectedMember.role === 'full_time' ? 'full-time' : 'part-time'}
                    </span>
                  )}
                </div>
              </div>
            }
          </div>
        )}

        <button
          className="btn block"
          onClick={submit}
          disabled={!canSubmit}
          style={{ marginTop: 16 }}
        >
          {saving ? (
            <span className="btn-spin">
              <Spinner sm /> Saving…
            </span>
          ) : fullDayOff ? (
            'Mark holiday'
          ) : (
            'Save report'
          )}
        </button>
      </div>
    </div>
  );
}
