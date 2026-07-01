/** @type {import('next').NextConfig} */
const nextConfig = {
  // Off so dev doesn't double-invoke effects (which looks like duplicate API
  // calls). Production behaviour is identical either way.
  reactStrictMode: false,
  // Fully static build -> deploy the `out/` folder to Cloudflare Pages.
  // All pages render client-side and call the API via NEXT_PUBLIC_API_URL,
  // so no server runtime is needed.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
