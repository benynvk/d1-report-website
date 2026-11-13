import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Mirrors the tables TypeORM originally created in the `d1_report` schema
 * (column names are the original camelCase ones, FKs are snake_case).
 *
 * Ids are generated here rather than by the database: the existing `id`
 * columns have no DEFAULT (TypeORM used to fill them in application code).
 */
export const d1 = pgSchema('d1_report');

export type MemberRole = 'full_time' | 'part_time' | 'support';
export type AttendanceStatus = 'wfh' | 'holiday';
export type ReportSource = 'google-chat' | 'manual';

export const projects = d1.table(
  'projects',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: varchar('name').notNull(),
    code: varchar('code').notNull(),
    chatSpaceId: varchar('chatSpaceId'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    /** OAuth refresh token of the Google account that reads/writes the WIP sheet. */
    wipGoogleRefreshToken: text('wipGoogleRefreshToken'),
    wipGoogleEmail: varchar('wipGoogleEmail'),
  },
  (t) => [uniqueIndex('UQ_d95a87318392465ab663a32cc4f').on(t.code)],
);

export const members = d1.table(
  'members',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: varchar('name').notNull(),
    email: varchar('email').notNull(),
    /** Google Chat resource name, e.g. "users/1234567890". */
    chatUserId: varchar('chatUserId'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Small (≤300px) base64 data URL. */
    avatarUrl: text('avatarUrl'),
    /** Exact "Staff's name" in column B of the WIP sheet. */
    wipName: varchar('wipName'),
    teamworkEmail: varchar('teamworkEmail'),
    autoWip: boolean('autoWip').notNull().default(false),
    role: varchar('role').$type<MemberRole>().notNull().default('full_time'),
  },
  (t) => [
    uniqueIndex('IDX_0a26c707e06435d86a7b921504').on(t.projectId, t.email),
    index('IDX_6b404f0e6c44a892e2ff5598f2').on(t.projectId),
  ],
);

export const allowedTaskTypes = d1.table(
  'allowed_task_types',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    label: varchar('label').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('IDX_150945802eb22ed995f5c3ef5c').on(t.projectId, t.label)],
);

export const dailyReports = d1.table(
  'daily_reports',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** Calendar day in the report timezone. */
    date: date('date', { mode: 'string' }).notNull(),
    rawText: text('rawText').notNull().default(''),
    source: varchar('source').$type<ReportSource>().notNull().default('manual'),
    messageId: varchar('messageId'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('IDX_52acd28e44bd7d98c5e07bc0bb').on(t.memberId, t.date),
    index('IDX_271ec7d8447773b152d5dbeb23').on(t.date),
  ],
);

export const reportEntries = d1.table(
  'report_entries',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskName: varchar('taskName').notNull(),
    hours: doublePrecision('hours').notNull().default(0),
    href: varchar('href'),
    position: integer('position').notNull().default(0),
    reportId: uuid('report_id').references(() => dailyReports.id, { onDelete: 'cascade' }),
    /** Official task name from the Teamwork API. */
    resolvedTitle: varchar('resolvedTitle'),
    inProgress: boolean('inProgress').notNull().default(false),
  },
  (t) => [index('IDX_5189040bf7e0f718524cafc9dd').on(t.reportId)],
);

export const attendances = d1.table(
  'attendances',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    date: date('date', { mode: 'string' }).notNull(),
    status: varchar('status').$type<AttendanceStatus>().notNull(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
    /** For "holiday": hours off (2/4/8). null or 8 = full day. */
    hours: integer('hours'),
  },
  (t) => [
    uniqueIndex('IDX_4dae00a2b57f002bb7e2163205').on(t.memberId, t.date),
    index('IDX_543c2dee478e080c06d4a48afa').on(t.date),
  ],
);

export const wipConfigs = d1.table(
  'wip_configs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** 'YYYY-MM' */
    month: varchar('month').notNull(),
    spreadsheetUrl: text('spreadsheetUrl').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('IDX_051f095465614d578b675eee3b').on(t.projectId, t.month)],
);

export type Project = typeof projects.$inferSelect;
export type Member = typeof members.$inferSelect;
export type TaskType = typeof allowedTaskTypes.$inferSelect;
export type DailyReportRow = typeof dailyReports.$inferSelect;
export type ReportEntry = typeof reportEntries.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type WipConfig = typeof wipConfigs.$inferSelect;
