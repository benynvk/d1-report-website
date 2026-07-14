'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/Confirm';
import { Loading, Spinner } from '@/components/Spinner';
import type { TaskType } from '@/lib/types';

export default function TaskTypesPage() {
  const [types, setTypes] = useState<TaskType[]>([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();

  const load = () => {
    setLoading(true);
    api
      .listTaskTypes()
      .then(setTypes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async () => {
    setError('');
    if (!label.trim()) return;
    setSaving(true);
    try {
      await api.createTaskType(label.trim());
      setLabel('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: TaskType) => {
    const ok = await confirm({
      title: 'Remove task type',
      message: `Remove "${t.label}"? Tasks with this name will then require a Teamwork link.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTaskType(t.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Task Types (no-link allowed)</h1>
      <p className="page-sub">
        Tasks normally require a Teamwork link. These task types are the
        exceptions that may be reported without a link (e.g. meetings).
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="row">
        <div className="col" style={{ maxWidth: 360 }}>
          <div className="panel">
            <div className="panel-head">Add type</div>
            <div style={{ padding: 16 }}>
              <div className="field">
                <label>Label</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Weekly meeting"
                  style={{ width: '100%' }}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                />
              </div>
              <button className="btn block" onClick={add} disabled={saving}>
                {saving ? (
                  <span className="btn-spin">
                    <Spinner sm /> Adding…
                  </span>
                ) : (
                  'Add type'
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="panel">
            <div className="panel-head">{types.length} type(s)</div>
            {loading ? (
              <Loading />
            ) : types.length === 0 ? (
              <div className="empty">No allowed no-link task types.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, verticalAlign: 'middle' }}>{t.label}</td>
                      <td style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                        <button
                          className="btn danger sm"
                          onClick={() => remove(t)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
