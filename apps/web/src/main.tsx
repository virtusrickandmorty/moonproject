import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The installed app (PWA): a service worker that keeps the app's own files only (public/sw.js). Not under a test browser,
// which should load every file from the server it is testing.
if ('serviceWorker' in navigator && !navigator.webdriver) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
