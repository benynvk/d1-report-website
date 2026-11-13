'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/Confirm';
import { Loading, Spinner } from '@/components/Spinner';
import { Select } from '@/components/Select';
import { Avatar } from '@/components/Avatar';
import { MemberDetail } from '@/components/MemberDetail';
import { EditIcon } from '@/components/icons';
import { resizeImage } from '@/lib/image';
import type { Member, MemberPosition, MemberRole } from '@/lib/types';

const ROLE_LABELS: Record<MemberRole, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  support: 'Support',
};
const POSITION_LABELS: Record<MemberPosition, string> = { dev: 'Dev', tester: 'Tester' };

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  /** null = closed, 'new' = add form, a member = edit form. */
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [history, setHistory] = useState<Member | null>(null);

  const load = () => {
    setLoading(true);
    api
      .listMembers()
      .then(setMembers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const patch = (id: string, p: Partial<Member>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const toggleAutoWip = async (m: Member) => {
    patch(m.id, { autoWip: !m.autoWip }); // optimistic
    try {
      await api.updateMember(m.id, { autoWip: !m.autoWip });
    } catch (e: any) {
      patch(m.id, { autoWip: m.autoWip });
      setError(e.message);
    }
  };

  /** Fills missing Chat IDs from the members of the team's Chat space, by email. */
  const syncChatIds = async () => {
    setError('');
    setNotice('');
    setSyncing(true);
    try {
      const chat = await api.wipChatMembers();
      const byEmail = new Map(chat.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c.chatUserId]));
      let updated = 0;
      for (const m of members) {
        const id = byEmail.get(m.email.trim().toLowerCase());
        if (id && id !== m.chatUserId) {
          await api.updateMember(m.id, { chatUserId: id });
          updated++;
        }
      }
      if (updated) load();
      setNotice(updated ? `Updated the Chat ID of ${updated} member(s).` : 'Chat IDs are already up to date.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="page-head-row">
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-sub">Only registered emails can report or use /wip in Chat.</p>
        </div>
        <div className="toolbar">
          <button
            className="btn ghost"
            onClick={syncChatIds}
            disabled={syncing}
            title="Match members to the Google Chat space by email, so reminders can @mention them"
          >
            {syncing && <Spinner sm />} Sync Chat IDs
          </button>
          <button className="btn" onClick={() => setEditing('new')}>
            + Add member
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="panel">
        {loading ? (
          <Loading />
        ) : members.length === 0 ? (
          <div className="empty">
            No members yet.{' '}
            <button className="link-btn" onClick={() => setEditing('new')}>
              Add the first one
            </button>
          </div>
        ) : (
          <table className="members-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>WIP name</th>
                <th className="c" title="Fill empty WIP automatically (18:30 evening, 09:45 morning)">
                  Auto WIP
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const warnings = [!m.wipName && 'No WIP name', !m.chatUserId && 'No Chat ID'].filter(Boolean);
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="member-cell">
                        <Avatar name={m.name} src={m.avatarUrl} size={32} />
                        <div className="member-cell-text">
                          <button className="name-link member-cell-name" onClick={() => setHistory(m)} title="See their reports">
                            {m.name}
                          </button>
                          <span className="member-cell-sub">{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge gray">{ROLE_LABELS[m.role]}</span>{' '}
                      <span className="badge gray">{POSITION_LABELS[m.position ?? 'dev']}</span>
                    </td>
                    <td>
                      {m.wipName ?? <span className="muted">-</span>}
                      {warnings.length > 0 && <div className="warn-text">{warnings.join(' · ')}</div>}
                    </td>
                    <td className="c">
                      <label className="switch" title={m.autoWip ? 'On' : 'Off'}>
                        <input type="checkbox" checked={!!m.autoWip} onChange={() => toggleAutoWip(m)} />
                        <span />
                      </label>
                    </td>
                    <td className="c">
                      <button className="icon-only" onClick={() => setEditing(m)} title="Edit" aria-label={`Edit ${m.name}`}>
                        <EditIcon />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <MemberForm
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setMembers((ms) =>
              (ms.some((x) => x.id === saved.id) ? ms.map((x) => (x.id === saved.id ? saved : x)) : [...ms, saved]).sort(
                (a, b) => a.name.localeCompare(b.name),
              ),
            );
            setEditing(null);
          }}
          onDeleted={(id) => {
            setMembers((ms) => ms.filter((x) => x.id !== id));
            setEditing(null);
          }}
        />
      )}

      {history && (
        <MemberDetail
          memberId={history.id}
          memberName={history.name}
          avatarUrl={history.avatarUrl}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

/** Add / edit form for one member. */
function MemberForm({
  member,
  onClose,
  onSaved,
  onDeleted,
}: {
  member: Member | null;
  onClose: () => void;
  onSaved: (m: Member) => void;
  onDeleted: (id: string) => void;
}) {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    name: member?.name ?? '',
    email: member?.email ?? '',
    role: member?.role ?? ('full_time' as MemberRole),
    position: member?.position ?? ('dev' as MemberPosition),
    wipName: member?.wipName ?? '',
    teamworkEmail: member?.teamworkEmail ?? '',
    chatUserId: (member?.chatUserId ?? '').replace(/^users\//, ''),
    autoWip: member?.autoWip ?? false,
  });
  /** A new image as a data URL; undefined = unchanged. */
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickAvatar = async (file?: File) => {
    if (!file) return;
    try {
      setAvatar(await resizeImage(file, 300));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const save = async () => {
    setError('');
    if (!f.name.trim() || !f.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: f.name.trim(),
        email: f.email.trim(),
        role: f.role,
        position: f.position,
        wipName: f.wipName.trim(),
        teamworkEmail: f.teamworkEmail.trim(),
        chatUserId: f.chatUserId.trim(),
        autoWip: f.autoWip,
        ...(avatar !== undefined ? { avatarUrl: avatar } : {}),
      };
      const saved = member
        ? await api.updateMember(member.id, body)
        : await api.createMember({
            ...body,
            wipName: body.wipName || null,
            teamworkEmail: body.teamworkEmail || undefined,
            chatUserId: body.chatUserId || undefined,
          });
      onSaved(saved);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!member) return;
    const yes = await confirm({
      title: `Delete ${member.name}?`,
      message: 'This also deletes all their reports and leave days. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.deleteMember(member.id);
      onDeleted(member.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const shownAvatar = avatar ?? member?.avatarUrl ?? null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-form" onClick={(e) => e.stopPropagation()}>
        <h3>{member ? `Edit ${member.name}` : 'Add member'}</h3>
        {error && <div className="alert error">{error}</div>}

        <div className="form-identity">
          <button type="button" className="avatar-pick" onClick={() => fileRef.current?.click()} title="Change photo">
            {shownAvatar ? (
              <Avatar name={f.name || '?'} src={shownAvatar} size={56} />
            ) : (
              <span className="muted" style={{ fontSize: 22 }}>
                +
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
          <div className="form-grid" style={{ flex: 1 }}>
            <div className="field">
              <label>Full name</label>
              <input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus={!member} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Role</label>
            <Select
              value={f.role}
              onChange={(v) => set('role', (v || 'full_time') as MemberRole)}
              placeholder=""
              options={(Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
            <div className="hint">Support members aren&apos;t reminded.</div>
          </div>
          <div className="field">
            <label>Position</label>
            <Select
              value={f.position}
              onChange={(v) => set('position', (v || 'dev') as MemberPosition)}
              placeholder=""
              options={(Object.keys(POSITION_LABELS) as MemberPosition[]).map((p) => ({ value: p, label: POSITION_LABELS[p] }))}
            />
            <div className="hint">Auto-WIP adds Review code (dev) / Smoke test (tester) to avoid repeats.</div>
          </div>
        </div>

        <div className="field">
          <label>WIP name</label>
          <input value={f.wipName} onChange={(e) => set('wipName', e.target.value)} placeholder="Nguyen Van A (A)" />
          <div className="hint">Exactly as in the &quot;Staff&apos;s name&quot; column of the WIP sheet.</div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Teamwork email</label>
            <input
              value={f.teamworkEmail}
              onChange={(e) => set('teamworkEmail', e.target.value)}
              placeholder={f.email || 'Same as email'}
            />
            <div className="hint">Only if their Teamwork login differs.</div>
          </div>
          <div className="field">
            <label>Google Chat ID</label>
            <input value={f.chatUserId} onChange={(e) => set('chatUserId', e.target.value)} placeholder="1234567890" />
            <div className="hint">For @mentions. &quot;Sync Chat IDs&quot; fills it in.</div>
          </div>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={f.autoWip} onChange={(e) => set('autoWip', e.target.checked)} />
          <span>
            <strong>Auto WIP</strong> - fill an empty evening from the morning (18:30) and an empty morning from the D1
            board (09:45)
          </span>
        </label>

        <div className="modal-actions">
          {member && (
            <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>
              Delete member
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? <Spinner sm /> : member ? 'Save' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}
