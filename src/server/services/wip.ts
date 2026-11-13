import { and, desc, eq } from 'drizzle-orm';
import { config } from '../config';
import { localHour, todayLocal } from '../date';
import { db, schema } from '../db';
import type { Member, ReportEntry, WipConfig } from '../db/schema';
import { badRequest, notFound } from '../http';
import { spaceIdFromWebhookUrl } from './chat';
import * as google from './google';
import * as members from './members';
import { getActiveProject, getActiveProjectId, update as updateProject } from './projects';
import type { SheetCell } from './auto-wip-rules';
import * as teamwork from './teamwork';

const { wipConfigs } = schema;

// Read-write: chat /wip commands and report mirroring write into the sheet.
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
// Read-only: lists who's in the reminder space, to help map chatUserId.
const CHAT_MEMBERS_SCOPE = 'https://www.googleapis.com/auth/chat.memberships.readonly';
// Read-only: resolves a Chat user id to a name via the org directory.
const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/directory.readonly';

// From this hour (local time) a report about today is the day's summary
// rather than its plan — see wipColumnFor.
const EVENING_FROM_HOUR = 16;

export type WipColumn = 'morning' | 'evening';

export interface WipRow {
  team: string;
  staffName: string;
  morning: string;
  evening: string;
  memberId: string | null;
  memberName: string | null;
  avatarUrl: string | null;
}

/** Outcome of mirroring a saved report into the WIP sheet (see syncReport). */
export interface WipSyncResult {
  updated: boolean;
  column?: WipColumn;
  date?: string;
  taskCount?: number;
  /** Nothing to write, by design (part-timer, no tasks…). */
  skipped?: string;
  /** The write was attempted and failed — the report itself is still saved. */
  error?: string;
}

/** A line to render in a cell: plain text, or a hyperlink with display text. */
export interface RichLine {
  display: string;
  url?: string | null;
  /** Plain text before `display` — e.g. a "- " bullet. */
  prefix?: string;
  /** Plain text right after `display` on the same line. */
  suffix?: string;
}

type RichCell = { text: string; runs: { startIndex: number; endIndex: number; uri: string }[] };

/** Adds (or subtracts) whole months to a 'YYYY-MM' string. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- OAuth ----------

/** The OAuth redirect URI — must be registered on the Google OAuth client. */
export function redirectUriFor(origin: string): string {
  return config.googleRedirectUri || `${origin}/api/wip/oauth/callback`;
}

export async function status(): Promise<{ connected: boolean; email: string | null }> {
  const project = await getActiveProject();
  return { connected: !!project.wipGoogleRefreshToken, email: project.wipGoogleEmail };
}

export function getAuthUrl(origin: string): string {
  return google.authUrl(redirectUriFor(origin), [
    SHEETS_SCOPE,
    CHAT_MEMBERS_SCOPE,
    DIRECTORY_SCOPE,
    'openid',
    'email',
  ]);
}

/** Exchanges the OAuth code for tokens and stores the refresh token. */
export async function handleCallback(code: string, origin: string): Promise<void> {
  const { refreshToken, email } = await google.exchangeCode(code, redirectUriFor(origin));
  if (!refreshToken) {
    throw badRequest(
      'Google did not return a refresh token. Revoke the app at ' +
        'https://myaccount.google.com/permissions and try connecting again.',
    );
  }
  const project = await getActiveProject();
  await updateProject(project.id, { wipGoogleRefreshToken: refreshToken, wipGoogleEmail: email });
}

export async function disconnect(): Promise<void> {
  const project = await getActiveProject();
  await updateProject(project.id, { wipGoogleRefreshToken: null, wipGoogleEmail: null });
}

/** A Google access token for the account connected on the WIP page. */
async function authorizedToken(): Promise<string> {
  const project = await getActiveProject();
  if (!project.wipGoogleRefreshToken) throw badRequest('Google Sheets is not connected yet');
  return google.accessTokenFor(project.wipGoogleRefreshToken);
}

