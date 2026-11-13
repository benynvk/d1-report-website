import { waitUntil } from '@vercel/functions';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { config } from './config';
import { todayLocal } from './date';
import { body, notFound, query, send, toErrorResponse } from './http';
import * as attendance from './services/attendance';
import * as autoWip from './services/auto-wip';
import * as chatWebhook from './services/chat-webhook';
import * as members from './services/members';
import * as projects from './services/projects';
import { jobs, type JobName } from './services/reminders';
import * as reports from './services/reports';
import * as stats from './services/stats';
import * as taskTypes from './services/task-types';
import * as teamwork from './services/teamwork';
import { rankTasks } from './services/auto-wip-rules';
import * as wip from './services/wip';

/** The HTTP API, mounted under /api. Handlers stay thin — logic lives in services/. */
export const api = new Hono().basePath('/api');

// The site calls the API same-origin; CORS only helps tools hitting it from elsewhere.
api.use('*', cors());
api.onError((err, c) => toErrorResponse(err, `${c.req.method} ${c.req.path}`));
api.notFound((c) => toErrorResponse(notFound(`Cannot ${c.req.method} ${c.req.path}`), ''));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const role = z.enum(['full_time', 'part_time', 'support']);

api.get('/health', () => send({ status: 'ok', time: new Date().toISOString() }));

// ---------- Projects ----------

api.get('/projects/active', async () => send(projects.publicProject(await projects.getActiveProject())));
api.get('/projects', async () => send((await projects.findAll()).map(projects.publicProject)));
api.get('/projects/:id', async (c) => send(projects.publicProject(await projects.findOne(c.req.param('id')))));
api.patch('/projects/:id', async (c) => {
  const dto = await body(
    c,
    z.object({
      name: z.string().min(1).optional(),
      chatSpaceId: z.string().optional(),
      active: z.boolean().optional(),
    }),
  );
  return send(projects.publicProject(await projects.update(c.req.param('id'), dto)));
});

// ---------- Members ----------

const memberFields = {
  chatUserId: z.string().nullish(),
  /** A base64 data URL (≤300px, resized client-side) replaces the image; '' clears it. */
  avatarUrl: z.string().nullish(),
  role: role.optional(),
  /** dev | tester — picks the filler task auto-WIP adds to avoid a repeat. */
  position: z.enum(['dev', 'tester']).optional(),
  wipName: z.string().nullish(),
  autoWip: z.boolean().optional(),
};

