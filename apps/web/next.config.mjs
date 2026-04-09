import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

// In dev mode, this wires getRequestContext() to use wrangler's getPlatformProxy,
// so D1 binding (DB) and vars defined in wrangler.toml / .dev.vars are available.
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@agent-lab/types'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
