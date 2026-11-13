/**
 * Server settings, from environment variables (Vercel project settings in
 * production, .env.local in development). Only DATABASE_URL is required —
 * everything else has a default that matches the D1 Training setup.
 */
const env = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;

export const config = {
  get databaseUrl() {
    return env('DATABASE_URL');
  },
  get projectCode() {
    return env('PROJECT_CODE', 'D1');
  },
  get projectName() {
    return env('PROJECT_NAME', 'D1 Training');
  },
  /** Labels seeded as no-URL task types when the project is first created. */
  get seedTaskTypes() {
    return env('NO_URL_ALLOWED_TASKS', 'Review code,Weekly meeting')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get taskUrlPrefix() {
    return env('REQUIRED_TASK_URL_PREFIX', 'https://offspringdigital.teamwork.com');
  },
  get tzOffset() {
    return Number(env('REPORT_TIMEZONE_OFFSET', '7'));
  },
  get dailyCapacity() {
    return Number(env('DAILY_CAPACITY_HOURS', '8')) || 8;
  },
  /** Kill switch for the scheduled reminder / auto-WIP jobs. */
  get remindersEnabled() {
    return env('REMINDER_ENABLED', 'true') === 'true';
  },
  get teamworkToken() {
    return env('TEAMWORK_API_TOKEN');
  },
  /** The Teamwork project whose board auto-WIP picks tasks from (D1). */
  get teamworkProjectId() {
    return env('TEAMWORK_PROJECT_ID', '708697');
  },
  get chatWebhookUrl() {
    return env('GOOGLE_CHAT_WEBHOOK_URL');
  },
  /** Set to verify the JWT Google Chat signs each webhook call with. */
  get chatProjectNumber() {
    return env('GOOGLE_CHAT_PROJECT_NUMBER');
  },
  get googleClientId() {
    return env('GOOGLE_OAUTH_CLIENT_ID');
  },
  get googleClientSecret() {
    return env('GOOGLE_OAUTH_CLIENT_SECRET');
  },
  /** Empty => `${request origin}/api/wip/oauth/callback`. */
  get googleRedirectUri() {
    return env('GOOGLE_OAUTH_REDIRECT_URI');
  },
};
