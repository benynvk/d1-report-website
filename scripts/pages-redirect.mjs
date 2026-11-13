// Build step of the old Cloudflare Pages project (d1-report-website.pages.dev),
// whose build command is `npm run build:pages` and output directory `out`.
// It no longer builds the site: it only publishes a _redirects file sending
// every path (and query) to the app's home on Vercel.
import { mkdirSync, writeFileSync } from 'node:fs';

// TODO: set to the Vercel production URL before pushing.
const TARGET = 'https://d1-report.benynvk.workers.dev';

mkdirSync('out', { recursive: true });
writeFileSync('out/_redirects', `/* ${TARGET}/:splat 301\n`);
writeFileSync('out/index.html', `<meta http-equiv="refresh" content="0;url=${TARGET}/">\n`);
console.log(`wrote out/_redirects -> ${TARGET}`);
