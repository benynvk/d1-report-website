import { bindEnv, config } from './config';
import { api } from './routes';
import { jobs, type JobName } from './services/reminders';

/**
 * One Worker serves everything:
 *  - the static Next.js export in ./out (matched before this code runs),
 *  - the API under /api/*,
 *  - the scheduled jobs, via Cron Triggers.
 */

export interface Env {
  ASSETS: Fetcher;
  DATABASE_URL: string;
  [key: string]: unknown;
}

/**
 * Cron Triggers run in UTC; Vietnam is UTC+7 with no DST. Keep these in sync
 * with `triggers.crons` in wrangler.jsonc.
 */
const SCHEDULE: Record<string, JobName> = {
  '30 2 * * MON-FRI': 'wip-reminder', // 09:30 — who hasn't filled WIP
  // Auto-WIP runs twice, 15 min apart: it only fills empty cells, so the
  // second run is a no-op unless the first was cut short (e.g. by the free
  // plan's CPU limit) — then it finishes the job.
  '45,59 2 * * MON-FRI': 'auto-wip', // 09:45 (+09:59) — catch up yesterday's evening, fill today's morning from the D1 board
  '0 11 * * MON-FRI': 'wip-evening-reminder', // 18:00 — today's evening WIP
  '30,45 11 * * MON-FRI': 'auto-wip-evening', // 18:30 (+18:45) — fill empty evening WIP from the morning
};

export default {
  async fetch(request, env, ctx) {
    bindEnv(env);
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return api.fetch(request, env, ctx);
    // Not a static file and not the API: let the assets layer render the 404 page.
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    bindEnv(env);
    const name = SCHEDULE[controller.cron];
    if (!name) {
      console.error(`No job mapped to cron "${controller.cron}"`);
      return;
    }
    if (!config.remindersEnabled) {
      console.log(`Skipping ${name}: REMINDER_ENABLED=false`);
      return;
    }
    ctx.waitUntil(
      jobs[name]()
        .then((result) => console.log(`Job ${name} done: ${JSON.stringify(result)}`))
        .catch((err) => console.error(`Job ${name} failed:`, err)),
    );
  },
} satisfies ExportedHandler<Env>;
