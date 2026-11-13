import { and, asc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db';
import type { Member, MemberPosition, MemberRole } from '../db/schema';
import { conflict, notFound } from '../http';
import { getActiveProjectId } from './projects';

const { members } = schema;

function normalizeEmail(email?: string | null): string | null {
  return email?.trim().toLowerCase() || null;
}

/** Accepts a bare numeric id or "users/123..." and always stores the latter. */
function normalizeChatUserId(raw?: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('users/') ? trimmed : `users/${trimmed}`;
}

/**
 * Avatars are stored as base64 data URLs but never travel inside JSON: a
 * member's `avatarUrl` is the URL of GET /api/members/:id/avatar, which the
 * browser caches. `?v=` changes when the image does — far lighter than
 * shipping base64 images inside every list.
 */
const { avatarUrl: _stored, ...plainColumns } = getTableColumns(members);
const memberColumns = {
  ...plainColumns,
  avatarVersion: sql<string | null>`left(md5(${members.avatarUrl}), 8)`,
};

function withAvatarUrl<T extends { id: string; avatarVersion: string | null }>(
  row: T,
): Omit<T, 'avatarVersion'> & { avatarUrl: string | null } {
  const { avatarVersion, ...rest } = row;
  return {
    ...rest,
    avatarUrl: avatarVersion ? `/api/members/${row.id}/avatar?v=${avatarVersion}` : null,
  };
}

async function select(where: SQL | undefined): Promise<Member[]> {
  const rows = await db().select(memberColumns).from(members).where(where).orderBy(asc(members.name));
  return rows.map(withAvatarUrl);
}

export async function findAll(): Promise<Member[]> {
  return select(eq(members.projectId, await getActiveProjectId()));
}

export async function findOne(id: string): Promise<Member> {
  const [member] = await select(eq(members.id, id));
  if (!member) throw notFound(`Member ${id} not found`);
  return member;
}

/** A member of the active project by email. */
export async function findByEmail(email: string): Promise<Member | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const projectId = await getActiveProjectId();
  const [member] = await select(and(eq(members.email, normalized), eq(members.projectId, projectId)));
  return member ?? null;
}

/** The stored avatar as image bytes, or null when the member has none. */
export async function avatarImage(id: string): Promise<{ type: string; bytes: ArrayBuffer } | null> {
  const [row] = await db().select({ avatarUrl: members.avatarUrl }).from(members).where(eq(members.id, id));
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(row?.avatarUrl ?? '');
  if (!match) return null;
  return { type: match[1], bytes: Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0)).buffer };
}

/**
 * What to store for an incoming `avatarUrl`: a data URL replaces the image,
 * ''/null clears it, and anything else (e.g. the served URL echoed back by a
 * client) leaves it untouched.
 */
function avatarPatch(value: string | null | undefined): { avatarUrl?: string | null } {
  if (value === undefined) return {};
  if (!value) return { avatarUrl: null };
  return value.startsWith('data:image/') ? { avatarUrl: value } : {};
}

export interface MemberInput {
  name?: string;
  email?: string;
  chatUserId?: string | null;
  avatarUrl?: string | null;
  role?: MemberRole;
  position?: MemberPosition;
  wipName?: string | null;
  teamworkEmail?: string | null;
  autoWip?: boolean;
}

export async function create(data: MemberInput & { name: string; email: string }): Promise<Member> {
  const email = normalizeEmail(data.email);
  if (!email) throw conflict('Email is required');
  if (await findByEmail(email)) throw conflict(`Member with email ${email} already exists`);
  const [created] = await db()
    .insert(members)
    .values({
      projectId: await getActiveProjectId(),
      name: data.name,
      email,
      chatUserId: normalizeChatUserId(data.chatUserId),
      ...avatarPatch(data.avatarUrl),
      role: data.role ?? 'full_time',
      position: data.position ?? 'dev',
      wipName: data.wipName?.trim() || null,
      teamworkEmail: normalizeEmail(data.teamworkEmail),
      autoWip: data.autoWip ?? false,
    })
    .returning({ id: members.id });
  return findOne(created.id);
}

export async function update(id: string, data: MemberInput): Promise<Member> {
  const member = await findOne(id);
  const patch: Partial<Member> = {};
  if (data.email !== undefined) {
    const email = normalizeEmail(data.email);
    if (!email) throw conflict('Email is required');
    const clash = await findByEmail(email);
    if (clash && clash.id !== id) throw conflict(`Email ${email} already in use`);
    patch.email = email;
  }
  if (data.name !== undefined) patch.name = data.name;
  if (data.chatUserId !== undefined) patch.chatUserId = normalizeChatUserId(data.chatUserId);
  Object.assign(patch, avatarPatch(data.avatarUrl));
  if (data.role !== undefined) patch.role = data.role;
  if (data.position !== undefined) patch.position = data.position;
  if (data.wipName !== undefined) patch.wipName = data.wipName?.trim() || null;
  if (data.teamworkEmail !== undefined) patch.teamworkEmail = normalizeEmail(data.teamworkEmail);
  if (data.autoWip !== undefined) patch.autoWip = data.autoWip;
  if (Object.keys(patch).length === 0) return member;
  await db().update(members).set(patch).where(eq(members.id, id));
  return findOne(id);
}

/** Reports and attendance cascade-delete via their FKs. */
export async function remove(id: string): Promise<void> {
  await findOne(id);
  await db().delete(members).where(eq(members.id, id));
}

/** The email to look this member up by in Teamwork. */
export function teamworkEmailFor(member: Member): string {
  return member.teamworkEmail || member.email;
}

/**
 * The registered member a Chat sender may report as, or null when the email
 * is missing/unregistered (the caller then blocks them). Learns the sender's
 * Chat user id on first contact so reminders can @mention them.
 */
export async function authorizeChatSender(identity: {
  email?: string | null;
  chatUserId?: string | null;
}): Promise<Member | null> {
  const member = await findByEmail(identity.email ?? '');
  if (!member) return null;
  const chatUserId = identity.chatUserId?.trim() || null;
  if (chatUserId && !member.chatUserId) {
    await db().update(members).set({ chatUserId }).where(eq(members.id, member.id));
    member.chatUserId = chatUserId;
  }
  return member;
}
