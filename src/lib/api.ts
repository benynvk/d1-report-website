import type {
  Attendance,
  AttendanceStatus,
  DailyOverview,
  DailyReport,
  Member,
  PreviewResult,
  Project,
  ReportConfig,
  SummaryResult,
  TaskType,
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
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
  listMembers: () => request<Member[]>('/members'),
  createMember: (data: { name: string; email: string }) =>
    request<Member>('/members', { method: 'POST', body: JSON.stringify(data) }),
  updateMember: (id: string, data: Partial<Member>) =>
    request<Member>(`/members/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

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
  listAttendance: (date: string) =>
    request<Attendance[]>(`/attendance${qs({ date })}`),
  setAttendance: (
    memberId: string,
    date: string,
    status: AttendanceStatus | 'none',
  ) =>
    request<Attendance | null>('/attendance', {
      method: 'POST',
      body: JSON.stringify({ memberId, date, status }),
    }),

  // Stats
  daily: (date?: string) => request<DailyOverview>(`/stats/daily${qs({ date })}`),
  summary: (from: string, to: string) =>
    request<SummaryResult>(`/stats/summary${qs({ from, to })}`),

  // Reminders
  runReminder: (date?: string) =>
    request<{ date: string; missing: string[] }>(
      `/reminders/run${qs({ date })}`,
      { method: 'POST' },
    ),
};
