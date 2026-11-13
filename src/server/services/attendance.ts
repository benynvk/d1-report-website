import { and, asc, between, eq, getTableColumns, type SQL } from 'drizzle-orm';
import { isIsoDate } from '../date';
import { db, schema } from '../db';
import type { Attendance, AttendanceStatus, Member } from '../db/schema';
import { badRequest } from '../http';
import { findOne as findMember } from './members';
import { getActiveProjectId } from './projects';

const { attendances, members } = schema;

/** The member is embedded without its avatar (see reports.MemberRef). */
export type AttendanceWithMember = Omit<Attendance, 'memberId'> & { member: Omit<Member, 'avatarUrl'> };

const { avatarUrl: _avatar, ...memberRefColumns } = getTableColumns(members);

async function list(extra: SQL[]): Promise<AttendanceWithMember[]> {
  const projectId = await getActiveProjectId();
  const rows = await db()
    .select({ a: attendances, m: memberRefColumns })
    .from(attendances)
    .innerJoin(members, eq(attendances.memberId, members.id))
    .where(and(eq(members.projectId, projectId), ...extra))
    .orderBy(asc(attendances.date), asc(members.name));
  return rows.map(({ a, m }) => {
    const { memberId: _id, ...rest } = a;
    return { ...rest, member: m };
  });
}

/** All attendance rows for a date in the active project. */
export function listForDate(date: string): Promise<AttendanceWithMember[]> {
  if (!isIsoDate(date)) throw badRequest(`Invalid date: ${date}`);
  return list([eq(attendances.date, date)]);
}

/** Attendance rows across a date range, optionally for one member. */
export function listRange(filters: { from?: string; to?: string; memberId?: string }) {
  const extra: SQL[] = [];
  if (filters.memberId) extra.push(eq(attendances.memberId, filters.memberId));
  if (filters.from && filters.to) extra.push(between(attendances.date, filters.from, filters.to));
  return list(extra);
}

/** memberId -> {status, hours} for a date. */
export async function mapForDate(
  date: string,
): Promise<Map<string, { status: AttendanceStatus; hours: number | null }>> {
  const rows = await listForDate(date);
  return new Map(rows.map((r) => [r.member.id, { status: r.status, hours: r.hours }]));
}

/** Members off the *full* day (hours null or ≥8) — reminders skip them. */
export async function holidayMemberIds(date: string): Promise<Set<string>> {
  const rows = await listForDate(date);
  return new Set(
    rows
      .filter((r) => r.status === 'holiday' && (r.hours == null || r.hours >= 8))
      .map((r) => r.member.id),
  );
}

/**
 * Sets (or clears with 'none') a member's status for a day. `hours` only
 * applies to 'holiday' and defaults to 8 (full day).
 */
export async function setStatus(
  memberId: string,
  date: string,
  status: AttendanceStatus | 'none',
  hours?: number,
): Promise<AttendanceWithMember | null> {
  if (!isIsoDate(date)) throw badRequest(`Invalid date: ${date}`);
  const member = await findMember(memberId);
  const where = and(eq(attendances.memberId, member.id), eq(attendances.date, date));

  if (status === 'none') {
    await db().delete(attendances).where(where);
    return null;
  }
  const resolvedHours = status === 'holiday' ? (hours ?? 8) : null;
  const [row] = await db()
    .insert(attendances)
    .values({ memberId: member.id, date, status, hours: resolvedHours })
    .onConflictDoUpdate({
      target: [attendances.memberId, attendances.date],
      set: { status, hours: resolvedHours, updatedAt: new Date() },
    })
    .returning();
  const { memberId: _id, ...rest } = row;
  const { avatarUrl: _a, ...memberRef } = member;
  return { ...rest, member: memberRef };
}
