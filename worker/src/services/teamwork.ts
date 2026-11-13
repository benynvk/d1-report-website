import { config } from '../config';

/**
 * Teamwork API client (Basic auth, token as username). Task pages sit behind
 * auth, so names come from GET {base}/tasks/{id}.json. Caches are per
 * isolate — best-effort only.
 */
const base = () => config.taskUrlPrefix.replace(/\/$/, '');
const titleCache = new Map<string, string>();
let stageNamesCache: { at: number; names: Map<number, string> } | null = null;
const STAGE_CACHE_TTL_MS = 10 * 60 * 1000;

function authHeader(): string {
  return `Basic ${btoa(`${config.teamworkToken}:x`)}`;
}

function warnAuth(status: number, what: string) {
  const hint = status === 401 ? ' (TEAMWORK_API_TOKEN invalid or revoked?)' : '';
  console.warn(`Teamwork ${what} -> HTTP ${status}${hint}`);
}

function extractTaskId(url: string | null): string | null {
  if (!url) return null;
  return /\/tasks\/(\d+)/.exec(url)?.[1] ?? null;
}

/** The official task name for a Teamwork task URL, or null. */
export async function resolveTitle(url: string | null): Promise<string | null> {
  if (!config.teamworkToken) return null;
  const id = extractTaskId(url);
  if (!id) return null;
  const cached = titleCache.get(id);
  if (cached) return cached;
  try {
    const res = await fetch(`${base()}/tasks/${id}.json`, {
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      warnAuth(res.status, `task ${id}`);
      return null;
    }
    const data: any = await res.json();
    const name: string | null = data?.['todo-item']?.content ?? null;
    if (name) titleCache.set(id, name);
    return name;
  } catch (err) {
    console.warn(`Teamwork resolve failed for ${id}: ${err}`);
    return null;
  }
}

export function resolveMany(urls: (string | null)[]): Promise<(string | null)[]> {
  return Promise.all(urls.map((u) => resolveTitle(u)));
}

/** A Teamwork person's numeric id by exact email match. */
export async function findUserId(email: string): Promise<number | null> {
  if (!config.teamworkToken || !email) return null;
  try {
    const res = await fetch(
      `${base()}/projects/api/v3/people.json?searchTerm=${encodeURIComponent(email)}`,
      { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      warnAuth(res.status, `people search`);
      return null;
    }
    const data: any = await res.json();
    const match = (data.people ?? []).find(
      (p: any) => (p.email ?? '').toLowerCase() === email.toLowerCase(),
    );
    return match?.id ?? null;
  } catch (err) {
    console.warn(`Teamwork findUserId failed for ${email}: ${err}`);
    return null;
  }
}

/**
 * stageId -> stage name across every workflow in the account. `include=stages`
 * returns them alongside the workflows, so this is one request per page
 * rather than one per stage (which would blow the Workers subrequest limit).
 */
export async function listAllStageNames(): Promise<Map<number, string>> {
  if (stageNamesCache && Date.now() - stageNamesCache.at < STAGE_CACHE_TTL_MS) {
    return stageNamesCache.names;
  }
  const names = new Map<number, string>();
  if (!config.teamworkToken) return names;

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${base()}/projects/api/v3/workflows.json?pageSize=100&page=${page}&include=stages`,
      { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) {
      warnAuth(res.status, 'workflows');
      return names; // don't cache a failed lookup
    }
    const data: any = await res.json();
    for (const stage of Object.values<any>(data.included?.stages ?? {})) {
      if (stage?.id != null && stage.name) names.set(Number(stage.id), stage.name);
    }
    if (!data.meta?.page?.hasMore) break;
  }
  stageNamesCache = { at: Date.now(), names };
  return names;
}

/** Open tasks assigned to a Teamwork user, with their board stage id. */
export async function listAssignedTasks(
  userId: number,
): Promise<{ id: number; title: string; url: string; stageId: number | null }[]> {
  if (!config.teamworkToken) return [];
  const res = await fetch(
    `${base()}/projects/api/v3/tasks.json?assignedToUserIds=${userId}&pageSize=250&completed=false`,
    { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) {
    warnAuth(res.status, `listAssignedTasks(${userId})`);
    return [];
  }
  const data: any = await res.json();
  return (data.tasks ?? []).map((t: any) => ({
    id: t.id,
    title: t.name,
    url: `${base()}/app/tasks/${t.id}`,
    stageId: t.stageId ?? null,
  }));
}
