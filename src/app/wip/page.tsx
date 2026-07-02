'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { DateField } from '@/components/DateField';
import { Loading, Spinner } from '@/components/Spinner';
import { useConfirm } from '@/components/Confirm';
import { formatDate } from '@/lib/format';
import type { WipConfig, WipDay, WipStatus } from '@/lib/types';

function today(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function currentMonth(): string {
  return today().slice(0, 7);
}
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export default function WipPage() {
  return (
    <Suspense fallback={<Loading />}>
      <WipPageInner />
    </Suspense>
  );
}

function WipPageInner() {
  const params = useSearchParams();
  const confirm = useConfirm();

  const [status, setStatus] = useState<WipStatus | null>(null);
  const [configs, setConfigs] = useState<WipConfig[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [url, setUrl] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  const [date, setDate] = useState(today());
  const [day, setDay] = useState<WipDay | null>(null);
  const [dayLoading, setDayLoading] = useState(true);
  const [dayError, setDayError] = useState('');

  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [checking, setChecking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const loadStatus = () => {
    api.wipStatus().then(setStatus).catch(() => {});
  };
  const loadConfigs = () => {
    api.listWipConfigs().then(setConfigs).catch(() => {});
  };

  useEffect(() => {
    loadStatus();
    loadConfigs();
    const err = params.get('error');
    if (params.get('connected')) setOk('Connected to Google Sheets.');
    if (err) setError(err);
  }, [params]);

  useEffect(() => {
    setDayLoading(true);
    setDayError('');
    api
      .wipDay(date)
      .then(setDay)
      .catch((e) => setDayError(e.message))
      .finally(() => setDayLoading(false));
  }, [date]);

  const connect = () => {
    window.location.href = api.wipAuthUrl();
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Google Sheets',
      message: 'The WIP page will stop working until you reconnect.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.wipDisconnect();
      loadStatus();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const saveConfig = async () => {
    setError('');
    if (!url.trim()) {
      setError('Paste the spreadsheet URL first.');
      return;
    }
    setSavingConfig(true);
    try {
      await api.upsertWipConfig(month, url.trim());
      setUrl('');
      loadConfigs();
      if (month === date.slice(0, 7)) {
        api.wipDay(date).then(setDay).catch(() => {});
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const checkWip = async () => {
    setError('');
    setOk('');
    setChecking(true);
    try {
      const result = await api.checkWipReminder();
      if (result.missingToday.length === 0 && result.missingPrevEvening.length === 0) {
        setOk(`No one missing WIP for ${result.date} — nothing sent.`);
      } else {
        const parts: string[] = [];
        if (result.missingPrevEvening.length)
          parts.push(`evening (prev day): ${result.missingPrevEvening.join(', ')}`);
        if (result.missingToday.length)
          parts.push(`morning: ${result.missingToday.join(', ')}`);
        setOk(`Reminder sent — ${parts.join(' · ')}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const removeConfig = async (c: WipConfig) => {
    const ok = await confirm({
      title: `Remove ${monthLabel(c.month)} link?`,
      message: 'You can paste it again later if needed.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteWipConfig(c.id);
      loadConfigs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const mappedRows = day?.rows.filter((r) => r.memberId) ?? [];

  return (
    <>
      <div className="page-head-row">
        <div>
          <h1 className="page-title">WIP</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Reads the company&apos;s daily WIP spreadsheet (morning/evening
            notes, one tab per day). Separate from D1 task reports.
          </p>
        </div>
        <button
          className="btn ghost icon-btn"
          onClick={() => setShowSettings(true)}
          title="WIP settings"
          aria-label="WIP settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.6a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.04-1.56V4.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.56 1.04h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
          </svg>
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}

      <div className="panel">
        <div
          className="panel-head"
          style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <span>WIP — {formatDate(date)}</span>
          <DateField value={date} onChange={setDate} />
          <button
            className="btn ghost sm"
            onClick={checkWip}
            disabled={checking}
            style={{ marginLeft: 'auto' }}
          >
            {checking ? (
              <span className="btn-spin">
                <Spinner sm /> Checking…
              </span>
            ) : (
              'Check WIP'
            )}
          </button>
        </div>
        {dayLoading ? (
          <Loading />
        ) : dayError ? (
          <div className="alert error" style={{ margin: 16 }}>
            {dayError}
          </div>
        ) : !day?.configured ? (
          <div className="empty">
            No WIP sheet configured for {monthLabel(date.slice(0, 7))} yet.
          </div>
        ) : day.rows.length === 0 ? (
          <div className="empty">
            No tab named &quot;{day.tabName}&quot; in this sheet (weekend/holiday?).
          </div>
        ) : mappedRows.length === 0 ? (
          <div className="empty">
            No mapped members in this tab — set WIP name in Members.
          </div>
        ) : (
          <table style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '35%' }} />
              <col style={{ width: '35%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Staff</th>
                <th>Team</th>
                <th>Morning</th>
                <th>Evening</th>
              </tr>
            </thead>
            <tbody>
              {mappedRows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="member-cell">
                      <Avatar name={r.memberName!} src={r.avatarUrl} size={26} />
                      <span style={{ fontWeight: 600 }}>{r.memberName}</span>
                    </div>
                  </td>
                  <td>{r.team}</td>
                  <td className="wrap-cell">{r.morning}</td>
                  <td className="wrap-cell">{r.evening}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div className="modal-lg-head">
              <h3 style={{ margin: 0 }}>WIP settings</h3>
              <button className="btn ghost sm" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>

            <div className="panel" style={{ marginBottom: 22 }}>
              <div className="panel-head">Google Sheets connection</div>
              <div style={{ padding: 16 }}>
                {!status ? (
                  <Loading />
                ) : status.connected ? (
                  <>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Connected as <strong>{status.email}</strong>
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn ghost" onClick={connect}>
                        Reconnect
                      </button>
                      <button className="btn danger" onClick={disconnect}>
                        Disconnect
                      </button>
                    </div>
                    <div className="hint">
                      Reconnect after permissions change (e.g. read → write access).
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Connect the Google account that can view the WIP sheet.
                    </p>
                    <button className="btn block" onClick={connect}>
                      Connect Google Sheets
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">Add month link</div>
              <div style={{ padding: 16 }}>
                <div className="field">
                  <label>Month</label>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="field">
                  <label>Spreadsheet URL</label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    style={{ width: '100%' }}
                  />
                </div>
                <button
                  className="btn block"
                  onClick={saveConfig}
                  disabled={savingConfig}
                >
                  {savingConfig ? (
                    <span className="btn-spin">
                      <Spinner sm /> Saving…
                    </span>
                  ) : (
                    'Save link'
                  )}
                </button>
              </div>
            </div>

            {configs.length > 0 && (
              <div className="panel" style={{ marginTop: 22 }}>
                <div className="panel-head">{configs.length} month(s) configured</div>
                <table>
                  <tbody>
                    {configs.map((c) => (
                      <tr key={c.id}>
                        <td className="mid" style={{ fontWeight: 600 }}>
                          {monthLabel(c.month)}
                        </td>
                        <td className="mid">
                          <a href={c.spreadsheetUrl} target="_blank" rel="noreferrer">
                            Open sheet
                          </a>
                        </td>
                        <td className="c mid">
                          <button
                            className="btn danger sm"
                            onClick={() => removeConfig(c)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
