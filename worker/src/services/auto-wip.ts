import { config } from '../config';
import { todayLocal } from '../date';
import type { Member } from '../db/schema';
import * as attendance from './attendance';
import {
  type BoardTask,
  type CellLine,
  type SheetCell,
  FILLER_TASK,
  type UniqueResult,
  cellText,
  eveningFromMorning,
  historyWindow,
  makeUnique,
  normalizeCell,
  parseCell,
  pickTasks,
} from './auto-wip-rules';
import * as members from './members';
import * as teamwork from './teamwork';
import * as wip from './wip';

/**
 * Auto-WIP: fills a member's empty WIP cell so it's never left blank.
 *
 *  - Evening (18:30, and as a catch-up at 09:45 the next working day): a copy
 *    of that day's morning entry, Teamwork tasks marked "=> In progress".
 *  - Morning (09:45): up to 2 of the member's tasks on the D1 board, by
 *    column (In progress / Ready for QA > Ready to start > any other) then
 *    priority.
 *
 * Either way the entry must differ from every WIP entry of the member in the
 * last 7 calendar days: reordered if needed, else with "Review code" (dev) /
 * "Smoke test" (tester) added. The rules themselves are in auto-wip-rules.ts.
 */

export interface AutoWipItem {
  member: string;
  date: string;
  column: wip.WipColumn;
  action: 'written' | 'planned' | 'skipped' | 'failed';
  /** Where the content came from. */
  source?: 'morning' | 'board' | 'filler';
  /** How it was changed to avoid repeating a recent entry. */
  change?: UniqueResult['change'];
  text?: string;
  reason?: string;
}

interface RunOptions {
  /** Plan only: report what would be written, write nothing. */
  dryRun?: boolean;
  /** Overwrite a cell that already has content ("/wip -a -f"). */
  force?: boolean;
  /** Skip members who are off the whole day (true for the scheduled jobs). */
  skipLeave?: boolean;
}

/** Shared by every member in one run: one sheet session, one board fetch. */
class Run {
  readonly session = new wip.SheetSession();
  #board?: Promise<BoardTask[]>;
  #morningCells = new Map<string, Promise<Map<string, SheetCell>>>();

  constructor(readonly opts: RunOptions) {}

  board(): Promise<BoardTask[]> {
    return (this.#board ??= teamwork.listBoardTasks());
  }

  morningCells(date: string) {
    let m = this.#morningCells.get(date);
    if (!m) this.#morningCells.set(date, (m = this.session.richColumn(date, 'morning')));
    return m;
  }
}

/** The member's WIP texts across the 7-day window, except the cell being filled. */
async function history(run: Run, member: Member, date: string, column: wip.WipColumn): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const day of historyWindow(date)) {
    for (const col of ['morning', 'evening'] as const) {
      if (day === date && col === column) continue;
      const text = await wip.memberCell(day, member.wipName!, col, run.session);
      if (text.trim()) seen.add(normalizeCell(text));
    }
  }
  return seen;
}

/** The member's best D1 board tasks as cell lines. */
async function boardLines(run: Run, member: Member): Promise<CellLine[]> {
  const picked = pickTasks(await run.board(), members.teamworkEmailFor(member));
  return picked.map((t) => ({ display: t.title, url: t.url }));
}

