/** @type {import('next').NextConfig} */
const nextConfig = {
  // Off so dev doesn't double-invoke effects (which looks like duplicate API
  // calls). Production behaviour is identical either way.
  reactStrictMode: false,
  // Pages render client-side and call the API in src/app/api (same origin).
  // No trailing-slash redirects: a 308 on /api/webhooks/google-chat would
  // break the Google Chat webhook.
  trailingSlash: false,
  images: { unoptimized: true },
};

export default nextConfig;
