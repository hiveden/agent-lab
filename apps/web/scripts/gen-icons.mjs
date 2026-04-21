/**
 * PWA icons 生成脚本（Step 8 · PWA-lite）。
 *
 * 输入：apps/web/public/icons/icon.svg
 * 输出：
 *   - icon-192.png / icon-512.png         （Android + 通用）
 *   - icon-maskable-512.png               （Android adaptive icon）
 *   - apple-touch-icon.png (180x180)      （iOS Safari "添加到主屏"）
 *   - favicon-32.png / favicon-16.png     （浏览器标签页）
 *
 * 运行：
 *   cd apps/web && node scripts/gen-icons.mjs
 *
 * 何时重跑：icon.svg 更新时。产物入 git 免得 CI 要装 sharp。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'public/icons/icon.svg');
const OUT_DIR = path.join(ROOT, 'public/icons');

const TARGETS = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  // maskable 版本：加 10% safe area padding（Android adaptive icon 规范）
  { name: 'icon-maskable-512.png', size: 512, padding: 0.1 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-16.png', size: 16 },
];

async function main() {
  const svg = await readFile(SRC);
  for (const { name, size, padding = 0 } of TARGETS) {
    const inset = Math.round(size * padding);
    const innerSize = size - inset * 2;
    let img = sharp(svg).resize(innerSize, innerSize, {
      fit: 'contain',
      background: { r: 29, g: 30, b: 34, alpha: 1 }, // --text = 项目深色
    });
    if (inset > 0) {
      img = img.extend({
        top: inset,
        bottom: inset,
        left: inset,
        right: inset,
        background: { r: 29, g: 30, b: 34, alpha: 1 },
      });
    }
    const buf = await img.png().toBuffer();
    await writeFile(path.join(OUT_DIR, name), buf);
    console.log(`✓ ${name} (${size}×${size}${padding ? `, inset ${inset}px` : ''})`);
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
