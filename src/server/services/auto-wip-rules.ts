/**
 * Pure rules behind auto-WIP — no I/O, so they're unit-tested on their own
 * (auto-wip-rules.test.ts). The orchestration lives in auto-wip.ts.
 */

/** A line of a WIP cell: plain text, or a link with text around it. */
export interface CellLine {
  display: string;
  url?: string | null;
  prefix?: string;
  suffix?: string;
}

export type MemberPosition = 'dev' | 'tester';

/** What a member adds when every ordering of their tasks was already used. */
export const FILLER_TASK: Record<MemberPosition, string> = {
  dev: 'Review code',
  tester: 'Smoke test',
};

/** Most auto-picked Teamwork tasks for a morning WIP. */
export const MAX_PICKED_TASKS = 2;

// ---------- Rendering / comparing cells ----------

/** Lines -> cell text the way every WIP writer does it: bulleted when > 1 line. */
export function renderLines(lines: CellLine[]): CellLine[] {
  const bullet = lines.length > 1 ? '- ' : '';
  return lines.map((l) => ({ ...l, prefix: bullet }));
}

export function cellText(lines: CellLine[]): string {
  return lines.map((l) => `${l.prefix ?? ''}${l.display}${l.suffix ?? ''}`).join('\n');
}

/** How two cells are compared: case, spacing and bullet style don't count. */
export function normalizeCell(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
    .join('\n');
}

/** Every ordering of up to 4 items (24); beyond that, the rotations. */
function orderings<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  if (items.length > 4) return items.map((_, i) => [...items.slice(i), ...items.slice(0, i)]);
  return items.flatMap((first, i) =>
    orderings([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [first, ...rest]),
  );
}

export interface UniqueResult {
  lines: CellLine[];
  /** How the content was changed to avoid a repeat. */
  change: 'none' | 'reordered' | 'filler' | 'still-duplicate';
}

/**
 * Makes a cell that matches none of `history` (normalized cell texts of the
 * last 7 days): as is if possible, else reordered, else with the member's
 * filler task added (in any order). If nothing works, the original is kept.
 */
export function makeUnique(lines: CellLine[], history: Set<string>, filler: string): UniqueResult {
  const isNew = (candidate: CellLine[]) => !history.has(normalizeCell(cellText(renderLines(candidate))));
  const orders = orderings(lines);
  if (isNew(orders[0])) return { lines: renderLines(orders[0]), change: 'none' };
  const reordered = orders.slice(1).find(isNew);
  if (reordered) return { lines: renderLines(reordered), change: 'reordered' };

  const hasFiller = lines.some((l) => normalizeCell(l.display) === normalizeCell(filler));
  if (!hasFiller) {
    const withFiller = orderings([...lines, { display: filler }]).find(isNew);
    if (withFiller) return { lines: renderLines(withFiller), change: 'filler' };
  }
  return { lines: renderLines(lines), change: 'still-duplicate' };
}

// ---------- Morning -> evening ----------

const EVENING_STATUS = ' => In progress';

/**
 * The evening entry made from a morning one: same tasks (links kept), each
 * Teamwork task marked " => In progress" like a hand-written evening WIP.
 */
export function eveningFromMorning(morning: CellLine[]): CellLine[] {
  return morning
    .map((l) => ({
      display: l.display,
      url: l.url ?? null,
      suffix: l.url && !/=>/.test(l.suffix ?? '') ? `${l.suffix ?? ''}${EVENING_STATUS}` : l.suffix,
    }))
    .filter((l) => l.display.trim());
}

// ---------- Reading a rich cell ----------

/** A cell as the Sheets API returns it with grid data. */
export interface SheetCell {
  formattedValue?: string;
  hyperlink?: string;
  textFormatRuns?: { startIndex?: number; format?: { link?: { uri?: string } } }[];
}

/**
 * Splits a cell into lines, keeping each line's link (the run that starts
 * inside it) and dropping the bullet, so it can be re-rendered.
 */