// ---------- Config (month -> sheet URL) ----------

export function extractSpreadsheetId(url: string): string {
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  if (!match) throw badRequest('Not a valid Google Sheets URL');
  return match[1];
}

export async function listConfigs(): Promise<WipConfig[]> {
  const projectId = await getActiveProjectId();
  return db().query.wipConfigs.findMany({
    where: eq(wipConfigs.projectId, projectId),
    orderBy: desc(wipConfigs.month),
  });
}

async function configFor(month: string): Promise<WipConfig | undefined> {
  const projectId = await getActiveProjectId();
  return db().query.wipConfigs.findFirst({
    where: and(eq(wipConfigs.month, month), eq(wipConfigs.projectId, projectId)),
  });
}

export async function upsertConfig(month: string, spreadsheetUrl: string): Promise<WipConfig> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('month must be YYYY-MM');
  extractSpreadsheetId(spreadsheetUrl); // validates the URL
  const projectId = await getActiveProjectId();
  const [saved] = await db()
    .insert(wipConfigs)
    .values({ projectId, month, spreadsheetUrl })
    .onConflictDoUpdate({ target: [wipConfigs.projectId, wipConfigs.month], set: { spreadsheetUrl } })
    .returning();
  return saved;
}

export async function removeConfig(id: string): Promise<void> {
  const deleted = await db().delete(wipConfigs).where(eq(wipConfigs.id, id)).returning({ id: wipConfigs.id });
  if (deleted.length === 0) throw notFound(`WIP config ${id} not found`);
}

// ---------- Sheets API ----------

/** Raw values of a tab (A1:D200); [] when the tab doesn't exist. */
async function fetchValues(token: string, spreadsheetId: string, tabName: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${tabName}'!A1:D200`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 400 || res.status === 404) return []; // no tab for this day
  if (!res.ok) {
    console.warn(`Sheets API ${res.status}: ${await res.text().catch(() => '')}`);
    throw badRequest(`Google Sheets API error (${res.status})`);
  }
  const data: any = await res.json();
  return data.values ?? [];
}

/** Every tab's {sheetId, title}. */
async function listTabs(token: string, spreadsheetId: string): Promise<{ sheetId: number; title: string }[]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    // 404 is also what Google returns for a sheet the account can't see.
    throw badRequest(
      `Could not open the spreadsheet (HTTP ${res.status}). Check the URL, ` +
        `and that the sheet is shared with the connected Google account.`,
    );
  }
  const data: any = await res.json();
  return (data.sheets ?? []).map((s: any) => ({
    sheetId: s.properties?.sheetId,
    title: String(s.properties?.title ?? ''),
  }));
}

/** The tab for a day — named "4" in some months and "04" in others. */
function tabForDay(titles: string[], day: number): string | null {
  const plain = String(day);
  return titles.find((t) => t.trim() === plain) ?? titles.find((t) => Number(t.trim()) === day) ?? null;
}

/** Index of the header row (column B starts with "Staff's name"), or -1. */
function findHeaderIndex(values: string[][]): number {
  return values.findIndex((row) => (row[1] ?? '').trim().toLowerCase().startsWith("staff's name"));
}

function extractDataRows(values: string[][]): string[][] {
  const headerIdx = findHeaderIndex(values);
  if (headerIdx === -1) return [];
  return values.slice(headerIdx + 1).filter((row) => (row[1] ?? '').trim().length > 0);
}

/** Row index (0-based, into the tab's values) of a staff name, or -1. */
function findStaffRow(values: string[][], wipName: string): number {
  const headerIdx = findHeaderIndex(values);
  if (headerIdx === -1) return -1;
  const wanted = wipName.trim().toLowerCase();
  for (let i = headerIdx + 1; i < values.length; i++) {
    if ((values[i][1] ?? '').trim().toLowerCase() === wanted) return i;
  }
  return -1;
}

