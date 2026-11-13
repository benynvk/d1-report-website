import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import type { TaskType } from '../db/schema';
import { badRequest, conflict, notFound } from '../http';
import { getActiveProjectId } from './projects';

const { allowedTaskTypes } = schema;

/** Task labels that may be reported without a Teamwork link. */
export async function findAll(): Promise<TaskType[]> {
  const projectId = await getActiveProjectId();
  return db().query.allowedTaskTypes.findMany({
    where: eq(allowedTaskTypes.projectId, projectId),
    orderBy: asc(allowedTaskTypes.label),
  });
}

/** Lowercased labels, for validation. */
export async function getAllowedSet(): Promise<Set<string>> {
  return new Set((await findAll()).map((t) => t.label.trim().toLowerCase()));
}

export async function create(label: string): Promise<TaskType> {
  const clean = label?.trim();
  if (!clean) throw badRequest('label is required');
  const projectId = await getActiveProjectId();
  const exists = await db().query.allowedTaskTypes.findFirst({
    where: and(eq(allowedTaskTypes.projectId, projectId), eq(allowedTaskTypes.label, clean)),
  });
  if (exists) throw conflict(`"${clean}" already exists`);
  const [created] = await db().insert(allowedTaskTypes).values({ projectId, label: clean }).returning();
  return created;
}

export async function remove(id: string): Promise<void> {
  const deleted = await db()
    .delete(allowedTaskTypes)
    .where(eq(allowedTaskTypes.id, id))
    .returning({ id: allowedTaskTypes.id });
  if (deleted.length === 0) throw notFound(`Task type ${id} not found`);
}
