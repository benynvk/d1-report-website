/**
 * Buckets a timestamp into a calendar day ('YYYY-MM-DD') at a fixed UTC offset.
 * Vietnam is UTC+7 with no DST, so a simple offset is exact.
 */
export function toLocalDate(
  input: Date | string,
  offsetHours: number,
): string {
  const ms = (typeof input === 'string' ? new Date(input) : input).getTime();
  const shifted = new Date(ms + offsetHours * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** Today's calendar day at the given UTC offset. */
export function todayLocal(offsetHours: number): string {
  return toLocalDate(new Date(), offsetHours);
}

/** The hour (0-23) of a timestamp in the given UTC offset's local time. */
export function localHour(input: Date | string, offsetHours: number): number {
  const ms = (typeof input === 'string' ? new Date(input) : input).getTime();
  const shifted = new Date(ms + offsetHours * 3600 * 1000);
  return shifted.getUTCHours();
}

/** True if a string looks like 'YYYY-MM-DD'. */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
