import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';
import withSerwistInit from '@serwist/next';

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

// Step 9a · Service Worker（ADR-7）
// - dev 禁用（避免 HMR 与 SW 缓存相互干扰）
// - production build 时生成 public/sw.js
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  // 排除 API routes 的 precache（它们是 dynamic），静态资源走 precacheEntries
  exclude: [/^\/api\//],
});

export default withSerwist(nextConfig);
