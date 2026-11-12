/**
 * The web app is served from the same origin as the server (PLAN C1). In development, Vite proxies /api
 * to the dev server so cookies, CSRF and the Origin check behave exactly as in production.
 */
import { defineConfig, type Plugin } from 'vite';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { darkTheme } from './src/dark-css.ts';

/**
 * A build keeps the app's earlier parts (assets/) for KEEP_DAYS (the owner's report, Nov 2026: Download PSD failed on a
 * page opened before an update, its Photoshop part gone from the server). A page left open across an update loads the
 * parts it was built with until it is reloaded; parts older than that, and not part of this build, are removed.
 */
const KEEP_DAYS = 30;
export function keepEarlierAssets(dir: string): Plugin {
  return {
    name: 'keep-earlier-assets',
    apply: 'build',
    // This build's parts were just written (an unchanged one too), so only earlier builds' parts can be this old.
    closeBundle() {
      let names: string[];
      try { names = readdirSync(dir); } catch { return; }
      const now = Date.now();
      for (const name of names) {
        const file = join(dir, name);
        if (now - statSync(file).mtimeMs > KEEP_DAYS * 86_400_000) unlinkSync(file);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), keepEarlierAssets(resolve(import.meta.dirname, 'dist', 'assets'))],
  // Not emptied: the earlier parts stay for pages still open (keepEarlierAssets).
  build: { emptyOutDir: false },
  // The dark screens' colours, added to Tailwind's sheet (src/dark-css.ts).
  css: { postcss: { plugins: [darkTheme()] } },
  // Object form keeps the browser's Host header, so the server's Origin check sees one origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
});
