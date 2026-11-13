// Runs after `next build`. Only on Cloudflare Pages (which sets CF_PAGES=1):
// the old d1-report-website.pages.dev project now just forwards every path to
// the app's new home on Workers. Never written for the Worker's own build —
// Workers would honour the file too and redirect to itself.
import { writeFileSync } from 'node:fs';

const TARGET = 'https://d1-report.benynvk.workers.dev';

if (process.env.CF_PAGES === '1') {
  writeFileSync('out/_redirects', `/* ${TARGET}/:splat 301\n`);
  console.log(`Pages build: wrote out/_redirects -> ${TARGET}`);
}
