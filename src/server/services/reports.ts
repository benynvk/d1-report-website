import { eq, sql, type SQL } from 'drizzle-orm';
import { config } from '../config';
import { isIsoDate, todayLocal } from '../date';
import { db, schema } from '../db';
import type { DailyReportRow, Member, ReportEntry, ReportSource } from '../db/schema';
import { badRequest, notFound } from '../http';
import { parseReport, type ParsedEntry } from '../parser';
import * as members from './members';
import { getActiveProjectId } from './projects';
import * as taskTypes from './task-types';
import * as teamwork from './teamwork';
import * as wip from './wip';

const { dailyReports, reportEntries } = schema;

/** A member as embedded in a report: everything but the avatar. */
export type MemberRef = Omit<Member, 'avatarUrl' | 'createdAt'> & { createdAt: string };

/**
 * A report as the API returns it: with its member and ordered entries.
 * `rawText` is stored but not returned — nothing reads it back. Timestamps
 * are ISO strings (the JSON is built by Postgres, see `loadJson`).
 */
export type DailyReport = Omit<DailyReportRow, 'memberId' | 'rawText' | 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
  member: MemberRef;
  entries: Omit<ReportEntry, 'reportId'>[];
};

/** A task plus what the text format can't carry. */
export interface UpsertEntry extends ParsedEntry {
  inProgress?: boolean;
  /** % complete when in progress (0-99). */
  progress?: number | null;
}

export interface ListFilters {
  date?: string;
  from?: string;
  to?: string;
  memberId?: string;
}

/** True when a task's link is a Teamwork URL. */
function isValidTaskUrl(href: string | null): boolean {
  return !!href && href.startsWith(config.taskUrlPrefix);
}

/**
 * Valid if it has a Teamwork URL, or its name is a configured no-URL task
 * type — alone or as "<type> - <note>" (the Add report modal's encoding).
 */
function isValidTask(entry: ParsedEntry, allowed: Set<string>): boolean {
  if (isValidTaskUrl(entry.href)) return true;
  const name = entry.taskName.trim().toLowerCase();
  if (allowed.has(name)) return true;
  for (const label of allowed) {
    if (name.startsWith(`${label} - `)) return true;
  }
  return false;
}

const ISO = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);

/**
 * Reports matching `where` (written against aliases r = daily_reports,
 * m = members), newest first, as one JSON array string built by Postgres.
 *
 * The list endpoint hands that string straight to the client, so the server
 * never materialises the rows — cheap however long the range is.
 */
async function loadJson(where: SQL): Promise<string> {
  const result = await db().execute(sql`
    select coalesce(json_agg(t.report order by t.date desc, t.created desc), '[]')::text as json
    from (
      select r.date, r."createdAt" as created,
        json_build_object(
          'id', r.id, 'date', r.date, 'source', r.source, 'messageId', r."messageId",
          'createdAt', to_char(r."createdAt", ${ISO}), 'updatedAt', to_char(r."updatedAt", ${ISO}),
          'member', json_build_object(
            'id', m.id, 'name', m.name, 'email', m.email, 'chatUserId', m."chatUserId",
            'createdAt', to_char(m."createdAt", ${ISO}), 'projectId', m.project_id,
            'wipName', m."wipName", 'teamworkEmail', m."teamworkEmail", 'autoWip', m."autoWip", 'role', m.role,
            'position', m.position),
          'entries', coalesce((
            select json_agg(json_build_object(
              'id', e.id, 'taskName', e."taskName", 'hours', e.hours, 'href', e.href, 'position', e.position,
              'resolvedTitle', e."resolvedTitle", 'inProgress', e."inProgress", 'progress', e.progress) order by e.position)
            from ${reportEntries} e where e.report_id = r.id), '[]'::json)
        ) as report
      from ${dailyReports} r join ${schema.members} m on m.id = r.member_id
      where ${where}
    ) t`);
  return (result.rows[0] as { json: string }).json;
}

const load = async (where: SQL): Promise<DailyReport[]> => JSON.parse(await loadJson(where));

export async function findOne(id: string): Promise<DailyReport> {
  const [report] = await load(sql`r.id = ${id}`);
  if (!report) throw notFound(`Report ${id} not found`);
  return report;
}

async function filterSql(filters: ListFilters): Promise<SQL> {
  const conds: SQL[] = [sql`m.project_id = ${await getActiveProjectId()}`];
  if (filters.memberId) conds.push(sql`r.member_id = ${filters.memberId}`);
  if (filters.date) conds.push(sql`r.date = ${filters.date}`);
  else {
    if (filters.from) conds.push(sql`r.date >= ${filters.from}`);
    if (filters.to) conds.push(sql`r.date <= ${filters.to}`);
  }
  return sql.join(conds, sql` and `);
}

/** Reports of the active project. */
export async function list(filters: ListFilters): Promise<DailyReport[]> {
  return load(await filterSql(filters));
}

/** `list`, as the raw JSON string — for the HTTP endpoint (see loadJson). */
export async function listJson(filters: ListFilters): Promise<string> {
  return loadJson(await filterSql(filters));
}

