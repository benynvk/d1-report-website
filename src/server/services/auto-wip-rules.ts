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

/**
 * What was done on a linked task (its report "Detail"), rotated per working
 * day so the same task doesn't get the same note day after day.
 */
export const WORK_NOTES: Record<MemberPosition, string[]> = {
  dev: [
    'Analyze requirements',
    'Design database schema',
    'Implement API endpoints',
    'Build UI components',
    'Integrate API with frontend',
    'Fix bugs from feedback',
    'Handle edge cases and validation',
    'Write unit tests',
    'Refactor and optimize code',
    'Address code review comments',
  ],
  tester: [
    'Analyze requirements',
    'Write test cases',
    'Prepare test data',
    'Execute functional tests',
    'Test API endpoints',
    'Log and report bugs',
    'Retest fixed bugs',
    'Run regression tests',
    'Check UI on different devices',
    'Update test report',
  ],
};

/** Working days (Mon-Fri) since 1970; a weekend counts as the next Monday. */
function workingDayIndex(dateIso: string): number {
  const d = Math.floor(Date.parse(`${dateIso}T00:00:00Z`) / 86_400_000) + 3; // 0 = a Monday
  return Math.floor(d / 7) * 5 + Math.min(((d % 7) + 7) % 7, 5);
}

/**
 * `count` distinct notes for one member's report on `date`. Each working day
 * shifts the rotation by 3, so up to 3 tasks never repeat the previous
 * working day's notes; the member seed keeps teammates out of lockstep.
 */
export function workNotes(position: MemberPosition, date: string, seed: string, count: number): string[] {
  const list = WORK_NOTES[position] ?? WORK_NOTES.dev;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const offset = (workingDayIndex(date) * 3 + h) % list.length;
  return Array.from({ length: Math.min(count, list.length) }, (_, i) => list[(offset + i) % list.length]);
}

// ---------- Evening hours ----------

/** Total hours an evening auto-WIP logs: 7.3-7.9h, or 8.0-8.5h one time in five. */
export const DAY_HOURS = { min: 7.3, max: 8.5, longFrom: 8, longShare: 0.2 };

/** A random day total, in 0.1h steps (see DAY_HOURS), less any partial leave. */
export function randomDayHours(leaveHours = 0, rand: () => number = Math.random): number {
  const { min, max, longFrom, longShare } = DAY_HOURS;
  const [lo, hi] = rand() < longShare ? [longFrom, max] : [min, longFrom - 0.1];
  const tenths = Math.round(lo * 10) + Math.floor(rand() * (Math.round((hi - lo) * 10) + 1));
  return Math.max(0, tenths - Math.round(leaveHours * 10)) / 10;
}

/** Splits `total` over `n` tasks at random, 0.1h steps, at least 0.5h each when it fits. */
export function splitHours(total: number, n: number, rand: () => number = Math.random): number[] {
  if (n <= 0) return [];
  const all = Math.round(total * 10);
  const floor = Math.min(5, Math.floor(all / n));
  const spare = all - floor * n;
  const weights = Array.from({ length: n }, () => 0.3 + rand());
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => floor + Math.floor((spare * w) / sum));
  for (let left = all - parts.reduce((a, b) => a + b, 0); left > 0; left--) parts[Math.floor(rand() * n)]++;
  return parts.map((t) => t / 10);
}

/**
 * % complete for a task still in progress tonight: up 10-25% on its last
 * in-progress report, else 20-60%; multiples of 5, at most 95.
 */
export function nextProgress(previous: number | null | undefined, rand: () => number = Math.random): number {
  const step = (lo: number, hi: number) => lo + 5 * Math.floor(rand() * ((hi - lo) / 5 + 1));
  return previous != null ? Math.min(95, Math.max(previous, 0) + step(10, 25)) : step(20, 60);
}

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
 * The evening entry made from a morning one: the same tasks (links kept),
 * each marked " => In progress" — a line that already has a "=>" status keeps it,
 * and an "Other - " prefix is dropped.
 */
