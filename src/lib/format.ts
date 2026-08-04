/** Display name for a task entry: official Teamwork title > typed name > fallback. */
export function taskLabel(e: {
  resolvedTitle?: string | null;
  taskName?: string | null;
  href?: string | null;
}): string {
  return e.resolvedTitle?.trim() || e.taskName?.trim() || 'Task';
}

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
