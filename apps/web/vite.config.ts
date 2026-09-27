/**
 * The web app is served from the same origin as the server (PLAN C1). In development, Vite proxies /api
 * to the dev server so cookies, CSRF and the Origin check behave exactly as in production.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // @moonproject/shared imports node:crypto for ids; the browser has the same function built in.
    alias: { 'node:crypto': fileURLToPath(new URL('./src/shims/node-crypto.ts', import.meta.url)) },
  },
  // Object form keeps the browser's Host header, so the server's Origin check sees one origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
});
