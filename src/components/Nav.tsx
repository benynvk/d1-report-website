'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/reports', label: 'Reports' },
  { href: '/import', label: 'Import' },
  { href: '/members', label: 'Members' },
  { href: '/task-types', label: 'Task Types' },
  { href: '/wip', label: 'WIP' },
];

const LOGO =
  'https://d1-mobile-app.s3.us-east-1.amazonaws.com/assets/d1_training_logo.png';

export function Nav() {
  const pathname = usePathname();
  // Home is a clean public dashboard — no sidebar. Reach management pages by
  // typing their URL (e.g. /members, /import).
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
              {l.label}
            </Link>
          );
        })}
      </nav>
      <ThemeToggle floating />
    </aside>
  );
}
