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
  '45 2 * * MON-FRI': 'auto-wip', // 09:45 — fill WIP from Teamwork
  '0 11 * * MON-FRI': 'wip-evening-reminder', // 18:00 — today's evening WIP
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
