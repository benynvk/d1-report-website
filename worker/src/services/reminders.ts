import { config } from '../config';
import { todayLocal } from '../date';
import type { Member } from '../db/schema';
import * as attendance from './attendance';
import * as autoWip from './auto-wip';
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

export const jobs = {
  'wip-reminder': morningReminder,
  'wip-evening-reminder': eveningReminder,
  /** 09:45 — previous evening (catch-up) + today's morning, for members with auto-WIP on. */
  'auto-wip': (date?: string) => autoWip.morning(date),
  /** 18:30 — today's evening from the morning, for members with auto-WIP on. */
  'auto-wip-evening': (date?: string) => autoWip.evening(date),
} as const;

export type JobName = keyof typeof jobs;
