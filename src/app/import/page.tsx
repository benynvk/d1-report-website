'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { useConfirm } from '@/components/Confirm';
import { formatDate, taskLabel } from '@/lib/format';
import type { Member, PreviewResult, ReportConfig } from '@/lib/types';

function today(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const PLACEHOLDER = `https://offspringdigital.teamwork.com/app/tasks/101: 4
https://offspringdigital.teamwork.com/app/tasks/102: 2
Weekly meeting: 1`;

export default function ImportPage() {
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
    if (!text.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api.previewReport(text).then(setPreview).catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const hasInvalid = !!preview && preview.invalid.length > 0;
  const canSubmit = useMemo(
    () => !!memberId && !!text.trim() && !hasInvalid && !saving,
    [memberId, text, hasInvalid, saving],
  );

  const submit = async () => {
    setError('');
    setOk('');
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Import report</h1>
      <p className="page-sub">
        Paste an end-of-day message. Every task needs a Teamwork link unless it
        is an allowed no-link type. A same-day import overwrites that day.
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
                }))}
              />
            </div>
            <div className="field" style={{ width: 180, flexShrink: 0 }}>
              <label>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ width: '100%' }}
              />
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
                Required link prefix: <code>{config.taskUrlPrefix}</code>. No-link
                types allowed: {config.noUrlAllowedTasks.join(', ') || '—'}.
              </div>
            )}
          </div>
          <button className="btn block" onClick={submit} disabled={!canSubmit}>
            {saving ? (
              <span className="btn-spin">
                <Spinner sm /> Saving…
              </span>
            ) : (
              'Save report'
            )}
          </button>
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
    </>
  );
}
