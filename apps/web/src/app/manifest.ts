import type { MetadataRoute } from 'next';

/**
 * Web App Manifest（Step 8 · PWA-lite）。
 *
 * Next.js 15 App Router 约定：`app/manifest.ts` 的 default export 在构建时生成
 * `/manifest.webmanifest`。`app/layout.tsx` 的 metadata 会自动引用它。
 *
 * 作用：
 * - iOS Safari / Android Chrome 识别站点为"可安装 app"
 * - 主屏启动时 theme_color / background_color 控制启动画面
 * - icons 字段提供多尺寸光栅图 + maskable 适配 Android adaptive icon
 *
 * Step 9 会在此基础上加 Service Worker（@serwist/next）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'agent-lab · Radar',
    short_name: 'agent-lab',
    description: '个人 AI Agent 平台：从 Hacker News 等信息源发现高质量内容并推送',
    start_url: '/agents/radar',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#1d1e22',
    background_color: '#1d1e22',
    lang: 'zh-CN',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
