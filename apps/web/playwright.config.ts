import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:8788',
    // 录屏：视频尺寸 = viewport 尺寸（1:1，不缩放）
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    // 截图
    screenshot: 'on',
    // Trace
    trace: 'on',
    // 视口 + 2x deviceScaleFactor 模拟 Retina
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },

  outputDir: './e2e/test-results',

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  // 不自动启动 webServer — 需要手动启动 Next.js + Python Agent
  // 因为两个进程都需要提前初始化 D1 数据
});
