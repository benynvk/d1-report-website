# d1-report

Daily workload reports for the D1 Training team — the website, its API and
its scheduled jobs, deployed together as **one Cloudflare Worker**.

```
src/            Next.js (App Router) UI, built as a static export -> out/
worker/src/     the Worker
  index.ts        entry: /api/* -> routes, Cron Triggers -> jobs, rest -> static files
  routes.ts       HTTP API (Hono); thin handlers with zod validation
  services/       the logic: reports, WIP Google Sheet, Teamwork, Chat webhook, reminders
  db/             Drizzle schema + Neon (Postgres over HTTP) client
wrangler.jsonc  Worker config: static assets, cron schedule
```

Postgres lives on [Neon](https://neon.tech) (schema `d1_report`), queried over
HTTP — no connection to open, and little CPU, which is what keeps the Worker
inside the free plan's 10 ms CPU limit per request.

## Pages
- **Daily Overview** — everyone for a day: reported / pending / on leave, utilization.
- **Reports** — browse by date range / member, add or edit a report, monthly PDF.
- **Members** — register members. Only registered emails may report.
- **WIP** — the day's WIP sheet, Google connection, per-month sheet URLs.
- **Task Types** — task types allowed without a Teamwork link.

## Scheduled jobs

Cron Triggers in `wrangler.jsonc` (UTC; Vietnam is UTC+7), Monday–Friday:

| Vietnam time | Job | What it does |
|---|---|---|
| 09:30 | `wip-reminder` | @mentions who hasn't filled this morning's WIP or the previous working day's evening WIP |
| 09:45 | `auto-wip` | fills WIP from Teamwork for members with auto-WIP on |
| 18:00 | `wip-evening-reminder` | @mentions who hasn't filled today's evening WIP |

Run one by hand: `curl -X POST https://<host>/api/cron/<job>`.
`REMINDER_ENABLED=false` turns the scheduled runs off.

## Configuration

Secrets — `npx wrangler secret put <NAME>` in production, `.dev.vars` locally
(see `.dev.vars.example`):

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `TEAMWORK_API_TOKEN` | for task names / auto-WIP | Teamwork API token |
| `GOOGLE_CHAT_WEBHOOK_URL` | for reminders | incoming webhook of the team space |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | for the WIP sheet | OAuth client; register `https://<host>/api/wip/oauth/callback` as a redirect URI |
| `GOOGLE_CHAT_PROJECT_NUMBER` | recommended | verifies that webhook calls really come from Google Chat |

Optional plain vars (defaults in `worker/src/config.ts`): `PROJECT_CODE`,
`PROJECT_NAME`, `REQUIRED_TASK_URL_PREFIX`, `REPORT_TIMEZONE_OFFSET`,
`DAILY_CAPACITY_HOURS`, `REMINDER_ENABLED`.

The Google Chat app's HTTP endpoint is `https://<host>/api/webhooks/google-chat`.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in DATABASE_URL at least
npm run preview                  # builds the site, serves site + API on http://localhost:8787
```

Working on the UI with hot reload — run the Worker and Next side by side:

```bash
npm run dev:worker                                            # API on :8787
NEXT_PUBLIC_API_URL=http://localhost:8787/api npm run dev     # UI on :3000
```

`npm test` runs the unit tests, `npm run typecheck` checks both the UI and the Worker.

## Deploy

```bash
npm run deploy     # next build && wrangler deploy
```

Or connect the repo in Cloudflare (Workers Builds) with build command
`npm run build` and deploy command `npx wrangler deploy`.

## Free-plan limits worth knowing

- **10 ms CPU per request.** List endpoints deliberately leave out avatars
  (base64 images) and `rawText`; a long date range should be aggregated in SQL
  rather than fetched whole.
- **50 outbound requests per invocation** (DB queries count). The reminders use
  about 20; `auto-wip` costs roughly 12 per member it fills.
- Ids are generated in the Worker — the tables have no `DEFAULT` on `id`.
