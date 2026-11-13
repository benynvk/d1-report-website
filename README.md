# d1-report

Daily workload reports for the D1 Training team — the website, its API and
its scheduled jobs in one Next.js app, deployed on **Vercel**, with Postgres
on **Neon** (Singapore, schema `d1_report`).

```
src/app/               pages (client-rendered) + api/[[...route]] -> the API
src/server/            the API
  routes.ts              HTTP routes (Hono), zod validation
  services/              reports, WIP Google Sheet, Teamwork, Chat webhook,
                         reminders, auto-WIP
  db/                    Drizzle schema + Neon (Postgres over HTTP) client
migrations/            SQL changes, applied by hand to Neon (see below)
vercel.json            functions run in sin1 (Singapore), next to the DB
```

## Pages
- **Daily Overview** — everyone for a day: reported / pending / on leave, utilization.
- **Reports** — browse by date range / member, add or edit a report, monthly PDF.
- **Members** — register members (only registered emails may report); WIP name,
  Teamwork email, auto-WIP, role, position (dev / tester).
- **WIP** — the day's WIP sheet, Google connection, per-month sheet URLs.
- **Task Types** — task types allowed without a Teamwork link.

## Scheduled jobs

Vercel's cron on the Hobby plan runs once a day at an imprecise time, so the
jobs are triggered by an external scheduler ([cron-job.org](https://cron-job.org),
free) calling `https://<host>/api/cron/<job>` (GET or POST; answers 202 and
finishes in the background). Timezone **Asia/Ho_Chi_Minh**, Monday–Friday:

| Time | Job | What it does |
|---|---|---|
| 09:30 | `wip-reminder` | @mentions who hasn't filled this morning's WIP or the previous working day's evening WIP |
| 09:45 and 09:59 | `auto-wip` | for members with auto-WIP on: previous working day's empty evening ← its morning; today's empty morning ← up to 2 tasks from the D1 board |
| 18:00 | `wip-evening-reminder` | @mentions who hasn't filled today's evening WIP |
| 18:30 and 18:45 | `auto-wip-evening` | for members with auto-WIP on: today's empty evening ← today's morning |

The second auto-WIP run is a safety net: it only fills cells that are still
empty. Auto-WIP never repeats an entry from the last 7 calendar days — it
reorders the tasks, or adds "Review code" (dev) / "Smoke test" (tester).
Preview without writing: `GET /api/wip/auto-plan?job=morning|evening&date=YYYY-MM-DD&all=1`.
`REMINDER_ENABLED=false` turns every job off.

## Configuration

Environment variables (Vercel → Project Settings → Environment Variables;
`.env.local` locally — see `.env.example`):

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `TEAMWORK_API_TOKEN` | for task names / auto-WIP | Teamwork API token |
| `GOOGLE_CHAT_WEBHOOK_URL` | for reminders | incoming webhook of the team space |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | for the WIP sheet | OAuth client; register `https://<host>/api/wip/oauth/callback` as a redirect URI |
| `GOOGLE_CHAT_PROJECT_NUMBER` | recommended | verifies that webhook calls really come from Google Chat |

Optional (defaults in `src/server/config.ts`): `PROJECT_CODE`, `PROJECT_NAME`,
`REQUIRED_TASK_URL_PREFIX`, `TEAMWORK_PROJECT_ID` (D1 = 708697),
`REPORT_TIMEZONE_OFFSET`, `DAILY_CAPACITY_HOURS`, `REMINDER_ENABLED`.

The Google Chat app's HTTP endpoint is `https://<host>/api/webhooks/google-chat`.

## Database changes

The tables already exist (created by the original API). Changes go in
`migrations/NNNN_*.sql` and are run once against Neon (SQL editor, or
`psql "$DATABASE_URL" -f migrations/NNNN_*.sql`). Re-copying the schema from
elsewhere drops them — re-run every migration afterwards.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL at least
npm run dev                  # site + API on http://localhost:3000
```

`npm test` runs the unit tests, `npm run typecheck` the type check.

## Deploy

Import the repo in Vercel (framework preset: Next.js, defaults otherwise), set
the environment variables, deploy. Then point the Google OAuth redirect URI,
the Chat app endpoint and the cron-job.org jobs at the Vercel host.

The old Cloudflare Pages project (`d1-report-website.pages.dev`) only
redirects here: its build command `npm run build:pages` writes a `_redirects`
file — the target is in `scripts/pages-redirect.mjs`.
