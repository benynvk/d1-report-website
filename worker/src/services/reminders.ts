import { config } from '../config';
import { todayLocal } from '../date';
import type { Member } from '../db/schema';
import * as attendance from './attendance';
import { mentionList, postToSpace } from './chat';
import * as members from './members';
import * as wip from './wip';

/**
 * Scheduled jobs, run by the Worker's Cron Triggers (see worker/index.ts);
 * also reachable at POST /api/cron/<job> for a manual run.
 */

/** membersMissingEntry, but [] (with a warning) on error. */
async function safeMissingEntry(dateIso: string, period: wip.WipColumn): Promise<Member[]> {
  try {
    return await wip.membersMissingEntry(dateIso, period);
  } catch (err) {
    console.warn(`Could not check WIP ${period} entries for ${dateIso}: ${err}`);
    return [];
  }
}

/** Drops support members and anyone off the full day. */
async function chaseable(list: Member[], dateIso: string): Promise<Member[]> {
  const holidays = await attendance.holidayMemberIds(dateIso);
  return list.filter((m) => m.role !== 'support' && !holidays.has(m.id));
}

const mentions = (list: Member[]) =>
  mentionList(list.map((m) => ({ name: m.name, chatUserId: m.chatUserId })));

/**
 * 09:30 — who hasn't filled this morning's WIP, or the previous working
 * day's evening WIP (a second chance after the 18:00 nudge).
 */
export async function morningReminder(date?: string) {
  const today = date ?? todayLocal(config.tzOffset);
  const missingToday = await chaseable(await safeMissingEntry(today, 'morning'), today);

  let missingPrevEvening: Member[] = [];
  try {
    const prevDay = await wip.adjacentWipDay(today, -1);
    missingPrevEvening = await chaseable(await safeMissingEntry(prevDay, 'evening'), prevDay);
  } catch (err) {
    console.warn(`Could not resolve the previous WIP day for ${today}: ${err}`);
  }

  if (missingToday.length || missingPrevEvening.length) {
    const lines: string[] = [];
    if (missingPrevEvening.length) lines.push(`🌙 Chưa WIP chiều hôm qua: ${mentions(missingPrevEvening)}`);
    if (missingToday.length) lines.push(`☀️ Chưa WIP sáng nay: ${mentions(missingToday)}`);
    await postToSpace(lines.join('\n'));
  }
  return {
    date: today,
    missingToday: missingToday.map((m) => m.name),
    missingPrevEvening: missingPrevEvening.map((m) => m.name),
  };
}

/** 18:00 — who hasn't filled today's evening WIP yet. */
export async function eveningReminder(date?: string) {
  const today = date ?? todayLocal(config.tzOffset);
  const missingEvening = await chaseable(await safeMissingEntry(today, 'evening'), today);
  if (missingEvening.length) await postToSpace(`🌙 Chưa WIP chiều nay: ${mentions(missingEvening)}`);
  return { date: today, missingEvening: missingEvening.map((m) => m.name) };
}

/**
 * 09:45 — for members with `autoWip`, fills the previous working day's
 * evening WIP and today's morning WIP from their assigned Teamwork tasks,
 * where still empty. Skips full-day leave.
 */
export async function autoWip(date?: string) {
  const today = date ?? todayLocal(config.tzOffset);
  const autoMembers = (await members.findAll()).filter((m) => m.autoWip);
  const filled: string[] = [];
  if (autoMembers.length === 0) return { date: today, filled };

  const fillMissing = async (dateIso: string, column: wip.WipColumn) => {
    let missing: Member[];
    try {
      missing = await wip.membersMissingEntry(dateIso, column);
    } catch (err) {
      console.warn(`Auto WIP: could not check ${column} entries for ${dateIso}: ${err}`);
      return;
    }
    const autoIds = new Set(autoMembers.map((m) => m.id));
    const holidays = await attendance.holidayMemberIds(dateIso);
    for (const member of missing.filter((m) => autoIds.has(m.id) && !holidays.has(m.id))) {
      try {
        const tasks = await wip.pickAutoTasks(member);
        if (tasks.length === 0) continue;
        await wip.writeAutoTasks(dateIso, member, tasks, column);
        filled.push(`${member.name} ${column} ${dateIso}`);
      } catch (err) {
        console.warn(`Auto WIP failed for ${member.name} (${column} ${dateIso}): ${err}`);
      }
    }
  };

  try {
    await fillMissing(await wip.adjacentWipDay(today, -1), 'evening');
  } catch (err) {
    console.warn(`Auto WIP: could not resolve the previous WIP day for ${today}: ${err}`);
  }
  await fillMissing(today, 'morning');
  return { date: today, filled };
}

export const jobs = {
  'wip-reminder': morningReminder,
  'wip-evening-reminder': eveningReminder,
  'auto-wip': autoWip,
} as const;

export type JobName = keyof typeof jobs;
