import { asc, eq } from 'drizzle-orm';
import { config } from '../config';
import { db, schema } from '../db';
import type { Project } from '../db/schema';
import { notFound } from '../http';

const { projects, allowedTaskTypes } = schema;

/**
 * Only the id is cached: the row also holds the WIP Google refresh token,
 * which another serverless instance may change at any time.
 */
let activeProjectId: string | null = null;

/**
 * The single project this deployment serves (PROJECT_CODE). Created on first
 * access, together with the default no-URL task types.
 */
export async function getActiveProject(): Promise<Project> {
  const existing = await db().query.projects.findFirst({
    where: eq(projects.code, config.projectCode),
  });
  if (existing) {
    activeProjectId = existing.id;
    return existing;
  }
  const [created] = await db()
    .insert(projects)
    .values({ code: config.projectCode, name: config.projectName, active: true })
    .onConflictDoNothing()
    .returning();
  if (!created) return getActiveProject(); // lost a creation race — re-read
  if (config.seedTaskTypes.length) {
    await db()
      .insert(allowedTaskTypes)
      .values(config.seedTaskTypes.map((label) => ({ projectId: created.id, label })))
      .onConflictDoNothing();
  }
  activeProjectId = created.id;
  return created;
}

export async function getActiveProjectId(): Promise<string> {
  return activeProjectId ?? (await getActiveProject()).id;
}

/** Strips secrets before a project goes out over the API. */
export function publicProject(p: Project) {
  const { wipGoogleRefreshToken: _token, ...rest } = p;
  return rest;
}

export function findAll(): Promise<Project[]> {
  return db().query.projects.findMany({ orderBy: asc(projects.name) });
}

export async function findOne(id: string): Promise<Project> {
  const project = await db().query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw notFound(`Project ${id} not found`);
  return project;
}

export async function update(
  id: string,
  data: Partial<Pick<Project, 'name' | 'chatSpaceId' | 'active' | 'wipGoogleRefreshToken' | 'wipGoogleEmail'>>,
): Promise<Project> {
  await findOne(id);
  if (Object.keys(data).length === 0) return findOne(id);
  const [saved] = await db().update(projects).set(data).where(eq(projects.id, id)).returning();
  return saved;
}
