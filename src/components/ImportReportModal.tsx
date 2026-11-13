'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from './Select';
import { Loading, Spinner } from './Spinner';
import { Avatar } from './Avatar';
import { ReportDateField } from './ReportDateField';
import { CloseIcon } from './icons';
import { addDays, formatDate, formatDayLong, formatHours, todayVN } from '@/lib/format';
import type { DailyReport, Member, MemberRole, ReportConfig, WipSyncResult } from '@/lib/types';

/**
 * One task line. `text` is either a Teamwork task link or the name of a
 * no-link task type (Weekly meeting, Review code…) — which one is inferred
 * from the text, so there's no separate "type" to pick.
 */
interface RowState {
  key: string;
  text: string;
  note: string;
  hours: string;
  /** Not finished that day — the WIP summary says "In progress", not "Done". */
  inProgress: boolean;
  /** Teamwork title for a link: undefined = not looked up, null = not found. */
  previewTitle?: string | null;
  previewLoading?: boolean;
}

type BoardTask = { id: number; title: string; url: string; stage: string | null; priority: string | null };

/** What the Reports page shows after the form closes. */
export interface ImportResult {
  message: string;
  warning?: string;
}

const makeRow = (patch: Partial<RowState> = {}): RowState => ({
  key: crypto.randomUUID(),
  text: '',
  note: '',
  hours: '',
  inProgress: false,
  ...patch,
});

const isLink = (text: string) => /^https?:\/\//i.test(text.trim());
const isBlank = (r: RowState) => !r.text.trim() && !r.note.trim() && !r.hours.trim();

/**
 * The canonical ".../app/tasks/<id>" URL for a Teamwork task link on the
 * configured domain (also accepts the older "/#/tasks/<id>" form), or null.
 */
function canonicalTeamworkLink(link: string, prefix?: string): string | null {
  if (!prefix || !link.startsWith(prefix)) return null;
  const id = /^\/?(?:#\/|app\/)?tasks\/(\d+)(?:[/?#]|$)/.exec(link.slice(prefix.length).replace(/^\//, ''))?.[1];
  return id ? `${prefix.replace(/\/$/, '')}/app/tasks/${id}` : null;
}

/** The configured task type a typed name refers to (case-insensitive). */
const taskTypeOf = (text: string, allowed: string[]) =>
  allowed.find((t) => t.toLowerCase() === text.trim().toLowerCase()) ?? null;

/** Why a row can't be saved, or null when it's fine (or still blank). */
function rowError(r: RowState, config: ReportConfig | null): string | null {
  if (isBlank(r)) return null;
  if (r.hours.trim()) {
    const h = parseFloat(r.hours);
    if (Number.isNaN(h) || h <= 0) return 'Hours must be a positive number.';
  }
  const text = r.text.trim();
  if (!text) return 'Paste a Teamwork task link or pick a task type.';
  if (isLink(text)) {
    return canonicalTeamworkLink(text, config?.taskUrlPrefix) ? null : 'Not a Teamwork task link (…/app/tasks/123).';
  }
  if (!config) return null;
  return taskTypeOf(text, config.noUrlAllowedTasks)
    ? null
    : `"${text}" needs a Teamwork link - or pick a task type: ${config.noUrlAllowedTasks.join(', ')}.`;
}

/** The row as the API stores it ("<type> - <note>" for no-link tasks). */
function rowToEntry(r: RowState, config: ReportConfig | null) {
  const hours = parseFloat(r.hours) || 0;
  const note = r.note.trim();
  const text = r.text.trim();
  if (isLink(text)) {
    return { href: canonicalTeamworkLink(text, config?.taskUrlPrefix) ?? text, taskName: note, hours, inProgress: r.inProgress };
  }
  const type = taskTypeOf(text, config?.noUrlAllowedTasks ?? []) ?? text;
  return { taskName: note ? `${type} - ${note}` : type, hours, inProgress: r.inProgress };
}

/** The human-readable record kept as the report's raw text. */
const entryLine = (e: ReturnType<typeof rowToEntry>) =>
  `${'href' in e ? e.href : ''}${'href' in e && e.taskName ? ' - ' : ''}${e.taskName}: ${e.hours || 0}`;

/** Saved entries back into rows (no-link tasks split into type + note). */
function rowsFromReport(report: DailyReport, allowed: string[], keepHours: boolean): RowState[] {
  return report.entries.map((e) => {
    const hours = keepHours && e.hours ? String(e.hours) : '';
    if (e.href) {
      return makeRow({
        text: e.href,
        note: (e.taskName ?? '').trim().replace(/^[-–]\s*/, ''),
        hours,
        inProgress: keepHours ? e.inProgress : false,
        previewTitle: e.resolvedTitle ?? null,
      });
    }
    const type = allowed.find((t) => e.taskName === t || e.taskName.startsWith(`${t} - `));
    return makeRow({
      text: type ?? e.taskName,
      note: type && e.taskName !== type ? e.taskName.slice(type.length + 3) : '',
      hours,
      inProgress: keepHours ? e.inProgress : false,
    });
  });
}

/** The WIP-sheet part of the success message (a failure becomes a warning). */
function wipNote(sync?: WipSyncResult): string {
  if (!sync || sync.error) return '';
  if (sync.updated) return ` WIP sheet updated (${sync.column === 'evening' ? 'evening' : 'morning'}).`;
  return '';
}

const HOUR_THRESHOLD: Partial<Record<MemberRole, number>> = { full_time: 7, part_time: 3.5 };
const LEAVE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Working' },
  { value: 2, label: 'Leave 2h' },
  { value: 4, label: 'Leave 4h' },
  { value: 8, label: 'Full day off' },
];
const LAST_MEMBER_KEY = 'd1-report:lastMemberId';
const round = (h: number) => Math.round(h * 100) / 100;

