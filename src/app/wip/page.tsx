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
        setOk(`No one missing WIP for ${result.date} - nothing sent.`);
      } else {
        const parts: string[] = [];
        if (result.missingPrevEvening.length)
          parts.push(`evening (prev day): ${result.missingPrevEvening.join(', ')}`);
        if (result.missingToday.length)
          parts.push(`morning: ${result.missingToday.join(', ')}`);
        setOk(`Reminder sent - ${parts.join(' · ')}`);
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
          {/* Gear: a toothed ring drawn as one path + the hub. The previous
              hand-written path mixed absolute H/V commands into the arc runs
              and collapsed into a dot. */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.14 12.94a7.6 7.6 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.6 7.6 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.38.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64Z" />
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
          <span>WIP - {formatDate(date)}</span>
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
            {day.availableTabs && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                {day.availableTabs.length === 0
                  ? 'The sheet has no tabs at all - is this the right spreadsheet?'
                  : `Tabs in this sheet: ${day.availableTabs.join(', ')}`}
              </div>
            )}
          </div>
        ) : mappedRows.length === 0 ? (
          <div className="empty">
            No mapped members in this tab - set WIP name in Members.
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
