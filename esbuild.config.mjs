/**
 * esbuild build configuration for NotebookLM Companion Chrome Extension.
 *
 * Bundles 3 entry points:
 *   - src/content/main.ts     → dist/content.js   (IIFE, injected into NotebookLM)
 *   - src/background/...ts   → dist/service-worker.js (ESM, MV3 service worker)
 *   - src/popup/popup.ts      → dist/popup.js     (IIFE, extension popup)
 *
 * Also copies static assets (manifest, CSS, HTML, icons) to dist/.
 *
 * Usage:
 *   node esbuild.config.mjs           # production build
 *   node esbuild.config.mjs --watch   # development watch mode
 */

import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';

const isWatch = process.argv.includes('--watch');
const isDev = isWatch || process.argv.includes('--dev');

// ─── Shared esbuild options ──────────────────────────────────────────────────
const sharedConfig = {
  bundle: true,
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  define: {
    'process.env.DEBUG': isDev ? '"true"' : '"false"',
  },
  logLevel: 'info',
};

// ─── Entry point configs ─────────────────────────────────────────────────────
const contentConfig = {
  ...sharedConfig,
  entryPoints: ['src/content/main.ts'],
  outfile: 'dist/content.js',
  format: 'iife',
};

const swConfig = {
  ...sharedConfig,
  entryPoints: ['src/background/service-worker.ts'],
  outfile: 'dist/service-worker.js',
  format: 'esm',
};

const popupConfig = {
  ...sharedConfig,
  entryPoints: ['src/popup/popup.ts'],
  outfile: 'dist/popup.js',
  format: 'iife',
};

// ─── Static file copy ────────────────────────────────────────────────────────
function copyStatic() {
  mkdirSync('dist', { recursive: true });

  // Root-level static files
  const staticFiles = [
    ['manifest.json', 'dist/manifest.json'],
    ['styles/companion.css', 'dist/companion.css'],
    ['src/popup/popup.html', 'dist/popup.html'],
  ];

  for (const [src, dest] of staticFiles) {
    if (existsSync(src)) {
      copyFileSync(src, dest);
    } else {
      console.warn(`[copy] Missing: ${src}`);
    }
  }

  // Copy assets/ directory (icons, etc.)
  const assetsDir = 'assets';
  if (existsSync(assetsDir)) {
    for (const file of readdirSync(assetsDir)) {
      const srcPath = join(assetsDir, file);
      if (statSync(srcPath).isFile()) {
        copyFileSync(srcPath, join('dist', file));
      }
    }
  }

  console.log('[copy] Static files copied to dist/');
}

// ─── Build or Watch ──────────────────────────────────────────────────────────
if (isWatch) {
  console.log('[watch] Starting watch mode...');

  const [contentCtx, swCtx, popupCtx] = await Promise.all([
    esbuild.context(contentConfig),
    esbuild.context(swConfig),
    esbuild.context(popupConfig),
  ]);

  copyStatic();

  await Promise.all([
    contentCtx.watch(),
    swCtx.watch(),
    popupCtx.watch(),
  ]);

  console.log('[watch] Watching for changes. Load dist/ in Chrome as an unpacked extension.');
  console.log('[watch] Press Ctrl+C to stop.');
} else {
  copyStatic();

  await Promise.all([
    esbuild.build(contentConfig),
    esbuild.build(swConfig),
    esbuild.build(popupConfig),
  ]);

  console.log('[build] Build complete! Load dist/ as an unpacked Chrome extension.');
}
