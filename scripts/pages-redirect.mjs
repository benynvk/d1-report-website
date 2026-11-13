// Used only by the old Cloudflare Pages project (d1-report-website.pages.dev),
// whose build command is `npm run build:pages`: writes a _redirects file that
// forwards every path to the app's new home on Workers.
//
// Never part of the Worker's build — Workers honour _redirects too and would
// redirect to themselves.
import { writeFileSync } from 'node:fs';

const TARGET = 'https://d1-report.benynvk.workers.dev';

writeFileSync('out/_redirects', `/* ${TARGET}/:splat 301\n`);
console.log(`wrote out/_redirects -> ${TARGET}`);
