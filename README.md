# d1-report-web

Next.js (App Router) frontend for the D1 Training daily workload reports. It is a
fully static build that talks to the NestJS API via `NEXT_PUBLIC_API_URL`, so it
deploys to Cloudflare Pages with no server runtime.

## Pages
- **Daily Overview** — all members for a day: reported / pending / on-leave,
  utilization, and WFH / Holiday toggles per member.
- **Reports** — browse submitted reports by date range / member.
- **Import** — paste an end-of-day message; live preview validates that each
  task has a Teamwork link (or is an allowed no-link type) before saving.
- **Summary** — total hours per member over a range.
- **Members** — register members (full name + email). Only registered emails
  may report.
- **Task Types** — manage the task types allowed without a Teamwork link.

## Run locally

```bash
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm install
npm run dev                    # http://localhost:3000
```

Make sure the API (`d1-report-api`) is running on port 4000.

## Deploy to Cloudflare Pages

This app uses `output: 'export'` — `next build` emits a static site to `out/`.

- **Build command:** `npm run build`
- **Output directory:** `out`
- **Environment variable:** `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com/api`

`NEXT_PUBLIC_API_URL` is inlined at build time, so set it in the Pages build
settings before building. Also set `CORS_ORIGIN` on the API to this site's URL.
