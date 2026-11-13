import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { config } from '../config';
import * as schema from './schema';

/**
 * Neon over HTTP: every query is one fetch, so there is no connection to
 * open or pool — a good fit for serverless functions that come and go.
 *
 * Trade-off: no interactive transactions. Use `db().batch([...])` for
 * statements that must commit together.
 */
let instance: { url: string; db: NeonHttpDatabase<typeof schema> } | null = null;

export function db(): NeonHttpDatabase<typeof schema> {
  const url = config.databaseUrl;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (instance?.url !== url) instance = { url, db: drizzle(neon(url), { schema }) };
  return instance.db;
}

export { schema };
