'use client';

/**
 * TabletShell — medium viewport 布局壳（Step 1 占位）。
 *
 * Step 1 策略：medium 档位（768-1279px）暂时复用 DesktopShell 的实现。
 * 真正独立的 tablet 布局（NavRail 窄版 + Slide Panel）在 Step 6 做。
 *
 * 见 docs/mobile-playbook/06-migration-roadmap.md Step 6。
 */

import DesktopShell, { type DesktopShellProps } from './DesktopShell';

export type TabletShellProps = DesktopShellProps;

export default function TabletShell(props: TabletShellProps) {
  return <DesktopShell {...props} />;
}