type Tab = { sheetId: number; title: string };
type DayLocation = { spreadsheetId: string; titles: string[]; tab: Tab | null };

/**
 * One unit of sheet work (a request, a cron job): reuses the access token,
 * month configs, tab lists and tab values instead of re-fetching them for
 * every member — a whole-team job makes about ten outbound requests. Writes made through it update the
 * cached values, so later reads in the same session see them.
 */
export class SheetSession {
  #token?: Promise<string>;
  #configs = new Map<string, Promise<WipConfig | undefined>>();
  #tabs = new Map<string, Promise<Tab[]>>();
  #values = new Map<string, string[][]>();

  token(): Promise<string> {
    return (this.#token ??= authorizedToken());
  }

  config(month: string): Promise<WipConfig | undefined> {
    let c = this.#configs.get(month);
    if (!c) this.#configs.set(month, (c = configFor(month)));
    return c;
  }

  async tabs(spreadsheetId: string): Promise<Tab[]> {
    let t = this.#tabs.get(spreadsheetId);
    if (!t) this.#tabs.set(spreadsheetId, (t = this.token().then((token) => listTabs(token, spreadsheetId))));
    return t;
  }

  /** Where a day lives; null when its month has no sheet configured. */
  async locate(dateIso: string): Promise<DayLocation | null> {
    const cfg = await this.config(dateIso.slice(0, 7));
    if (!cfg) return null;
    const spreadsheetId = extractSpreadsheetId(cfg.spreadsheetUrl);
    const tabs = await this.tabs(spreadsheetId);
    const titles = tabs.map((t) => t.title);
    const title = tabForDay(titles, Number(dateIso.slice(8, 10)));
    return { spreadsheetId, titles, tab: tabs.find((t) => t.title === title) ?? null };
  }

  #key(spreadsheetId: string, tab: string) {
    return `${spreadsheetId}\u0000${tab}`;
  }

  /** A day tab's values (A1:D200); [] when the day has no tab. */
  async values(dateIso: string): Promise<string[][]> {
    const loc = await this.locate(dateIso);
    if (!loc?.tab) return [];
    const key = this.#key(loc.spreadsheetId, loc.tab.title);
    let v = this.#values.get(key);
    if (!v) this.#values.set(key, (v = await fetchValues(await this.token(), loc.spreadsheetId, loc.tab.title)));
    return v;
  }

  /** Loads several days' values with one request per spreadsheet. */
  async prefetch(dates: string[]): Promise<void> {
    const wanted = new Map<string, string[]>(); // spreadsheetId -> tab titles
    for (const d of dates) {
      const loc = await this.locate(d);
      if (!loc?.tab || this.#values.has(this.#key(loc.spreadsheetId, loc.tab.title))) continue;
      const list = wanted.get(loc.spreadsheetId) ?? [];
      if (!list.includes(loc.tab.title)) list.push(loc.tab.title);
      wanted.set(loc.spreadsheetId, list);
    }
    const token = await this.token();
    await Promise.all(
      [...wanted].map(async ([spreadsheetId, titles]) => {
        const ranges = titles.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:D200`)}`).join('&');
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${ranges}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          console.warn(`Sheets batchGet ${res.status}: ${await res.text().catch(() => '')}`);
          throw badRequest(`Google Sheets API error (${res.status})`);
        }
        const data: any = await res.json();
        titles.forEach((t, i) => this.#values.set(this.#key(spreadsheetId, t), data.valueRanges?.[i]?.values ?? []));
      }),
    );
  }

