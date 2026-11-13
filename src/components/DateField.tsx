'use client';

import { DatePicker } from './Calendar';

/** A plain dd/mm/yyyy date field — the app's calendar, no day coloring. */
export function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <DatePicker value={value} onChange={onChange} />;
}
