import { config } from '../config';
import type { BoardTask } from './auto-wip-rules';

/**
 * Teamwork API client (Basic auth, token as username). Task pages sit behind
 * auth, so names come from GET {base}/tasks/{id}.json. Caches are per
 * isolate — best-effort only.
 */
const base = () => config.taskUrlPrefix.replace(/\/$/, '');
const titleCache = new Map<string, string>();

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

/**
 * The canonical ".../app/tasks/<id>" URL for a link to a Teamwork task on our
 * domain — including the older "/#/tasks/<id>" form — or the input unchanged
 * for anything else.
 */
export function canonicalTaskUrl(url: string | null): string | null {
  if (!url?.startsWith(base())) return url;
  const id = /^\/?(?:#\/|app\/)?tasks\/(\d+)(?:[/?#]|$)/.exec(url.slice(base().length).replace(/^\//, ''))?.[1];
  return id ? `${base()}/app/tasks/${id}` : url;
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

async function get(path: string, what: string): Promise<any | null> {
  if (!config.teamworkToken) return null;
  try {
    const res = await fetch(`${base()}${path}`, {
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      warnAuth(res.status, what);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`Teamwork ${what} failed: ${err}`);
    return null;
  }
}

/**
 * Every open task of the project's board (TEAMWORK_PROJECT_ID, D1 by default)
 * with its column, priority and assignees' emails — two requests for the
 * whole team, with only the fields auto-WIP needs.
 */
export async function listBoardTasks(): Promise<BoardTask[]> {
  const projectId = config.teamworkProjectId;
  const [workflows, page] = await Promise.all([
    get(`/projects/api/v3/projects/${projectId}/workflows.json?include=stages`, 'project workflows'),
    get(
      `/projects/api/v3/projects/${projectId}/tasks.json?completed=false&pageSize=500&include=users` +
        '&fields[tasks]=id,name,priority,workflowStages,assigneeUserIds&fields[users]=id,email',
      'project tasks',
    ),
  ]);
  if (!page) return [];
  const stageNames = new Map<number, string>(
    Object.values<any>(workflows?.included?.stages ?? {}).map((st) => [Number(st.id), String(st.name)]),
  );
  const workflowIds = new Set<number>((workflows?.workflows ?? []).map((w: any) => Number(w.id)));
  const emails = new Map<number, string>(
    Object.values<any>(page.included?.users ?? {}).map((u) => [Number(u.id), String(u.email ?? '')]),
  );
  return (page.tasks ?? []).map((t: any): BoardTask => {
    // stageId 0 = on the board's backlog, not in a column.
    const ws = (t.workflowStages ?? []).find((w: any) => workflowIds.has(Number(w.workflowId)) && w.stageId);
    return {
      id: t.id,
      title: t.name,
      url: `${base()}/app/tasks/${t.id}`,
      stage: ws ? (stageNames.get(Number(ws.stageId)) ?? null) : null,
      priority: t.priority ?? null,
      assigneeEmails: (t.assigneeUserIds ?? []).map((id: number) => emails.get(Number(id)) ?? '').filter(Boolean),
    };
  });
}
