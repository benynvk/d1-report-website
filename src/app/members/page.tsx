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
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isSupport, setIsSupport] = useState(false);
  const [wipName, setWipName] = useState('');
  const [teamworkEmail, setTeamworkEmail] = useState('');
  const [autoWip, setAutoWip] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
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

  const resetAddForm = () => {
    setName('');
    setEmail('');
    setAvatar(null);
    setIsSupport(false);
    setWipName('');
    setTeamworkEmail('');
    setAutoWip(false);
  };

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
        teamworkEmail: teamworkEmail.trim() || undefined,
        autoWip,
      });
      setMembers((ms) =>
        [...ms, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      resetAddForm();
      setShowAdd(false);
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

  const toggleAutoWip = async (m: Member) => {
    const next = !m.autoWip;
    patchMember(m.id, { autoWip: next }); // optimistic
    try {
      await api.updateMember(m.id, { autoWip: next });
    } catch (e: any) {
      patchMember(m.id, { autoWip: m.autoWip }); // revert
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

  const saveTeamworkEmail = async (m: Member, value: string) => {
    const next = value.trim();
    if (next === (m.teamworkEmail ?? '')) return;
    patchMember(m.id, { teamworkEmail: next || null }); // optimistic
    try {
      await api.updateMember(m.id, { teamworkEmail: next });
    } catch (e: any) {
      patchMember(m.id, { teamworkEmail: m.teamworkEmail }); // revert
      setError(e.message);
    }
  };

  const saveChatUserId = async (m: Member, value: string) => {
    const next = value.trim();
    if (next === (m.chatUserId ?? '')) return;
    patchMember(m.id, { chatUserId: next || null }); // optimistic
    try {
      await api.updateMember(m.id, { chatUserId: next });
    } catch (e: any) {
      patchMember(m.id, { chatUserId: m.chatUserId }); // revert
      setError(e.message);
    }
  };

  const syncChatIds = async () => {
    setError('');
    setSyncMessage('');
    setSyncing(true);
    try {
      const chatMembers = await api.wipChatMembers();
      const byEmail = new Map(
        chatMembers
          .filter((c) => c.email)
          .map((c) => [c.email!.trim().toLowerCase(), c.chatUserId]),
      );
      let updated = 0;
      for (const m of members) {
        const match = byEmail.get(m.email.trim().toLowerCase());
        if (match && match !== m.chatUserId) {
          await api.updateMember(m.id, { chatUserId: match });
          patchMember(m.id, { chatUserId: match });
          updated++;
        }
      }
      setSyncMessage(
        updated > 0
          ? `Synced ${updated} member(s) by email.`
          : 'No matches — no member emails matched a Chat member email.',
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
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
      <div className="page-head-row">
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Only registered emails may report. A Google Chat sender with an
            unregistered email is blocked.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={syncChatIds} disabled={syncing}>
            {syncing ? (
              <span className="btn-spin">
                <Spinner sm /> Syncing…
              </span>
            ) : (
              'Sync Google Chat ID'
            )}
          </button>
          <button className="btn" onClick={() => setShowAdd(true)}>
            + Add
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {syncMessage && <div className="alert ok">{syncMessage}</div>}

      <div className="panel">
        <div className="panel-head">{members.length} member(s)</div>
        {loading ? (
          <Loading />
        ) : members.length === 0 ? (
          <div className="empty">No members yet.</div>
        ) : (
          <table style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th className="c">Name</th>
                <th className="c">Email</th>
                <th className="c">Teamwork email</th>
                <th className="c">WIP name</th>
                <th className="c">Chat ID</th>
                <th className="c">Auto WIP</th>
                <th className="c">Supporter</th>
                <th className="c"></th>
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
                      <button className="name-link" onClick={() => setSelected(m)}>
                        {m.name}
                      </button>
                    </div>
                  </td>
                  <td className="mid">{m.email}</td>
                  <td className="mid">
                    <input
                      key={m.id}
                      defaultValue={m.teamworkEmail ?? ''}
                      placeholder={m.email}
                      onBlur={(e) => saveTeamworkEmail(m, e.target.value)}
                      style={{ width: '100%', minWidth: 180 }}
                    />
                  </td>
                  <td className="mid">
                    <input
                      key={m.id}
                      defaultValue={m.wipName ?? ''}
                      onBlur={(e) => saveWipName(m, e.target.value)}
                      style={{ width: '100%', minWidth: 160 }}
                    />
                  </td>
                  <td className="mid">
                    <input
                      key={m.id}
                      defaultValue={(m.chatUserId ?? '').replace(/^users\//, '')}
                      placeholder="1234567890"
                      onBlur={(e) => saveChatUserId(m, e.target.value)}
                      style={{ width: '100%', minWidth: 170 }}
                    />
                  </td>
                  <td className="c mid">
                    <input
                      type="checkbox"
                      checked={!!m.autoWip}
                      onChange={() => toggleAutoWip(m)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </td>
                  <td className="c mid">
                    <input
                      type="checkbox"
                      checked={!!m.isSupport}
                      onChange={() => toggleSupport(m)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn danger sm" onClick={() => remove(m)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add member</h3>
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
            <div className="field">
              <label>Teamwork email (optional)</label>
              <input
                value={teamworkEmail}
                onChange={(e) => setTeamworkEmail(e.target.value)}
                placeholder={email || 'defaults to Email above'}
                style={{ width: '100%' }}
              />
              <div className="hint">Only needed if different from Email above.</div>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={isSupport}
                onChange={(e) => setIsSupport(e.target.checked)}
              />
              <span>Support member (skip daily reminders)</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={autoWip}
                onChange={(e) => setAutoWip(e.target.checked)}
              />
              <span>Auto WIP (fill morning entry from Teamwork at 9am)</span>
            </label>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  setShowAdd(false);
                  resetAddForm();
                }}
              >
                Cancel
              </button>
              <button className="btn" onClick={add} disabled={saving}>
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
      )}

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
