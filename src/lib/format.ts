/** Display name for a task entry: official Teamwork title > typed name > fallback. */
export function taskLabel(e: {
  resolvedTitle?: string | null;
  taskName?: string | null;
  href?: string | null;
}): string {
  return e.resolvedTitle?.trim() || e.taskName?.trim() || 'Task';
}

/** Formats an ISO date ('YYYY-MM-DD' or full ISO) as dd/mm/yyyy. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