  /**
   * One column of a day tab with its formatting (links), keyed by lowercased
   * staff name — needed to copy a cell without losing its task links.
   */
  async richColumn(dateIso: string, column: WipColumn): Promise<Map<string, SheetCell>> {
    const loc = await this.locate(dateIso);
    const out = new Map<string, SheetCell>();
    if (!loc?.tab) return out;
    const col = column === 'morning' ? 'C' : 'D';
    const range = encodeURIComponent(`'${loc.tab.title}'!B1:${col}200`);
    const fields = encodeURIComponent(
      'sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(startIndex,format(link(uri)))))))',
    );
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${loc.spreadsheetId}?ranges=${range}&fields=${fields}`,
      { headers: { Authorization: `Bearer ${await this.token()}` } },
    );
    if (!res.ok) {
      console.warn(`Sheets get ${res.status}: ${await res.text().catch(() => '')}`);
      throw badRequest(`Google Sheets API error (${res.status})`);
    }
    const data: any = await res.json();
    for (const row of data.sheets?.[0]?.data?.[0]?.rowData ?? []) {
      const cells: SheetCell[] = row.values ?? [];
      const name = (cells[0]?.formattedValue ?? '').trim().toLowerCase();
      // B..C is two cells, B..D three — the wanted column is the last one.
      if (name) out.set(name, cells[col === 'C' ? 1 : 2] ?? {});
    }
    return out;
  }

  /** Records a write in the cached values. */
  remember(dateIso: string, loc: DayLocation, rowIndex: number, columnIndex: number, text: string, wipName: string) {
    if (!loc.tab) return;
    const v = this.#values.get(this.#key(loc.spreadsheetId, loc.tab.title));
    if (!v) return;
    while (v.length <= rowIndex) v.push([]);
    const row = v[rowIndex];
    while (row.length <= columnIndex) row.push('');
    row[1] ||= wipName;
    row[columnIndex] = text;
  }
}

// ---------- Reading a day ----------

/**
 * The WIP rows for a date, matched to members by `wipName`.
 * `configured: false` when no sheet is set up for that month.
 */
export async function getDay(
  dateIso: string,
  session = new SheetSession(),
): Promise<{
  date: string;
  tabName: string;
  configured: boolean;
  rows: WipRow[];
  /** Only when the day's tab yielded nothing: the sheet's real tab names. */
  availableTabs?: string[];
}> {
  const day = String(Number(dateIso.slice(8, 10)));
  const loc = await session.locate(dateIso);
  if (!loc) return { date: dateIso, tabName: day, configured: false, rows: [] };
  const values = await session.values(dateIso);
  const tabName = loc.tab?.title ?? day;
  // Nothing under the day: show what the sheet does contain, so a naming
  // mismatch isn't mistaken for a weekend.
  const availableTabs = values.length === 0 ? loc.titles : undefined;

  const all = await members.findAll();
  const byWipName = new Map(all.filter((m) => m.wipName).map((m) => [m.wipName!.trim().toLowerCase(), m]));
  const rows: WipRow[] = extractDataRows(values).map((r) => {
    const staffName = (r[1] ?? '').trim();
    const member = byWipName.get(staffName.toLowerCase()) ?? null;
    return {
      team: (r[0] ?? '').trim(),
      staffName,
      morning: r[2] ?? '',
      evening: r[3] ?? '',
      memberId: member?.id ?? null,
      memberName: member?.name ?? null,
      avatarUrl: member?.avatarUrl ?? null,
    };
  });
  return { date: dateIso, tabName, configured: true, rows, availableTabs };
}

/** A member's own Morning/Evening text for a day ('' when absent). */
export async function memberCell(
  dateIso: string,
  wipName: string,
  column: WipColumn,
  session: SheetSession,
): Promise<string> {
  const values = await session.values(dateIso);
  const row = findStaffRow(values, wipName);
  return row === -1 ? '' : (values[row][column === 'morning' ? 2 : 3] ?? '');
}

/**
 * Members (with a wipName) who haven't filled `period` for a date. [] when
 * the month has no sheet configured — nothing to check against.
 */
export async function membersMissingEntry(
  dateIso: string,
  period: WipColumn,
  session = new SheetSession(),
): Promise<Member[]> {
  const day = await getDay(dateIso, session);
  if (!day.configured) return [];
  const filledIds = new Set(
    day.rows
      .filter((r) => (period === 'morning' ? r.morning : r.evening).trim() !== '')
      .map((r) => r.memberId)
      .filter((id): id is string => !!id),
  );
  return (await members.findAll()).filter((m) => m.wipName && !filledIds.has(m.id));
}

/**
 * The nearest day before/after `dateIso` that has a day tab in the WIP sheet
 * (skipping weekends/holidays without one), crossing into the adjacent
 * month's sheet at a month boundary.
 */
export async function adjacentWipDay(
  dateIso: string,
  direction: 1 | -1,
  session = new SheetSession(),
): Promise<string> {
  let month = dateIso.slice(0, 7);
  const startDay = Number(dateIso.slice(8, 10));

  for (let hop = 0; hop < 24; hop++) {
    const cfg = await session.config(month);
    if (!cfg) throw badRequest(`No WIP sheet configured for ${month}.`);
    const tabs = await session.tabs(extractSpreadsheetId(cfg.spreadsheetUrl));
    const dayNumbers = tabs.map((t) => Number(t.title)).filter((n) => Number.isInteger(n) && n > 0);
    const candidates =
      hop === 0
        ? dayNumbers.filter((n) => (direction === 1 ? n > startDay : n < startDay))
        : dayNumbers; // adjacent month: its first/last tab outright
    if (candidates.length) {
      const picked = direction === 1 ? Math.min(...candidates) : Math.max(...candidates);
      return `${month}-${String(picked).padStart(2, '0')}`;
    }
    month = shiftMonth(month, direction);
  }
  throw badRequest('Could not find an adjacent WIP day.');
}

// ---------- Writing ----------

function buildRichCell(items: RichLine[]): RichCell {
  const outLines: string[] = [];
  const runs: RichCell['runs'] = [];
  let offset = 0;
  for (const item of items) {
    const prefix = item.prefix ?? '';
    if (item.url) {
      // The link covers `display` only, so a bullet prefix stays plain.
      runs.push({
        startIndex: offset + prefix.length,
        endIndex: offset + prefix.length + item.display.length,
        uri: item.url,
      });
    }
    const line = `${prefix}${item.display}${item.suffix ?? ''}`;
    outLines.push(line);
    offset += line.length + 1; // +1 for the joining '\n'
  }
  return { text: outLines.join('\n'), runs };
}

/** Rich text + hyperlink runs into one cell via batchUpdate. */
async function writeRichCell(
  token: string,
  spreadsheetId: string,
  sheetId: number,
  rowIndex: number, // 0-based
  columnIndex: number, // 0-based
  rich: RichCell,
): Promise<void> {
  const textFormatRuns = rich.runs.length
    ? rich.runs.flatMap((r, i) => {
        const next = rich.runs[i + 1];
        const startRun = { startIndex: r.startIndex, format: { link: { uri: r.uri } } };
        // A closing run at/past the end of the string (rejected: startIndex
        // must be < length) or touching the next run (redundant) is omitted.
        const needsClosingRun = r.endIndex < rich.text.length && !(next && next.startIndex === r.endIndex);
        return needsClosingRun ? [startRun, { startIndex: r.endIndex, format: {} }] : [startRun];
      })
    : rich.text.length
      ? [{ startIndex: 0, format: {} }]
      : []; // an empty cell has nowhere to put a run

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          updateCells: {
            rows: [{ values: [{ userEnteredValue: { stringValue: rich.text }, textFormatRuns }] }],
            fields: 'userEnteredValue,textFormatRuns',
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    console.warn(`Sheets batchUpdate ${res.status}: ${await res.text().catch(() => '')}`);
    throw badRequest(`Could not write to the sheet (${res.status}).`);
  }
}

/**
 * Finds (or appends) the member's row in the day's tab and overwrites the
 * Morning (C) or Evening (D) cell with rich text.
 */
async function writeToRow(
  dateIso: string,
  member: Member,
  column: WipColumn,
  rich: RichCell,
  session: SheetSession,
): Promise<{ created: boolean }> {
  if (!member.wipName) {
    throw badRequest('No WIP name set for this member - ask a leader to set it in Members.');
  }
  const loc = await session.locate(dateIso);
  if (!loc) throw badRequest(`No WIP sheet configured for ${dateIso.slice(0, 7)}.`);
  if (!loc.tab) throw badRequest(`There is no "${Number(dateIso.slice(8, 10))}" tab in this month's sheet yet.`);
  const tab = loc.tab;
  const values = await session.values(dateIso);
  if (findHeaderIndex(values) === -1) throw badRequest(`The "${tab.title}" tab isn't set up in this month's sheet yet.`);

  const token = await session.token();
  const columnIndex = column === 'morning' ? 2 : 3; // C / D
  const targetRow = findStaffRow(values, member.wipName);
  let created = false;
  let sheetRow1Based: number;

  if (targetRow === -1) {
    // No row yet today — append a plain one, then overwrite the cell richly.
    const newRow =
      column === 'morning' ? ['', member.wipName, rich.text, ''] : ['', member.wipName, '', rich.text];
    const range = encodeURIComponent(`'${tab.title}'!A1:D1`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${loc.spreadsheetId}/values/${range}:append` +
        '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [newRow] }),
      },
    );
    if (!res.ok) {
      console.warn(`Sheets append ${res.status}: ${await res.text().catch(() => '')}`);
      throw badRequest(`Could not write to the sheet (${res.status}).`);
    }
    const data: any = await res.json();
    // updatedRange looks like "'1'!A5:D5" — row 5, 1-based.
    const rowMatch = /![A-Za-z]+(\d+):/.exec(data?.updates?.updatedRange ?? '');
    if (!rowMatch) throw badRequest('Could not determine the newly added row.');
    sheetRow1Based = Number(rowMatch[1]);
    created = true;
  } else {
    sheetRow1Based = targetRow + 1;
  }

  await writeRichCell(token, loc.spreadsheetId, tab.sheetId, sheetRow1Based - 1, columnIndex, rich);
  session.remember(dateIso, loc, sheetRow1Based - 1, columnIndex, rich.text, member.wipName);
  return { created };
}

export function writeRichLines(
  dateIso: string,
  member: Member,
  column: WipColumn,
  lines: RichLine[],
  session = new SheetSession(),
): Promise<{ created: boolean }> {
  return writeToRow(dateIso, member, column, buildRichCell(lines), session);
}

/**
 * Free-typed chat content ("/wip -m"): bare-URL lines get their Teamwork
 * title resolved, other lines stay plain. Leading bullets are stripped.
 */
export async function writeEntry(
  dateIso: string,
  member: Member,
  column: WipColumn,
  content: string,
): Promise<{ created: boolean }> {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  const rich = await Promise.all(
    lines.map(async (line): Promise<RichLine> => {
      if (/^https?:\/\/\S+$/i.test(line)) {
        const url = teamwork.canonicalTaskUrl(line)!;
        return { display: (await teamwork.resolveTitle(url)) ?? url, url };
      }
      return { display: line };
    }),
  );
  return writeRichLines(dateIso, member, column, rich);
}

/**
 * Which column a report for `dateIso` belongs to, by the clock: today before
 * 16:00 is the day's plan (Morning); from 16:00, or any earlier date, it's
 * the day's account (Evening); a future date is a plan.
 */
function wipColumnFor(dateIso: string): WipColumn {
  const today = todayLocal(config.tzOffset);
  if (dateIso > today) return 'morning';
  if (dateIso < today) return 'evening';
  return localHour(new Date(), config.tzOffset) < EVENING_FROM_HOUR ? 'morning' : 'evening';
}

/**
 * Mirrors a just-saved report into the WIP sheet: Morning gets the task
 * list, Evening gets "task (2h) => Done/In progress". Full-time members with
 * a WIP name only. Never throws — the report is already saved.
 */
export async function syncReport(
  member: Member,
  report: { date: string; entries: ReportEntry[] },
): Promise<WipSyncResult> {
  if (member.role !== 'full_time') return { updated: false, skipped: 'only full-time members are mirrored' };
  if (!member.wipName) return { updated: false, skipped: 'no WIP name set for this member' };
  const tasks = report.entries;
  if (tasks.length === 0) return { updated: false, skipped: 'the report has no tasks' };

  const column = wipColumnFor(report.date);
  const lines: RichLine[] = tasks.map((e) => ({
    // An "Other" task shows just its note: "Other - Check DNS records" -> "Check DNS records".
    display:
      e.resolvedTitle?.trim() ||
      (e.href ? '' : e.taskName?.trim().replace(/^other\s+-\s+/i, '')) ||
      e.taskName?.trim() ||
      e.href?.trim() ||
      'Task',
    url: e.href,
    prefix: tasks.length > 1 ? '- ' : undefined, // a lone task reads better unbulleted
    suffix:
      column === 'evening'
        ? `${e.hours ? ` (${Math.round(e.hours * 100) / 100}h)` : ''}` +
          // Only Teamwork tasks get a status — a meeting is nothing you finish.
          (e.href ? ` => ${e.inProgress ? 'In progress' : 'Done'}` : '')
        : undefined,
  }));

  try {
    await writeRichLines(report.date, member, column, lines);
    return { updated: true, column, date: report.date, taskCount: lines.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`syncReport failed for ${member.name} (${column} ${report.date}): ${error}`);
    return { updated: false, column, date: report.date, error };
  }
}

// ---------- Chat member lookup (to help map Member.chatUserId) ----------

/** Human members of the reminder space, with names from the org directory. */
export async function listSpaceMembers(): Promise<{ chatUserId: string; displayName: string; email: string | null }[]> {
  const spaceId = spaceIdFromWebhookUrl();
  if (!spaceId) throw badRequest('GOOGLE_CHAT_WEBHOOK_URL is not set or has no space id.');
  const token = await authorizedToken();

  const results: { chatUserId: string; displayName: string; email: string | null }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://chat.googleapis.com/v1/spaces/${spaceId}/members`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.warn(`Chat members.list ${res.status}: ${await res.text().catch(() => '')}`);
      throw badRequest(`Could not list space members (${res.status}).`);
    }
    const data: any = await res.json();
    for (const m of data.memberships ?? []) {
      if (m.member?.type !== 'HUMAN' || !m.member?.name) continue;
      results.push({ chatUserId: m.member.name, displayName: m.member.displayName ?? '', email: null });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // The Chat API doesn't return names/emails at this permission level.
  await Promise.all(
    results.map(async (r) => {
      const info = await resolveDirectoryPerson(token, r.chatUserId);
      r.displayName = info?.name ?? r.displayName;
      r.email = info?.email ?? null;
    }),
  );
  return results;
}

async function resolveDirectoryPerson(
  token: string,
  chatUserId: string,
): Promise<{ name: string | null; email: string | null } | null> {
  const id = chatUserId.replace(/^users\//, '');
  try {
    const res = await fetch(
      `https://people.googleapis.com/v1/people/${id}?personFields=names,emailAddresses` +
        '&sources=READ_SOURCE_TYPE_PROFILE&sources=READ_SOURCE_TYPE_CONTACT&sources=READ_SOURCE_TYPE_DOMAIN_CONTACT',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.warn(`Directory lookup ${res.status} for ${chatUserId}`);
      return null;
    }
    const data: any = await res.json();
    return {
      name: data.names?.[0]?.displayName ?? null,
      email: data.emailAddresses?.[0]?.value ?? null,
    };
  } catch (err) {
    console.warn(`Directory lookup failed for ${chatUserId}: ${err}`);
    return null;
  }
}