export async function remove(id: string): Promise<void> {
  await db().delete(dailyReports).where(eq(dailyReports.id, id));
}

/** Parse + validate without saving (drives the import UI). */
export async function preview(text: string) {
  const parsed = parseReport(text ?? '');
  const [allowed, titles] = await Promise.all([
    taskTypes.getAllowedSet(),
    teamwork.resolveMany(parsed.entries.map((e) => e.href)),
  ]);
  const entries = parsed.entries.map((e, i) => ({
    ...e,
    resolvedTitle: titles[i] ?? null,
    valid: isValidTask(e, allowed),
  }));
  return {
    entries,
    ignored: parsed.ignored,
    totalHours: parsed.totalHours,
    invalid: entries.filter((e) => !e.valid).map((e) => e.taskName),
  };
}

/** Validation rules exposed to the client. */
export async function reportConfig() {
  const types = await taskTypes.findAll();
  return { taskUrlPrefix: config.taskUrlPrefix, noUrlAllowedTasks: types.map((t) => t.label) };
}

/**
 * Creates or replaces a member's report for a day (a same-day resubmission
 * is the final EOD summary). Every task needs a Teamwork URL or an allowed
 * no-URL type, otherwise the whole report is rejected.
 */
export async function upsert(input: {
  member: Member;
  date: string;
  rawText: string;
  source: ReportSource;
  messageId?: string | null;
  /** Structured tasks (Add report modal); when set, rawText is only a record. */
  entries?: UpsertEntry[];
}): Promise<DailyReport> {
  if (!isIsoDate(input.date)) throw badRequest(`Invalid date: ${input.date}`);
  const entries: UpsertEntry[] = (input.entries ?? parseReport(input.rawText).entries).map((e) => ({
    ...e,
    href: teamwork.canonicalTaskUrl(e.href),
  }));
  if (entries.length === 0) throw badRequest('No task lines detected');

  const types = await taskTypes.findAll();
  const allowed = new Set(types.map((t) => t.label.trim().toLowerCase()));
  const invalid = entries.filter((e) => !isValidTask(e, allowed)).map((e) => e.taskName);
  if (invalid.length) {
    throw badRequest(
      `These tasks need a ${config.taskUrlPrefix} link ` +
        `(or must be one of: ${types.map((t) => t.label).join(', ')}): ${invalid.join(', ')}`,
    );
  }

  // Official task names from Teamwork (best-effort).
  const titles = await teamwork.resolveMany(entries.map((e) => e.href));

  const [report] = await db()
    .insert(dailyReports)
    .values({
      memberId: input.member.id,
      date: input.date,
      rawText: input.rawText,
      source: input.source,
      messageId: input.messageId ?? null,
    })
    .onConflictDoUpdate({
      target: [dailyReports.memberId, dailyReports.date],
      set: {
        rawText: input.rawText,
        source: input.source,
        updatedAt: new Date(),
        ...(input.messageId ? { messageId: input.messageId } : {}),
      },
    })
    .returning({ id: dailyReports.id });
  const reportId = report.id;

  // Replace the entries atomically (a batch is one transaction over HTTP).
  await db().batch([
    db().delete(reportEntries).where(eq(reportEntries.reportId, reportId)),
    db()
      .insert(reportEntries)
      .values(
        entries.map((e, i) => ({
          reportId,
          taskName: e.taskName,
          hours: e.hours,
          href: e.href,
          resolvedTitle: titles[i] ?? null,
          inProgress: e.inProgress ?? false,
          progress: e.inProgress && e.progress != null ? e.progress : null,
          position: i,
        })),
      ),
  ]);

  return findOne(reportId);
}

/**
 * Manual import (Add report modal). The member must be registered — by id
 * or email. The saved report is then mirrored into the WIP sheet; that step
 * never fails the import, it reports back how it went.
 */
export async function importManual(dto: {
  memberId?: string;
  email?: string;
  date?: string;
  text: string;
  entries?: { taskName?: string; href?: string; hours?: number; inProgress?: boolean; progress?: number | null }[];
}): Promise<DailyReport & { wipSync: wip.WipSyncResult }> {
  let member: Member | null;
  if (dto.memberId) {
    member = await members.findOne(dto.memberId);
  } else if (dto.email) {
    member = await members.findByEmail(dto.email);
    if (!member) throw badRequest(`No registered member with email ${dto.email}`);
  } else {
    throw badRequest('memberId or email is required');
  }

  const report = await upsert({
    member,
    date: dto.date ?? todayLocal(config.tzOffset),
    rawText: dto.text,
    source: 'manual',
    entries: dto.entries?.map((e) => ({
      taskName: (e.taskName ?? '').trim(),
      href: e.href?.trim() || null,
      hours: e.hours ?? 0,
      inProgress: e.inProgress ?? false,
      progress: e.progress ?? null,
    })),
  });

  let wipSync: wip.WipSyncResult;
  try {
    wipSync = await wip.syncReport(member, {
      date: report.date,
      entries: report.entries.map((e) => ({ ...e, reportId: report.id })),
    });
  } catch (err) {
    wipSync = { updated: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ...report, wipSync };
}
