'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/Confirm';
import { Loading, Spinner } from '@/components/Spinner';
import { CloseIcon, ExternalIcon } from '@/components/icons';
import { monthLabel } from '@/lib/format';
import type { TaskType, WipConfig, WipStatus } from '@/lib/types';

function currentMonth(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  // Back from the Google consent screen.
  useEffect(() => {
    if (params.get('connected')) setOk('Connected to Google Sheets.');
    const err = params.get('error');
    if (err) setError(err);
  }, [params]);

  return (
    <div className="narrow">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">WIP spreadsheet access and the rules for reporting tasks.</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}

      <GoogleConnection onError={setError} />
      <MonthSheets onError={setError} />
      <TaskTypes onError={setError} />
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="panel settings-section">
      <div className="settings-section-head">
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function GoogleConnection({ onError }: { onError: (m: string) => void }) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<WipStatus | null>(null);
  const load = () => api.wipStatus().then(setStatus).catch((e) => onError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    window.location.href = api.wipAuthUrl();
  };
  const disconnect = async () => {
    const yes = await confirm({
      title: 'Disconnect Google Sheets?',
      message: 'The WIP page, reminders and auto-WIP stop working until you connect again.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.wipDisconnect();
      load();
    } catch (e: any) {
      onError(e.message);
    }
  };

  return (
    <Section
      title="Google Sheets"
      sub="The Google account the app uses to read and write the WIP spreadsheet."
    >
      {!status ? (
        <Loading />
      ) : status.connected ? (
        <div className="settings-line">
          <span className="status-dot ok" />
          <span>
            Connected as <strong>{status.email}</strong>
          </span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={connect}>
            Reconnect
          </button>
          <button className="btn danger sm" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="settings-line">
          <span className="status-dot off" />
          <span className="muted">Not connected — WIP, reminders and auto-WIP are off.</span>
          <span className="spacer" />
          <button className="btn sm" onClick={connect}>
            Connect Google
          </button>
        </div>
      )}
    </Section>
  );
}

function MonthSheets({ onError }: { onError: (m: string) => void }) {
  const confirm = useConfirm();
  const [configs, setConfigs] = useState<WipConfig[] | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => api.listWipConfigs().then(setConfigs).catch((e) => onError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existing = configs?.find((c) => c.month === month);
  const save = async () => {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await api.upsertWipConfig(month, url.trim());
      setUrl('');
      load();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (c: WipConfig) => {
    const yes = await confirm({
      title: `Remove the ${monthLabel(c.month)} sheet?`,
      message: 'WIP for that month stops working until a link is added again.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.deleteWipConfig(c.id);
      load();
    } catch (e: any) {
      onError(e.message);
    }
  };

  return (
    <Section title="WIP sheet per month" sub="A new WIP spreadsheet is created every month — add its link here.">
      <div className="inline-form">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 170 }} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="btn" onClick={save} disabled={saving || !url.trim()}>
          {saving ? <Spinner sm /> : 'Save'}
        </button>
      </div>
      {existing && url.trim() && (
        <div className="hint">{monthLabel(month)} already has a sheet — this replaces it.</div>
      )}

      {!configs ? (
        <Loading />
      ) : configs.length === 0 ? (
        <div className="empty sm">No sheets yet.</div>
      ) : (
        <ul className="plain-list">
          {configs.map((c) => (
            <li key={c.id}>
              <span className="plain-list-main">{monthLabel(c.month)}</span>
              <a className="link-icon" href={c.spreadsheetUrl} target="_blank" rel="noreferrer">
                Open sheet <ExternalIcon />
              </a>
              <button className="icon-only danger" onClick={() => remove(c)} title="Remove" aria-label={`Remove ${monthLabel(c.month)}`}>
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TaskTypes({ onError }: { onError: (m: string) => void }) {
  const confirm = useConfirm();
  const [types, setTypes] = useState<TaskType[] | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => api.listTaskTypes().then(setTypes).catch((e) => onError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await api.createTaskType(label.trim());
      setLabel('');
      load();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (t: TaskType) => {
    const yes = await confirm({
      title: `Remove "${t.label}"?`,
      message: 'Tasks with this name will need a Teamwork link again.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.deleteTaskType(t.id);
      load();
    } catch (e: any) {
      onError(e.message);
    }
  };

  return (
    <Section
      title="Tasks without a Teamwork link"
      sub="Every reported task needs a Teamwork link, except these (meetings, reviews…)."
    >
      {!types ? (
        <Loading />
      ) : (
        <div className="chip-list">
          {types.map((t) => (
            <span className="chip" key={t.id}>
              {t.label}
              <button onClick={() => remove(t)} title={`Remove ${t.label}`} aria-label={`Remove ${t.label}`}>
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
          <span className="chip chip-input">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Add a type…"
              aria-label="New task type"
            />
            {label.trim() && (
              <button onClick={add} disabled={saving}>
                {saving ? <Spinner sm /> : 'Add'}
              </button>
            )}
          </span>
        </div>
      )}
    </Section>
  );
}
