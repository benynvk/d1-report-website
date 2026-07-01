'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from './Select';
import { Spinner } from './Spinner';
import { useConfirm } from './Confirm';
import { Avatar } from './Avatar';
import { DateField } from './DateField';
import { formatDate, taskLabel } from '@/lib/format';
import type { Member, PreviewResult, ReportConfig } from '@/lib/types';

function today(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const PLACEHOLDER = `https://offspringdigital.teamwork.com/app/tasks/101: 4
https://offspringdigital.teamwork.com/app/tasks/102: 2
Weekly meeting: 1`;

const HOLIDAY_WORDS = [
  'holiday',
  'nghỉ',
  'nghi',
  'nghỉ phép',
  'nghỉ cả ngày',
  'off',
  'day off',
  'leave',
];

/** True when the whole message is just a holiday note (e.g. "Holiday"). */
function isHolidayNote(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  return lines.length === 1 && HOLIDAY_WORDS.includes(lines[0].toLowerCase());
}

/** Popup: paste an end-of-day message, preview parsed tasks, then save. */
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
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    api.listMembers().then(setMembers).catch((e) => setError(e.message));
    api.reportConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api.previewReport(text).then(setPreview).catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const holidayMode = isHolidayNote(text);
  const hasInvalid = !!preview && preview.invalid.length > 0;
  const canSubmit = useMemo(
    () => !!memberId && !!text.trim() && (holidayMode || !hasInvalid) && !saving,
    [memberId, text, holidayMode, hasInvalid, saving],
  );

  const submit = async () => {
    setError('');
    setOk('');
    // A holiday note marks the day off instead of saving a report.
    if (isHolidayNote(text)) {
      setSaving(true);
      try {
        await api.setAttendance(memberId, date, 'holiday');
        const who = members.find((m) => m.id === memberId)?.name ?? 'Member';
        setOk(`Marked ${who} on holiday for ${formatDate(date)}.`);
        setText('');
        setPreview(null);
        onImported();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSaving(false);
      }
      return;
    }
    // One report per member per day — confirm before overwriting.
    try {
      const existing = await api.listReports({ date, memberId });
      if (existing.length > 0) {
        const ok = await confirm({
          title: 'Report already exists',
          message: `${existing[0].member.name} already has a report on ${formatDate(date)}. Overwrite it?`,
          confirmLabel: 'Overwrite',
          danger: true,
        });
        if (!ok) return;
      }
    } catch {
      /* if the check fails, fall through and let the save attempt surface it */
    }
    setSaving(true);
    try {
      const report = await api.importReport({ memberId, date, text });
      const total = report.entries.reduce((s, e) => s + e.hours, 0);
      setOk(
        `Saved ${report.entries.length} tasks (${total}h) for ${report.member.name} on ${formatDate(report.date)}.`,
      );
      setText('');
      setPreview(null);
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
        <div className="modal-lg-head">
          <h3 style={{ margin: 0 }}>Add report</h3>
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="page-sub" style={{ marginTop: -4 }}>
          Paste an end-of-day message. Every task needs a Teamwork link unless
          it is an allowed no-link type. A same-day import overwrites that
          day.
        </p>

        {error && <div className="alert error">{error}</div>}
        {ok && <div className="alert ok">{ok}</div>}

        <div className="row">
          <div className="col">
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
            <div className="field">
              <label>Report text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={PLACEHOLDER}
              />
              {config && (
                <div className="hint">
                  Required link prefix: <code>{config.taskUrlPrefix}</code>.
                  No-link types allowed:{' '}
                  {config.noUrlAllowedTasks.join(', ') || '—'}.
                </div>
              )}
            </div>
            <button className="btn block" onClick={submit} disabled={!canSubmit}>
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
            {holidayMode && (
              <div className="hint" style={{ marginTop: 8 }}>
                This marks the member on holiday for the selected day.
              </div>
            )}
            {hasInvalid && (
              <div className="hint" style={{ marginTop: 8 }}>
                Fix the highlighted tasks first.
              </div>
            )}
          </div>

          <div className="col">
            <div className="panel">
              <div className="panel-head">
                Preview {preview && `— ${preview.totalHours}h total`}
              </div>
              {!preview ? (
                <div className="empty">Parsed tasks will appear here.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th className="num">Hours</th>
                      <th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.map((e, i) => (
                      <tr key={i} className={e.valid ? '' : 'invalid-row'}>
                        <td>
                          {e.href ? (
                            <a href={e.href} target="_blank" rel="noreferrer">
                              {taskLabel(e)}
                            </a>
                          ) : (
                            taskLabel(e)
                          )}
                        </td>
                        <td className="num">{e.hours}</td>
                        <td>
                          {e.valid ? (
                            <span className="badge ok">OK</span>
                          ) : (
                            <span className="badge pending">Needs link</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {preview.entries.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">
                          No task lines detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {preview && preview.ignored.length > 0 && (
                <div style={{ padding: '10px 18px' }} className="muted">
                  Ignored lines: {preview.ignored.join(' · ')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
