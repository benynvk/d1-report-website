'use client';

import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="select" ref={ref}>
      <button
        type="button"
        className={`select-btn${selected ? '' : ' placeholder'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select-opt-inner">
          {selected?.icon}
          {selected ? selected.label : placeholder}
        </span>
      </button>
      {open && (
        <div className="select-menu" role="listbox">
          {placeholder && (
            <div
              className={`select-opt${!value ? ' selected' : ''}`}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {placeholder}
            </div>
          )}
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`select-opt${o.value === value ? ' selected' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="select-opt-inner">
                {o.icon}
                {o.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