/** Fills one column of one day for the given members. */
async function fillDay(
  run: Run,
  date: string,
  column: wip.WipColumn,
  targets: Member[],
): Promise<AutoWipItem[]> {
  const base = { date, column };
  const loc = await run.session.locate(date);
  if (!loc?.tab) {
    const reason = loc ? 'no tab for this day in the WIP sheet' : 'no WIP sheet configured for this month';
    return targets.map((m) => ({ ...base, member: m.name, action: 'skipped', reason }));
  }
  await run.session.prefetch(historyWindow(date)); // one request per spreadsheet
  const onLeave = run.opts.skipLeave ? await attendance.holidayMemberIds(date) : new Set<string>();

  const out: AutoWipItem[] = [];
  for (const member of targets) {
    const item = { ...base, member: member.name };
    try {
      if (!member.wipName) {
        out.push({ ...item, action: 'skipped', reason: 'no WIP name set' });
        continue;
      }
      if (onLeave.has(member.id)) {
        out.push({ ...item, action: 'skipped', reason: 'on leave' });
        continue;
      }
      const current = await wip.memberCell(date, member.wipName, column, run.session);
      if (current.trim() && !run.opts.force) {
        out.push({ ...item, action: 'skipped', reason: 'already filled' });
        continue;
      }

      let lines: CellLine[] = [];
      let source: AutoWipItem['source'];
      if (column === 'evening') {
        const morning = parseCell((await run.morningCells(date)).get(member.wipName.trim().toLowerCase()));
        if (morning.length) {
          lines = eveningFromMorning(morning);
          source = 'morning';
        }
      }
      if (!lines.length) {
        const picked = await boardLines(run, member);
        if (picked.length) {
          lines = column === 'evening' ? eveningFromMorning(picked) : picked;
          source = 'board';
        }
      }
      const filler = FILLER_TASK[member.position ?? 'dev'];
      if (!lines.length) {
        // Nothing assigned on the board: the filler beats an empty cell.
        lines = [{ display: filler }];
        source = 'filler';
      }

      const unique = makeUnique(lines, await history(run, member, date, column), filler);
      const text = cellText(unique.lines);
      if (!run.opts.dryRun) await wip.writeRichLines(date, member, column, unique.lines, run.session);
      out.push({ ...item, action: run.opts.dryRun ? 'planned' : 'written', source, change: unique.change, text });
    } catch (err) {
      out.push({ ...item, action: 'failed', reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

async function previousWipDay(run: Run, today: string): Promise<string | null> {
  try {
    return await wip.adjacentWipDay(today, -1, run.session);
  } catch (err) {
    console.warn(`Auto WIP: no previous WIP day before ${today}: ${err}`);
    return null;
  }
}

const autoMembers = async () => (await members.findAll()).filter((m) => m.autoWip);

/** 18:30 — today's evening WIP, from the morning. */
export async function evening(date?: string, opts: RunOptions = { skipLeave: true }, targets?: Member[]) {
  const run = new Run(opts);
  const day = date ?? todayLocal(config.tzOffset);
  const list = targets ?? (await autoMembers());
  return { date: day, items: list.length ? await fillDay(run, day, 'evening', list) : [] };
}

/** 09:45 — catch up the previous working day's evening, then today's morning from the board. */
export async function morning(date?: string, opts: RunOptions = { skipLeave: true }, targets?: Member[]) {
  const run = new Run(opts);
  const today = date ?? todayLocal(config.tzOffset);
  const list = targets ?? (await autoMembers());
  if (!list.length) return { date: today, items: [] as AutoWipItem[] };
  const items: AutoWipItem[] = [];
  const prev = await previousWipDay(run, today);
  if (prev) items.push(...(await fillDay(run, prev, 'evening', list)));
  items.push(...(await fillDay(run, today, 'morning', list)));
  return { date: today, items };
}

/** "/wip -a": the 09:45 fill for one member, on demand (no leave check). */
export function forMember(member: Member, today: string, force: boolean) {
  return morning(today, { force }, [member]);
}

/**
 * What a job would write right now, without writing (GET /api/wip/auto-plan).
 * `everyone` includes members who don't have auto-WIP turned on.
 */
export async function plan(job: 'morning' | 'evening', date: string | undefined, everyone: boolean) {
  const targets = everyone
    ? (await members.findAll()).filter((m) => m.wipName && m.role !== 'support')
    : undefined;
  const opts = { dryRun: true, skipLeave: true };
  return job === 'evening' ? evening(date, opts, targets) : morning(date, opts, targets);
}
