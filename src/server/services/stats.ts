import { config } from '../config';
import type { AttendanceStatus, MemberRole } from '../db/schema';
import * as attendance from './attendance';
import * as members from './members';
import * as reports from './reports';

export interface MemberDayStat {
  memberId: string;
  memberName: string;
  avatarUrl: string | null;
  role: MemberRole;
  status: AttendanceStatus | null; // null = normal office day
  holidayHours: number | null; // 'holiday': 2/4/8 (null = full day, legacy)
  reported: boolean;
  totalHours: number;
  taskCount: number;
  utilization: number; // totalHours / capacity
  entries: {
    taskName: string;
    hours: number;
    href: string | null;
    resolvedTitle: string | null;
    inProgress: boolean;
  }[];
}

const sumHours = (r: reports.DailyReport) => r.entries.reduce((s, e) => s + e.hours, 0);

/** Off the *full* day, as opposed to a partial-day leave. */
const isFullyOff = (m: MemberDayStat) =>
  m.status === 'holiday' && (m.holidayHours == null || m.holidayHours >= 8);

/** Everyone's status for one day: reported or not, attendance, utilization. */
export async function dailyOverview(date: string) {
  const [allMembers, dayReports, statusMap] = await Promise.all([
    members.findAll(),
    reports.list({ date }),
    attendance.mapForDate(date),
  ]);
  const reportByMember = new Map(dayReports.map((r) => [r.member.id, r]));
  const capacity = config.dailyCapacity;

  const list: MemberDayStat[] = allMembers.map((m) => {
    const report = reportByMember.get(m.id);
    const totalHours = report ? sumHours(report) : 0;
    const att = statusMap.get(m.id);
    return {
      memberId: m.id,
      memberName: m.name,
      avatarUrl: m.avatarUrl ?? null,
      role: m.role,
      status: att?.status ?? null,
      holidayHours: att?.hours ?? null,
      reported: !!report,
      totalHours,
      taskCount: report?.entries.length ?? 0,
      utilization: capacity ? totalHours / capacity : 0,
      entries: (report?.entries ?? []).map((e) => ({
        taskName: e.taskName,
        hours: e.hours,
        href: e.href,
        resolvedTitle: e.resolvedTitle ?? null,
        inProgress: e.inProgress ?? false,
      })),
    };
  });

  // Reported (desc hours), then pending, then full-day leave.
  const rank = (m: MemberDayStat) => (isFullyOff(m) ? 2 : m.reported ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b) || b.totalHours - a.totalHours);

  return {
    date,
    capacity,
    memberCount: list.length,
    reportedCount: list.filter((m) => m.reported).length,
    pendingCount: list.filter((m) => !m.reported && !isFullyOff(m) && m.role !== 'support').length,
    onLeaveCount: list.filter((m) => m.status === 'holiday').length,
    totalHours: list.reduce((s, m) => s + m.totalHours, 0),
    members: list,
  };
}

/** One member's per-day totals over a range. */
export async function memberTimeline(memberId: string, from: string, to: string) {
  const days = (await reports.list({ memberId, from, to }))
    .map((r) => ({ date: r.date, totalHours: sumHours(r), taskCount: r.entries.length }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { memberId, from, to, totalHours: days.reduce((s, d) => s + d.totalHours, 0), days };
}

/** Per-member totals over a range. */
export async function summary(from: string, to: string) {
  const map = new Map<
    string,
    { memberName: string; avatarUrl: string | null; totalHours: number; taskCount: number; daysReported: number }
  >();
  const [rangeReports, allMembers] = await Promise.all([reports.list({ from, to }), members.findAll()]);
  const avatars = new Map(allMembers.map((m) => [m.id, m.avatarUrl]));
  for (const r of rangeReports) {
    const agg = map.get(r.member.id) ?? {
      memberName: r.member.name,
      avatarUrl: avatars.get(r.member.id) ?? null,
      totalHours: 0,
      taskCount: 0,
      daysReported: 0,
    };
    agg.totalHours += sumHours(r);
    agg.taskCount += r.entries.length;
    agg.daysReported += 1;
    map.set(r.member.id, agg);
  }
  const list = [...map.entries()]
    .map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => b.totalHours - a.totalHours);
  return { from, to, members: list };
}
