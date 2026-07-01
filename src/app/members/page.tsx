'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/Confirm';
import { Loading, Spinner } from '@/components/Spinner';
import { Avatar } from '@/components/Avatar';
import { MemberDetail } from '@/components/MemberDetail';
import { resizeImage } from '@/lib/image';
import type { Member } from '@/lib/types';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isSupport, setIsSupport] = useState(false);
  const [wipName, setWipName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Member | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rowFileRef = useRef<HTMLInputElement>(null);
  const [avatarTarget, setAvatarTarget] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = () => {
    setLoading(true);
    api
      .listMembers()
      .then(setMembers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const pickNewAvatar = async (file?: File) => {
    if (!file) return;
    try {
      setAvatar(await resizeImage(file, 300));
    } catch (e: any) {
      setError(e.message);
    }
  };

  // In-place state update so toggles/avatar don't reload (and re-spinner) the list.
  const patchMember = (id: string, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const add = async () => {
    setError('');
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.createMember({
        name: name.trim(),
        email: email.trim(),
        avatarUrl: avatar,
        isSupport,
        wipName: wipName.trim() || null,
      });
      setMembers((ms) =>
        [...ms, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName('');
      setEmail('');
      setAvatar(null);
      setIsSupport(false);
      setWipName('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async (memberId: string, file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 300);
      patchMember(memberId, { avatarUrl: dataUrl }); // optimistic
      await api.updateMember(memberId, { avatarUrl: dataUrl });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleActive = async (m: Member) => {
    const next = !m.active;
    patchMember(m.id, { active: next }); // optimistic
    try {
      await api.updateMember(m.id, { active: next });
    } catch (e: any) {
      patchMember(m.id, { active: m.active }); // revert
      setError(e.message);
    }
  };

  const toggleSupport = async (m: Member) => {
    const next = !m.isSupport;
    patchMember(m.id, { isSupport: next }); // optimistic
    try {
      await api.updateMember(m.id, { isSupport: next });
    } catch (e: any) {
      patchMember(m.id, { isSupport: m.isSupport }); // revert
      setError(e.message);
    }
  };

  const saveWipName = async (m: Member, value: string) => {
    const next = value.trim();
    if (next === (m.wipName ?? '')) return;
    patchMember(m.id, { wipName: next || null }); // optimistic
    try {
      await api.updateMember(m.id, { wipName: next });
    } catch (e: any) {
      patchMember(m.id, { wipName: m.wipName }); // revert
      setError(e.message);
    }
  };

  const remove = async (m: Member) => {
    const ok = await confirm({
      title: `Delete ${m.name}?`,
      message:
        'This also deletes all their reports and attendance. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteMember(m.id);
      setMembers((ms) => ms.filter((x) => x.id !== m.id));
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
                <label>Avatar</label>
                <div className="avatar-upload">
                  <div
                    className="avatar-pick"
                    onClick={() => fileRef.current?.click()}
                    title="Upload avatar"
                  >
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="avatar preview" />
                    ) : (
                      <span className="muted" style={{ fontSize: 22 }}>
                        +
                      </span>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => pickNewAvatar(e.target.files?.[0])}
                  />
                  <span className="hint" style={{ margin: 0 }}>
                    Auto-resized to 300px.
                  </span>
                </div>
              </div>
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
              <div className="field">
                <label>WIP name (optional)</label>
                <input
                  value={wipName}
                  onChange={(e) => setWipName(e.target.value)}
                  placeholder="Nguyen Van A (Nickname)"
                  style={{ width: '100%' }}
                />
                <div className="hint">
                  Must match &quot;Staff&apos;s name&quot; exactly as it appears in the
                  WIP sheet.
                </div>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={isSupport}
                  onChange={(e) => setIsSupport(e.target.checked)}
                />
                <span>Support member (skip daily reminders)</span>
              </label>
              <button className="btn block" onClick={add} disabled={saving}>
                {saving ? (
                  <span className="btn-spin">
                    <Spinner sm /> Adding…
                  </span>
                ) : (
                  'Add member'
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="panel">
            <div className="panel-head">{members.length} member(s)</div>
            {loading ? (
              <Loading />
            ) : members.length === 0 ? (
              <div className="empty">No members yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>WIP name</th>
                    <th className="c">Supporter</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className="member-cell">
                          <span
                            className="avatar-click"
                            onClick={() => {
                              setAvatarTarget(m.id);
                              rowFileRef.current?.click();
                            }}
                            title="Change avatar"
                          >
                            <Avatar name={m.name} src={m.avatarUrl} size={32} />
                          </span>
                          <button
                            className="name-link"
                            onClick={() => setSelected(m)}
                          >
                            {m.name}
                          </button>
                        </div>
                      </td>
                      <td>{m.email}</td>
                      <td className="mid">
                        <input
                          key={m.id}
                          defaultValue={m.wipName ?? ''}
                          placeholder="not mapped"
                          onBlur={(e) => saveWipName(m, e.target.value)}
                          style={{ width: '100%', minWidth: 160 }}
                        />
                      </td>
                      <td className="c mid">
                        <input
                          type="checkbox"
                          checked={m.isSupport}
                          onChange={() => toggleSupport(m)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                      </td>
                      <td>
                        {m.active ? (
                          <span className="badge ok">Active</span>
                        ) : (
                          <span className="badge gray">Inactive</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            justifyContent: 'flex-end',
                          }}
                        >
                          <button
                            className="btn ghost sm"
                            onClick={() => toggleActive(m)}
                          >
                            {m.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            className="btn danger sm"
                            onClick={() => remove(m)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Hidden input for changing an existing member's avatar. */}
      <input
        ref={rowFileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (avatarTarget) changeAvatar(avatarTarget, e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {selected && (
        <MemberDetail
          memberId={selected.id}
          memberName={selected.name}
          avatarUrl={selected.avatarUrl}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
