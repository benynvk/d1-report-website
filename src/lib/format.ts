/**
 * Display name for a task entry: official Teamwork title > typed name >
 * fallback. An "Other" task shows just its description everywhere —
 * "Other - Check DNS records" -> "Check DNS records".
 */
export function taskLabel(e: {
  resolvedTitle?: string | null;
  taskName?: string | null;
  href?: string | null;
}): string {
  const label = e.resolvedTitle?.trim() || e.taskName?.trim() || 'Task';
  return e.href ? label : label.replace(/^other\s+-\s+/i, '') || label;
}

/** Task name in generated reports (WIP summary, monthly report) — same as taskLabel. */
export const reportLabel = taskLabel;

/**
 * Task/day hours for display, rounded to 2 decimals. Hours are optional when
 * filing a report - a report written at the start of the day only lists what
 * the member plans to do - and those entries store 0, shown as a dash so the
 * day doesn't read as "worked 0h".
 */
export function formatHours(h?: number | null): string {
  return h ? `${Math.round(h * 100) / 100}h` : '-';
}

/** Formats an ISO date ('YYYY-MM-DD' or full ISO) as dd/mm/yyyy. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** 'YYYY-MM' as "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** Today in Vietnam time, 'YYYY-MM-DD'. */
export function todayVN(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' shifted by whole days. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Thu, 13/11/2026" */
export function formatDayLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${wd}, ${formatDate(iso)}`;
}