function lastMemberId(): string {
  try {
    return localStorage.getItem(LAST_MEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Add / edit a member's report for a day. Prefilled with whatever is already
 * saved for that member and day, so saving replaces it knowingly.
 */
export function ImportReportModal({
  onClose,
  onImported,
  initialMemberId,
  initialDate,
}: {
  onClose: () => void;
  /** Called after a save, just before the form closes. */
  onImported: (result: ImportResult) => void;
  initialMemberId?: string;
  initialDate?: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [config, setConfig] = useState<ReportConfig | null>(null);
  const [memberId, setMemberId] = useState(() => initialMemberId || lastMemberId());
  const [date, setDate] = useState(initialDate || todayVN());
  const [rows, setRows] = useState<RowState[]>([makeRow()]);
  const [existing, setExisting] = useState(false);
  const [leaveHours, setLeaveHours] = useState<number | null>(null);
  const [hadLeave, setHadLeave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [warn, setWarn] = useState('');
  const [saving, setSaving] = useState(false);
  const [board, setBoard] = useState<BoardTask[] | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listMembers().then(setMembers).catch((e) => setError(e.message));
    api.reportConfig().then(setConfig).catch(() => {});
  }, []);

  const selectMember = (id: string) => {
    setMemberId(id);
    setBoard(null);
    setBoardOpen(false);
    try {
      if (id) localStorage.setItem(LAST_MEMBER_KEY, id);
    } catch {
      /* private mode */
    }
  };

  // Load what's already saved for this member/day (waits for config so
  // no-link tasks split back into type + note).
  useEffect(() => {
    if (!memberId || !date) {
      setRows([makeRow()]);
      setExisting(false);
      setLeaveHours(null);
      setHadLeave(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([api.listReports({ date, memberId }), api.listAttendance({ date })])
      .then(([reports, attendance]) => {
        if (cancelled) return;
        const leave = attendance.find((a) => a.member.id === memberId && a.status === 'holiday');
        setHadLeave(!!leave);
        setLeaveHours(leave ? (leave.hours ?? 8) : null);
        const report = reports[0];
        setExisting(!!report?.entries.length);
        setRows(report?.entries.length ? [...rowsFromReport(report, config?.noUrlAllowedTasks ?? [], true), makeRow()] : [makeRow()]);
      })
      .catch(() => !cancelled && setRows([makeRow()]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [memberId, date, config]);

  const updateRow = (key: string, patch: Partial<RowState>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => {
      const next = rs.filter((r) => r.key !== key);
      return next.length ? next : [makeRow()];
    });

  /** Puts new rows in place of trailing blank ones, keeping one spare at the end. */
  const addRows = (added: RowState[]) =>
    setRows((rs) => {
      let end = rs.length;
      while (end > 0 && isBlank(rs[end - 1])) end--;
      return [...rs.slice(0, end), ...added, makeRow()];
    });

  const resolvePreview = async (key: string, text: string) => {
    if (!isLink(text)) return;
    updateRow(key, { previewLoading: true });
    try {
      const { title } = await api.resolveTaskTitle(text.trim());
      updateRow(key, { previewTitle: title, previewLoading: false });
    } catch {
      updateRow(key, { previewTitle: null, previewLoading: false });
    }
  };

  /** Pasting several lines/links creates one row per line. */
  const onPasteTask = (r: RowState, e: React.ClipboardEvent<HTMLInputElement>) => {
    const lines = e.clipboardData
      .getData('text')
      .split(/\r?\n|\s+(?=https?:\/\/)/)
      .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const created = lines.map((text) => makeRow({ text }));
    setRows((rs) => {
      const i = rs.findIndex((x) => x.key === r.key);
      const head = rs.slice(0, i);
      const tail = rs.slice(i + 1).filter((x) => !isBlank(x));
      const first = { ...created[0], key: r.key, note: r.note, hours: r.hours, inProgress: r.inProgress };
      return [...head, first, ...created.slice(1), ...tail, makeRow()];
    });
    [{ ...created[0], key: r.key }, ...created.slice(1)].forEach((x) => resolvePreview(x.key, x.text));
  };

  const focusRow = (key: string) =>
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`[data-row="${key}"]`)?.focus());

  /** Enter on the last row adds a row and moves to it. */
  const onRowKey = (r: RowState, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const last = rows[rows.length - 1];
    if (last.key === r.key) {
      const fresh = makeRow();
      setRows((rs) => [...rs, fresh]);
      focusRow(fresh.key);
    } else {
      focusRow(rows[rows.findIndex((x) => x.key === r.key) + 1].key);
    }
  };

  const toggleBoard = async () => {
    if (boardOpen) return setBoardOpen(false);
    setBoardOpen(true);
    if (board || !memberId) return;
    setBoardLoading(true);
    try {
      setBoard(await api.memberTeamworkTasks(memberId));
    } catch (e: any) {
      setError(e.message);
      setBoardOpen(false);
    } finally {
      setBoardLoading(false);
    }
  };

  const copyPrevious = async () => {
    setError('');
    setCopying(true);
    try {
      const prev = (await api.listReports({ memberId, from: addDays(date, -31), to: addDays(date, -1) }))[0];
      if (!prev) {
        setError('No earlier report in the last month to copy.');
        return;
      }
      const have = new Set(rows.map((r) => r.text.trim().toLowerCase()));
      addRows(rowsFromReport(prev, config?.noUrlAllowedTasks ?? [], false).filter((r) => !have.has(r.text.trim().toLowerCase())));
      setOk(`Copied the tasks from ${formatDayLong(prev.date)} - fill in today's hours.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCopying(false);
    }
  };

  // ---------- Derived ----------
  const filled = rows.filter((r) => !isBlank(r));
  const errors = new Map(filled.map((r) => [r.key, rowError(r, config)]));
  const hasErrors = [...errors.values()].some(Boolean);
  const totalHours = round(filled.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0));
  const anyHours = filled.some((r) => r.hours.trim());
  const member = members.find((m) => m.id === memberId);
  const baseThreshold = member ? HOUR_THRESHOLD[member.role] : undefined;
  // Leave counts toward the day: full-time 7h - 4h leave = 3h still expected.
  const threshold = baseThreshold != null ? Math.max(0, baseThreshold - (leaveHours ?? 0)) : undefined;
  const fullDayOff = leaveHours === 8;
  const added = new Set(rows.map((r) => canonicalTeamworkLink(r.text.trim(), config?.taskUrlPrefix)).filter(Boolean));
  const canSave = !!memberId && !saving && (fullDayOff || (!hasErrors && (filled.length > 0 || leaveHours != null)));

  const submit = useCallback(
    async () => {
      if (!canSave) return;
      setError('');
      setOk('');
      setWarn('');
      setSaving(true);
      try {
        if (leaveHours != null) await api.setAttendance(memberId, date, 'holiday', leaveHours);
        else if (hadLeave) await api.setAttendance(memberId, date, 'none');
        const who = member?.name ?? 'Member';
        let result: ImportResult;
        if (fullDayOff) {
          result = { message: `${who} is off on ${formatDate(date)}.` };
        } else if (filled.length) {
          const entries = filled.map((r) => rowToEntry(r, config));
          const report = await api.importReport({ memberId, date, text: entries.map(entryLine).join('\n'), entries });
          const total = report.entries.reduce((s, e) => s + e.hours, 0);
          result = {
            message:
              `Saved ${report.entries.length} task${report.entries.length === 1 ? '' : 's'}` +
              (total ? ` (${formatHours(total)})` : '') +
              (leaveHours ? ` + ${leaveHours}h leave` : '') +
              ` for ${who} on ${formatDate(date)}.` +
              wipNote(report.wipSync),
            warning: report.wipSync?.error ? `The WIP sheet was not updated: ${report.wipSync.error}` : undefined,
          };
        } else {
          result = { message: `Saved ${leaveHours}h leave for ${who} on ${formatDate(date)}.` };
        }
        onImported(result);
        onClose();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canSave, leaveHours, hadLeave, memberId, date, member, fullDayOff, filled, config],
  );

  // Esc closes, Cmd/Ctrl+Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submit]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl report-form" onClick={(e) => e.stopPropagation()} ref={formRef}>
        <div className="report-form-head">
          <div>
            <h3>{existing ? 'Edit report' : 'Add report'}</h3>
            {existing && member && (
              <p className="muted">Saving replaces {member.name}&apos;s report for {formatDayLong(date)}.</p>
            )}
          </div>
          <button className="icon-only" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <CloseIcon size={18} />
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {ok && <div className="alert ok">{ok}</div>}
        {warn && <div className="alert warn">{warn}</div>}

        <div className="report-form-who">
          <div style={{ flex: 1, minWidth: 220 }}>
            <Select
              value={memberId}
              onChange={selectMember}
              placeholder="Select member"
              options={members.map((m) => ({
                value: m.id,
                label: m.name,
                icon: <Avatar name={m.name} src={m.avatarUrl} size={20} />,
              }))}
            />
          </div>
          <ReportDateField
            value={date}
            onChange={setDate}
            memberId={memberId}
            baseThreshold={baseThreshold}
          />
          <div className="preset-group" role="radiogroup" aria-label="Leave">
            {LEAVE_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={leaveHours === o.value}
                className={`preset-btn${leaveHours === o.value ? ' active' : ''}`}
                onClick={() => setLeaveHours(o.value)}
                disabled={!memberId}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {!memberId ? (
          <div className="empty sm">Select your profile</div>
        ) : loading ? (
          <Loading />
        ) : fullDayOff ? (
          <div className="empty sm">Full day off - no tasks needed.</div>
        ) : (
          <>
            <datalist id="task-types">
              {(config?.noUrlAllowedTasks ?? []).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>

            <div className="task-rows">
              <div className="task-row task-row-head">
                <span>Task</span>
                <span>Note</span>
                <span className="r">Hours</span>
                <span className="c" title="Not finished on this day">
                  In progress
                </span>
                <span />
              </div>
              {rows.map((r) => {
                const err = errors.get(r.key);
                const link = isLink(r.text);
                return (
                  <div key={r.key} className={`task-row${err ? ' has-error' : ''}`}>
                    <div className="task-cell">
                      {link && r.previewTitle ? (
                        <div className="link-preview">
                          <a href={r.text} target="_blank" rel="noreferrer" className="link-preview-title" title={r.text}>
                            {r.previewTitle}
                          </a>
                          <button
                            type="button"
                            className="icon-only"
                            onClick={() => {
                              updateRow(r.key, { text: '', previewTitle: undefined });
                              focusRow(r.key);
                            }}
                            title="Change"
                            aria-label="Change task"
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      ) : (
                        <div className="input-wrap">
                          <input
                            data-row={r.key}
                            value={r.text}
                            list={link ? undefined : 'task-types'}
                            onChange={(e) => updateRow(r.key, { text: e.target.value, previewTitle: undefined })}
                            onBlur={(e) => resolvePreview(r.key, e.target.value)}
                            onPaste={(e) => onPasteTask(r, e)}
                            onKeyDown={(e) => onRowKey(r, e)}
                            placeholder="Paste a Teamwork link, or pick a task type"
                          />
                          {r.previewLoading && <Spinner sm />}
                        </div>
                      )}
                      {err && <div className="row-error">{err}</div>}
                    </div>
                    <input
                      value={r.note}
                      onChange={(e) => updateRow(r.key, { note: e.target.value })}
                      onKeyDown={(e) => onRowKey(r, e)}
                      placeholder="Optional note"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      inputMode="decimal"
                      placeholder="-"
                      value={r.hours}
                      onChange={(e) => updateRow(r.key, { hours: e.target.value })}
                      onKeyDown={(e) => onRowKey(r, e)}
                      className="r"
                    />
                    <label className="c switch-cell" title="Not finished on this day">
                      <input
                        type="checkbox"
                        checked={r.inProgress}
                        onChange={(e) => updateRow(r.key, { inProgress: e.target.checked })}
                      />
                    </label>
                    <button
                      className="icon-only danger"
                      onClick={() => removeRow(r.key)}
                      title="Remove"
                      aria-label="Remove task"
                      disabled={rows.length === 1 && isBlank(r)}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="task-tools">
              <button className="btn ghost sm" onClick={() => addRows([makeRow()])}>
                + Task
              </button>
              <button className={`btn ghost sm${boardOpen ? ' on' : ''}`} onClick={toggleBoard}>
                From Teamwork
              </button>
              <button className="btn ghost sm" onClick={copyPrevious} disabled={copying}>
                {copying && <Spinner sm />} Copy previous day
              </button>
            </div>

            {boardOpen && (
              <div className="board-picker">
                {boardLoading ? (
                  <Loading />
                ) : !board?.length ? (
                  <div className="empty sm">No open D1 tasks assigned to {member?.name}.</div>
                ) : (
                  board.map((t) => {
                    const isAdded = added.has(t.url);
                    return (
                      <button
                        key={t.id}
                        className="board-item"
                        disabled={isAdded}
                        onClick={() => addRows([makeRow({ text: t.url, previewTitle: t.title })])}
                      >
                        <span className="board-item-title">{t.title}</span>
                        {t.stage && <span className="badge gray">{t.stage}</span>}
                        {t.priority && <span className={`prio prio-${t.priority}`}>{t.priority}</span>}
                        <span className="board-item-add">{isAdded ? 'Added' : '+ Add'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}

        <div className="report-form-foot">
          <div className="report-form-total">
            {!fullDayOff && memberId && (
              <>
                <strong>{formatHours(totalHours) === '-' ? '0h' : formatHours(totalHours)}</strong>
                {!anyHours ? (
                  <span className="muted">No hours yet.</span>
                ) : threshold != null && totalHours < threshold ? (
                  <span className="warn-text">
                    {round(threshold - totalHours)}h short of {threshold}h
                  </span>
                ) : threshold != null ? (
                  <span className="ok-text">Enough hours</span>
                ) : null}
              </>
            )}
          </div>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={!canSave} title="Save (Ctrl/⌘ + Enter)">
            {saving && <Spinner sm />} {fullDayOff ? 'Mark day off' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
