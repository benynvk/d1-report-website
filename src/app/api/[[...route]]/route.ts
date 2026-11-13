import { handle } from 'hono/vercel';
import { api } from '@/server/routes';

/**
 * Every /api/* request goes to the Hono app in src/server/routes.ts, on the
 * Node runtime, allowed up to 60 s (the auto-WIP jobs take a few seconds).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const handler = handle(api);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
