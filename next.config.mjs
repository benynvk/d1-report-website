/** @type {import('next').NextConfig} */
const nextConfig = {
  // Off so dev doesn't double-invoke effects (which looks like duplicate API
  // calls). Production behaviour is identical either way.
  reactStrictMode: false,
  // Fully static build: `out/` is served as the Worker's static assets
  // (see wrangler.jsonc). All pages render client-side and call the API the
  // same Worker serves under /api, so Next needs no server runtime.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
