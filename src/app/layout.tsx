import type { Metadata } from 'next';
import './globals.css';
import { ConfirmProvider } from '@/components/Confirm';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'D1 Training — Workload',
  description: 'Daily workload reports from Google Chat',
};

const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <ConfirmProvider>
          <div className="app">
            <Nav />
            <main className="main">{children}</main>
          </div>
        </ConfirmProvider>
      </body>
    </html>
  );
}
