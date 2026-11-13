'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { LOGO_URL } from '@/lib/brand';

const ICON_PROPS = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const HomeIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" />
  </svg>
);
const ReportsIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v4h4" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);
const MembersIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 4.2a3 3 0 0 1 0 5.8" />
    <path d="M18 14.3c2 .6 3.5 2.6 3.5 5.7" />
  </svg>
);
const WipIcon = () => (
  <svg {...ICON_PROPS}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 3h6v3H9z" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);
const SettingsIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.6a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.04-1.56V4.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.56 1.04h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
  </svg>
);

const LINKS: { href: string; label: string; icon: ReactNode }[] = [
  { href: '/', label: 'Home', icon: <HomeIcon /> },
  { href: '/reports', label: 'Reports', icon: <ReportsIcon /> },
  { href: '/wip', label: 'WIP', icon: <WipIcon /> },
  { href: '/members', label: 'Members', icon: <MembersIcon /> },
  { href: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function Nav() {
  const pathname = usePathname();
  // Home is a clean public dashboard - no sidebar.
  if (pathname === '/') return null;

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="D1 Training" className="brand-logo" />
      </Link>
      <nav>
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`nav-link${active ? ' active' : ''}`}>
              <span className="nav-icon">{l.icon}</span>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <ThemeToggle floating />
    </aside>
  );
}