export function eveningFromMorning(morning: CellLine[]): CellLine[] {
  return morning
    .filter((l) => l.display.trim())
    .map((l) => {
      const hasStatus = /=>/.test(`${l.display}${l.suffix ?? ''}`);
      return {
        // An "Other" task shows just its description (older cells still carry the prefix).
        display: l.url ? l.display : l.display.replace(/^other\s+-\s+/i, '') || l.display,
        url: l.url ?? null,
        suffix: hasStatus ? l.suffix : `${l.suffix ?? ''}${EVENING_STATUS}`,
      };
    });
}

// ---------- Cell -> report entries ----------

export interface AutoReportEntry {
  taskName: string;
  href: string | null;
  hours: number;
  inProgress: boolean;
  progress: number | null;
}

/**
 * The report tasks behind a written WIP cell, so the system keeps the same
 * record as the sheet. A linked line is that Teamwork task; a plain line is
 * a task type when it names one, else an "Other - <text>" task (dropped when
 * the project has no "Other" type). No hours: auto-WIP doesn't know them.
 */
export function entriesFromLines(lines: CellLine[], allowedTypes: Set<string>): AutoReportEntry[] {
  const out: AutoReportEntry[] = [];
  let droppedHours = 0;
  for (const l of lines) {
    const whole = `${l.display}${l.suffix ?? ''}`;
    const inProgress = /=>\s*in progress/i.test(whole);
    const pct = /=>\s*in progress\s*\((\d{1,2})%\)/i.exec(whole);
    const progress = inProgress && pct ? Number(pct[1]) : null;
    const name = l.display.replace(/\s*=>.*$/, '').trim();
    if (!name) continue;
    const { note, hours } = splitSuffix(l.suffix);
    const entry = { hours, inProgress, progress };
    if (l.url) {
      out.push({ taskName: note || name, href: l.url, ...entry });
      continue;
    }
    const bare = name.replace(/^other\s+-\s+/i, '');
    if (allowedTypes.has(bare.toLowerCase())) out.push({ taskName: bare, href: null, ...entry });
    else if (allowedTypes.has('other')) out.push({ taskName: `Other - ${bare}`, href: null, ...entry });
    else droppedHours += hours;
  }
  // A line the project can't record still counts toward the day: its time
  // goes to the longest task, so the report adds up to the cell.
  if (droppedHours && out.length) {
    const top = out.reduce((a, b) => (b.hours > a.hours ? b : a));
    top.hours = Math.round((top.hours + droppedHours) * 10) / 10;
  }
  return out;
}

/**
 * A line's suffix as written by annotateLines / the report mirror:
 * ": <note> (<hours>h) => <status>", every part optional.
 */
export function splitSuffix(suffix: string | undefined): { note: string; hours: number; status: string } {
  let rest = suffix ?? '';
  const arrow = rest.indexOf('=>');
  const status = arrow === -1 ? '' : ` ${rest.slice(arrow).trim()}`;
  if (arrow !== -1) rest = rest.slice(0, arrow);
  let hours = 0;
  rest = rest.replace(/\s*\((\d+(?:\.\d+)?)h\)\s*$/i, (_, h: string) => {
    hours = Number(h);
    return '';
  });
  const note = rest.replace(/^\s*:\s*/, '').trim();
  return { note, hours, status };
}

/**
 * Adds what was done (and, in the evening, how long and how far) to each
 * line, in the report mirror's format: "- Task: <note> (<h>h) => In progress (<p>%)".
 * A linked line keeps a note it already has (one typed in the morning), else
 * takes the next of `notes`; `hours` (one per line) replaces any hours there;
 * `progress(i)` gives the % for an in-progress line that has none yet.
 */
export function annotateLines(
  lines: CellLine[],
  notes: string[],
  hours?: number[],
  progress?: (i: number) => number,
): CellLine[] {
  let next = 0;
  return lines.map((l, i) => {
    const cur = splitSuffix(l.suffix);
    const note = l.url ? cur.note || notes[next++] || '' : cur.note;
    const h = hours ? hours[i] : cur.hours;
    const status =
      progress && /^\s*=>\s*in progress\s*$/i.test(cur.status) ? ` => In progress (${progress(i)}%)` : cur.status;
    const suffix = `${note ? `: ${note}` : ''}${h ? ` (${Math.round(h * 100) / 100}h)` : ''}${status}`;
    return { ...l, suffix: suffix || undefined };
  });
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
