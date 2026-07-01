export interface Project {
  id: string;
  name: string;
  code: string;
  chatSpaceId: string | null;
  active: boolean;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  chatUserId: string | null;
  avatarUrl: string | null;
  isSupport: boolean;
  wipName: string | null;
  teamworkEmail: string | null;
  autoWip: boolean;
  createdAt: string;
}

export interface ReportEntry {
  id: string;
  taskName: string;
  hours: number;
  href: string | null;
  resolvedTitle: string | null;
  position: number;
}

export interface DailyReport {
  id: string;
  date: string;
  rawText: string;
  source: 'google-chat' | 'manual';
  member: Member;
  entries: ReportEntry[];
  createdAt: string;
  updatedAt: string;
}

export type AttendanceStatus = 'holiday';

export interface Attendance {
  id: string;
  date: string;
  status: AttendanceStatus;
  member: Member;
}

export interface TaskType {
  id: string;
  label: string;
  createdAt: string;
}

export interface MemberDayStat {
  memberId: string;
  memberName: string;
  avatarUrl: string | null;
  isSupport: boolean;
  status: AttendanceStatus | null;
  reported: boolean;
  totalHours: number;
  taskCount: number;
  utilization: number;
  entries: {
    taskName: string;
    hours: number;
    href: string | null;
    resolvedTitle: string | null;
  }[];
}

export interface DailyOverview {
  date: string;
  capacity: number;
  memberCount: number;
  reportedCount: number;
  pendingCount: number;
  onLeaveCount: number;
  totalHours: number;
  members: MemberDayStat[];
}

export interface PreviewEntry {
  taskName: string;
  hours: number;
  href: string | null;
  valid: boolean;
}

export interface PreviewResult {
  entries: PreviewEntry[];
  ignored: string[];
  totalHours: number;
  invalid: string[];
}

export interface ReportConfig {
  taskUrlPrefix: string;
  noUrlAllowedTasks: string[];
}

export interface SummaryResult {
  from: string;
  to: string;
  members: {
    memberId: string;
    memberName: string;
    avatarUrl: string | null;
    totalHours: number;
    taskCount: number;
    daysReported: number;
  }[];
}

export interface WipStatus {
  connected: boolean;
  email: string | null;
}

export interface WipConfig {
  id: string;
  month: string; // 'YYYY-MM'
  spreadsheetUrl: string;
  createdAt: string;
}

export interface WipRow {
  team: string;
  staffName: string;
  morning: string;
  evening: string;
  memberId: string | null;
  memberName: string | null;
  avatarUrl: string | null;
}

export interface WipDay {
  date: string;
  tabName: string;
  configured: boolean;
  rows: WipRow[];
}
