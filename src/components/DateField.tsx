'use client';

import { useRef } from 'react';
import { formatDate } from '@/lib/format';

/**
 * Date input that always displays dd/mm/yyyy (native inputs follow browser
 * locale, which we can't control). Clicking opens the native calendar picker.
 */
export function DateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const open = () => {
    const el = ref.current;
    if (!el) return;
    // showPicker() is supported in modern Chromium/Firefox.
    if (typeof el.showPicker === 'function') el.showPicker();
    else el.focus();
  };

  return (
    <button type="button" className="date-field" onClick={open}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <span>{value ? formatDate(value) : 'dd/mm/yyyy'}</span>
      <input
        ref={ref}
        type="date"
        className="date-field-native"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
      />
    </button>
  );
}
