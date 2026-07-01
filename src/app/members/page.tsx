'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Member } from '@/lib/types';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.listMembers().then(setMembers).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const add = async () => {
    setError('');
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    setSaving(true);
    try {
      await api.createMember({ name: name.trim(), email: email.trim() });
      setName('');
      setEmail('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: Member) => {
    try {
      await api.updateMember(m.id, { active: !m.active });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Members</h1>
      <p className="page-sub">
        Only registered emails may report. A Google Chat sender with an
        unregistered email is blocked.
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="row">
        <div className="col" style={{ maxWidth: 360 }}>
          <div className="panel">
            <div className="panel-head">Add member</div>
            <div style={{ padding: 16 }}>
              <div className="field">
                <label>Full name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nguyen Van A"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="a@offspringdigital.com"
                  style={{ width: '100%' }}
                />
              </div>
              <button className="btn" onClick={add} disabled={saving}>
                {saving ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="panel">
            <div className="panel-head">{members.length} member(s)</div>
            {members.length === 0 ? (
              <div className="empty">No members yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.name}</td>
                      <td>{m.email}</td>
                      <td>
                        {m.active ? (
                          <span className="badge ok">Active</span>
                        ) : (
                          <span className="badge gray">Inactive</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn ghost sm"
                          onClick={() => toggleActive(m)}
                        >
                          {m.active ? 'Deactivate' : 'Activate'}
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
