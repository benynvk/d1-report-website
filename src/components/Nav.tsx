'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';

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
const ConfigIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.6a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.04-1.56V4.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.56 1.04h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
  </svg>
);
const TaskTypesIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M4 11.6 12.3 3.3a1 1 0 0 1 .9-.27l5.2.87a1 1 0 0 1 .83.83l.87 5.2a1 1 0 0 1-.27.9L12.4 19a1.4 1.4 0 0 1-2 0l-6.4-6.4a1.4 1.4 0 0 1 0-2Z" />
    <circle cx="15.5" cy="8.5" r="1.4" />
  </svg>
);
const ChevronIcon = () => (
  <svg {...ICON_PROPS} width={15} height={15}>
    <path d="m7 9 5 5 5-5" />
  </svg>
);

const LINKS: { href: string; label: string; icon: ReactNode }[] = [
  { href: '/', label: 'Home', icon: <HomeIcon /> },
  { href: '/reports', label: 'Reports', icon: <ReportsIcon /> },
  { href: '/members', label: 'Members', icon: <MembersIcon /> },
  { href: '/wip', label: 'WIP', icon: <WipIcon /> },
];

const CONFIG_LINKS = [
  { href: '/task-types', label: 'Task Types', icon: <TaskTypesIcon /> },
];

const LOGO =
  'https://d1-mobile-app.s3.us-east-1.amazonaws.com/assets/d1_training_logo.png';

export function Nav() {
  const pathname = usePathname();
  const inConfig = CONFIG_LINKS.some((l) => pathname.startsWith(l.href));
  const [configOpen, setConfigOpen] = useState(inConfig);
  // Home is a clean public dashboard — no sidebar. Reach management pages by
  // typing their URL (e.g. /members).
  if (pathname === '/') return null;

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} alt="D1 Training" className="brand-logo" />
      </Link>
      <nav>
        {LINKS.map((l) => {
          const active =
            l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link${active ? ' active' : ''}`}
            >
              <span className="nav-icon">{l.icon}</span>
              {l.label}
            </Link>
          );
        })}

        <button
          type="button"
          className="nav-link nav-group-toggle"
          onClick={() => setConfigOpen((v) => !v)}
        >
          <span className="nav-link-main">
            <span className="nav-icon">
              <ConfigIcon />
            </span>
            Config
          </span>
          <span className={`nav-caret${configOpen ? ' open' : ''}`}>
            <ChevronIcon />
          </span>
        </button>
        {configOpen && (
          <div className="nav-group">
            {CONFIG_LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`nav-link nav-sublink${active ? ' active' : ''}`}
                >
                  <span className="nav-icon">{l.icon}</span>
                  {l.label}
                </Link>
              );
            })}
          </div>
        )}
      </nav>
      <ThemeToggle floating />
    </aside>
  );
}
