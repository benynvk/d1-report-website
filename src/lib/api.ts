import type {
  Attendance,
  AttendanceStatus,
  ChatMember,
  DailyOverview,
  DailyReport,
  Member,
  PreviewResult,
  Project,
  ReportConfig,
  SummaryResult,
  TaskType,
  WipConfig,
  WipDay,
  WipStatus,
} from './types';

const BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
).replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) {
        message = Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  // DELETE/PATCH handlers may return an empty body with a 200/204 status —
  // parse as JSON only when there's actually content, regardless of status code.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// The member list rarely changes and is fetched from several pages/modals —
// cache it in memory for the session, and actively drop the cache whenever
// a member is created/updated/deleted so the next read is always fresh.
let membersCache: Member[] | null = null;
let membersInFlight: Promise<Member[]> | null = null;

function invalidateMembersCache() {
  membersCache = null;
  membersInFlight = null;
}

function fetchMembers(): Promise<Member[]> {
  if (membersCache) return Promise.resolve(membersCache);
  if (!membersInFlight) {
    membersInFlight = request<Member[]>('/members')
      .then((members) => {
        membersCache = members;
        return members;
      })
      .finally(() => {
        membersInFlight = null;
      });
  }
  return membersInFlight;
}

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => !!v) as [string, string][],
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  // Project
  activeProject: () => request<Project>('/projects/active'),

  // Members
  listMembers: () => fetchMembers(),
  createMember: (data: {
    name: string;
    email: string;
    avatarUrl?: string | null;
    role?: Member['role'];
    wipName?: string | null;
    teamworkEmail?: string;
    autoWip?: boolean;
  }) =>
    request<Member>('/members', { method: 'POST', body: JSON.stringify(data) }).finally(
      invalidateMembersCache,
    ),
  updateMember: (id: string, data: Partial<Member>) =>
    request<Member>(`/members/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }).finally(invalidateMembersCache),
  deleteMember: (id: string) =>
    request<void>(`/members/${id}`, { method: 'DELETE' }).finally(invalidateMembersCache),

  // Task types (no-URL allowlist)
  listTaskTypes: () => request<TaskType[]>('/task-types'),
  createTaskType: (label: string) =>
    request<TaskType>('/task-types', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  deleteTaskType: (id: string) =>
    request<void>(`/task-types/${id}`, { method: 'DELETE' }),

  // Reports
  listReports: (params: Record<string, string | undefined>) =>
    request<DailyReport[]>(`/reports${qs(params)}`),
  reportConfig: () => request<ReportConfig>('/reports/config'),
  resolveTaskTitle: (url: string) =>
    request<{ title: string | null }>(`/reports/resolve-title${qs({ url })}`),
  previewReport: (text: string) =>
    request<PreviewResult>('/reports/preview', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  importReport: (data: {
    memberId?: string;
    email?: string;
    date?: string;
    text: string;
  }) =>
    request<DailyReport>('/reports/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteReport: (id: string) =>
    request<void>(`/reports/${id}`, { method: 'DELETE' }),

  // Attendance
  listAttendance: (params: { date?: string; from?: string; to?: string; memberId?: string }) =>
    request<Attendance[]>(`/attendance${qs(params)}`),
  setAttendance: (
    memberId: string,
    date: string,
    status: AttendanceStatus | 'none',
    hours?: number,
  ) =>
    request<Attendance | null>('/attendance', {
      method: 'POST',
      body: JSON.stringify({ memberId, date, status, hours }),
    }),

  // Stats
  daily: (date?: string) => request<DailyOverview>(`/stats/daily${qs({ date })}`),
  summary: (from: string, to: string) =>
    request<SummaryResult>(`/stats/summary${qs({ from, to })}`),

  // WIP
  wipStatus: () => request<WipStatus>('/wip/status'),
  wipDisconnect: () => request<void>('/wip/disconnect', { method: 'POST' }),
  wipAuthUrl: () => `${BASE}/wip/oauth/start`,
  listWipConfigs: () => request<WipConfig[]>('/wip/config'),
  upsertWipConfig: (month: string, spreadsheetUrl: string) =>
    request<WipConfig>('/wip/config', {
      method: 'POST',
      body: JSON.stringify({ month, spreadsheetUrl }),
    }),
  deleteWipConfig: (id: string) =>
    request<void>(`/wip/config/${id}`, { method: 'DELETE' }),
  wipDay: (date: string) => request<WipDay>(`/wip/day${qs({ date })}`),
  wipChatMembers: () => request<ChatMember[]>('/wip/chat-members'),
  checkWipReminder: (date?: string) =>
    request<{ date: string; missingToday: string[]; missingPrevEvening: string[] }>(
      `/wip/check-reminder${qs({ date })}`,
      { method: 'POST' },
    ),
};