api.get('/members', async () => send(await members.findAll()));
api.get('/members/:id', async (c) => send(await members.findOne(c.req.param('id'))));
/** The member's open tasks on the D1 board, best first (Add report → From Teamwork). */
api.get('/members/:id/teamwork-tasks', async (c) => {
  const member = await members.findOne(c.req.param('id'));
  const ranked = rankTasks(await teamwork.listBoardTasks(), members.teamworkEmailFor(member));
  return send(ranked.slice(0, 15).map(({ id, title, url, stage, priority }) => ({ id, title, url, stage, priority })));
});
/** The member's avatar as an image. The URL carries a version, so cache it hard. */
api.get('/members/:id/avatar', async (c) => {
  const image = await members.avatarImage(c.req.param('id'));
  if (!image) throw notFound('No avatar');
  return new Response(image.bytes, {
    headers: { 'Content-Type': image.type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
});
api.post('/members', async (c) => {
  const dto = await body(
    c,
    z.object({
      ...memberFields,
      name: z.string().min(1),
      email: z.string().email(),
      teamworkEmail: z.string().email().nullish().or(z.literal('')),
    }),
  );
  return send(await members.create(dto));
});
api.patch('/members/:id', async (c) => {
  const dto = await body(
    c,
    z.object({
      ...memberFields,
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      teamworkEmail: z.string().nullish(), // '' clears
    }),
  );
  return send(await members.update(c.req.param('id'), dto));
});
api.delete('/members/:id', async (c) => send(await members.remove(c.req.param('id'))));

// ---------- Task types (no-URL allowlist) ----------

api.get('/task-types', async () => send(await taskTypes.findAll()));
api.post('/task-types', async (c) => {
  const { label } = await body(c, z.object({ label: z.string().min(1) }));
  return send(await taskTypes.create(label));
});
api.delete('/task-types/:id', async (c) => send(await taskTypes.remove(c.req.param('id'))));

// ---------- Attendance ----------

api.get('/attendance', async (c) => {
  const date = query(c, 'date');
  if (date) return send(await attendance.listForDate(date));
  return send(
    await attendance.listRange({ from: query(c, 'from'), to: query(c, 'to'), memberId: query(c, 'memberId') }),
  );
});
api.post('/attendance', async (c) => {
  const dto = await body(
    c,
    z.object({
      memberId: z.string(),
      date: isoDate,
      status: z.enum(['wfh', 'holiday', 'none']),
      /** For 'holiday': hours off (8 = full day). */
      hours: z.union([z.literal(2), z.literal(4), z.literal(8)]).optional(),
    }),
  );
  return send(await attendance.setStatus(dto.memberId, dto.date, dto.status, dto.hours));
});

// ---------- Reports ----------

api.get('/reports', async (c) => {
  // Postgres builds the JSON; pass it through untouched (cheap on CPU).
  const json = await reports.listJson({
    date: query(c, 'date'),
    from: query(c, 'from'),
    to: query(c, 'to'),
    memberId: query(c, 'memberId'),
  });
  return new Response(json, { headers: { 'Content-Type': 'application/json' } });
});
api.get('/reports/config', async () => send(await reports.reportConfig()));
api.get('/reports/resolve-title', async (c) => send({ title: await teamwork.resolveTitle(query(c, 'url') ?? null) }));
api.post('/reports/preview', async (c) => {
  const { text } = await body(c, z.object({ text: z.string().optional() }));
  return send(await reports.preview(text ?? ''));
});
api.post('/reports/import', async (c) => {
  const dto = await body(
    c,
    z.object({
      memberId: z.string().optional(),
      email: z.string().email().optional(),
      date: isoDate.optional(),
      /** Human-readable record of the submission. */
      text: z.string().min(1),
      /** The tasks actually saved — carries what the text can't (inProgress). */
      entries: z
        .array(
          z.object({
            taskName: z.string().optional(),
            href: z.string().optional(),
            hours: z.number().min(0).optional(),
            inProgress: z.boolean().optional(),
          }),
        )
        .optional(),
    }),
  );
  return send(await reports.importManual(dto));
});
api.get('/reports/:id', async (c) => send(await reports.findOne(c.req.param('id'))));
api.delete('/reports/:id', async (c) => send(await reports.remove(c.req.param('id'))));

// ---------- Stats ----------

api.get('/stats/daily', async (c) => send(await stats.dailyOverview(query(c, 'date') ?? todayLocal(config.tzOffset))));
api.get('/stats/member', async (c) =>
  send(await stats.memberTimeline(query(c, 'memberId') ?? '', query(c, 'from') ?? '', query(c, 'to') ?? '')),
);
api.get('/stats/summary', async (c) => send(await stats.summary(query(c, 'from') ?? '', query(c, 'to') ?? '')));

// ---------- Google Chat app endpoint ----------

api.post('/webhooks/google-chat', async (c) => {
  await chatWebhook.verify(c.req.header('authorization'));
  const event = await c.req.json().catch(() => ({}));
  const reply = await chatWebhook.handleEvent(event, waitUntil);
  // A returned message is posted back into the thread by Chat.
  return send(reply ?? {});
});

// ---------- WIP (Google Sheet) ----------

api.get('/wip/status', async () => send(await wip.status()));
api.get('/wip/oauth/start', (c) => c.redirect(wip.getAuthUrl(new URL(c.req.url).origin)));
api.get('/wip/oauth/callback', async (c) => {
  const origin = new URL(c.req.url).origin;
  const back = (params: string) => c.redirect(`${origin}/settings?${params}`);
  const code = query(c, 'code');
  const error = query(c, 'error');
  if (error || !code) return back(`error=${encodeURIComponent(error ?? 'missing_code')}`);
  try {
    await wip.handleCallback(code, origin);
    return back('connected=1');
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : 'oauth_failed')}`);
  }
});
api.post('/wip/disconnect', async () => send(await wip.disconnect()));
api.get('/wip/config', async () => send(await wip.listConfigs()));
api.post('/wip/config', async (c) => {
  const dto = await body(
    c,
    z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM'), spreadsheetUrl: z.string() }),
  );
  return send(await wip.upsertConfig(dto.month, dto.spreadsheetUrl));
});
api.delete('/wip/config/:id', async (c) => send(await wip.removeConfig(c.req.param('id'))));
api.get('/wip/day', async (c) => send(await wip.getDay(query(c, 'date') ?? todayLocal(config.tzOffset))));
api.get('/wip/chat-members', async () => send(await wip.listSpaceMembers()));
/**
 * What auto-WIP would write, without writing: ?job=morning|evening,
 * &date=YYYY-MM-DD (default today), &all=1 to include members who don't
 * have auto-WIP on.
 */
api.get('/wip/auto-plan', async (c) =>
  send(await autoWip.plan(query(c, 'job') === 'evening' ? 'evening' : 'morning', query(c, 'date'), query(c, 'all') === '1')),
);
/** The "Check WIP" button: runs the morning reminder now. */
api.post('/wip/check-reminder', async (c) => send(await jobs['wip-reminder'](query(c, 'date'))));

// ---------- Scheduled jobs ----------

/**
 * Runs a scheduled job — called by the external scheduler (cron-job.org, see
 * README) at fixed times; also usable by hand. GET or POST. Responds 202 at
 * once and finishes the job in the background (waitUntil), so a scheduler's
 * short timeout doesn't cut it off.
 */
const runJob = (c: Context) => {
  const name = c.req.param('job') ?? '';
  if (!(name in jobs)) throw notFound(`Unknown job: ${name}`);
  if (!config.remindersEnabled) return c.json({ skipped: name, reason: 'REMINDER_ENABLED=false' });
  waitUntil(
    jobs[name as JobName]()
      .then((result) => console.log(`Job ${name} done: ${JSON.stringify(result)}`))
      .catch((err) => console.error(`Job ${name} failed:`, err)),
  );
  return c.json({ accepted: name }, 202);
};
api.get('/cron/:job', runJob);
api.post('/cron/:job', runJob);