export function parseCell(cell: SheetCell | undefined): CellLine[] {
  const text = cell?.formattedValue ?? '';
  if (!text.trim()) return [];
  const runs = (cell?.textFormatRuns ?? []).map((r) => ({ start: r.startIndex ?? 0, uri: r.format?.link?.uri ?? null }));
  const out: CellLine[] = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    const lineStart = offset;
    const lineEnd = offset + raw.length;
    offset = lineEnd + 1;
    const bullet = /^\s*(?:[-*•–]|\d+[.)])\s+/.exec(raw)?.[0] ?? '';
    const body = raw.slice(bullet.length);
    if (!body.trim()) continue;

    const i = runs.findIndex((r) => r.uri && r.start >= lineStart && r.start < lineEnd);
    if (i === -1) {
      // A whole-cell hyperlink on a one-line cell is that line's link.
      const url = text.indexOf('\n') === -1 ? (cell?.hyperlink ?? null) : null;
      out.push({ display: body.trim(), url });
      continue;
    }
    const linkStart = Math.max(runs[i].start - lineStart, bullet.length);
    const linkEnd = Math.min(i + 1 < runs.length ? runs[i + 1].start - lineStart : raw.length, raw.length);
    out.push({
      prefix: raw.slice(bullet.length, linkStart) || undefined,
      display: raw.slice(linkStart, linkEnd),
      url: runs[i].uri,
      suffix: raw.slice(linkEnd) || undefined,
    });
  }
  return out;
}

// ---------- Picking Teamwork tasks ----------

export interface BoardTask {
  id: number;
  title: string;
  url: string;
  /** Board column name; null when the task sits in the backlog. */
  stage: string | null;
  priority: string | null;
  assigneeEmails: string[];
}

/** 0 = In progress / Ready for QA, 1 = Ready to start/for dev, 2 = anything else, null = skip. */
export function stageTier(stage: string | null): number | null {
  const s = (stage ?? '').toLowerCase();
  if (/\bdone\b|deployed/.test(s) && !/done local/.test(s)) return null; // finished work
  if (s.includes('progress') || s.includes('qa')) return 0;
  if (s.includes('ready to start') || s.includes('ready for dev')) return 1;
  return 2;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Every open board task assigned to `email`, best first: by column tier
 * (In progress/QA, Ready to start, the rest) then priority. Finished
 * columns (Done/Deployed) are left out.
 */
export function rankTasks(tasks: BoardTask[], email: string): (BoardTask & { tier: number })[] {
  return tasks
    .filter((t) => t.assigneeEmails.some((e) => e.toLowerCase() === email.toLowerCase()))
    .map((t, order) => ({ t, order, tier: stageTier(t.stage) }))
    .filter((x): x is { t: BoardTask; order: number; tier: number } => x.tier !== null)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (PRIORITY_RANK[a.t.priority ?? ''] ?? 3) - (PRIORITY_RANK[b.t.priority ?? ''] ?? 3) ||
        a.order - b.order,
    )
    .map((x) => ({ ...x.t, tier: x.tier }));
}

/**
 * The member's D1 tasks for a morning WIP: only the best non-empty tier
 * (In progress/QA, else Ready to start, else any assigned), highest
 * priority first, at most MAX_PICKED_TASKS.
 */
export function pickTasks(tasks: BoardTask[], email: string): BoardTask[] {
  const ranked = rankTasks(tasks, email);
  if (ranked.length === 0) return [];
  return ranked
    .filter((t) => t.tier === ranked[0].tier)
    .slice(0, MAX_PICKED_TASKS)
    .map(({ tier: _tier, ...t }) => t);
}

// ---------- Dates ----------

/** 'YYYY-MM-DD' shifted by whole days. */
export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The duplicate-check window: the 7 calendar days before `dateIso`, and the day itself. */
export function historyWindow(dateIso: string): string[] {
  return Array.from({ length: 8 }, (_, i) => addDays(dateIso, i - 7));
}
