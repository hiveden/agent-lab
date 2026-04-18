'use client';

import { useEffect } from 'react';
import { startBrowserOtel } from '@/lib/otel-browser';

/**
 * Root layout 嵌入此组件触发浏览器 OTel SDK init。
 * 详见 docs/22 Phase 3 / ADR-007。
 *
 * 用 useEffect 而非顶层 import: 确保只在 client runtime 跑, 不进 SSR bundle
 * 也不影响 server-side rendering。
 */
export default function OtelClientInit() {
  useEffect(() => {
    startBrowserOtel();
  }, []);
  return null;
}
