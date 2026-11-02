/**
 * Light or dark (the owner's request, Nov 2026): the ERP's screens follow the device's setting, unless this browser was
 * set to Light or Dark in the person's menu. The website and the customers' order-link page keep their own look, and a
 * printout stays white (dark-css.ts). The choice is how this browser shows the screens, not business data, so it is kept
 * here, as the pop-ups' setting is (NR-11).
 */
import { useEffect, useState } from 'react';

export type ThemeChoice = 'device' | 'light' | 'dark';
export const THEME_KEY = 'moonproject.theme';
const CHANGED = 'moonproject-theme';

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'device';
  } catch { return 'device'; }
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'device') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice);
  } catch { /* a browser that keeps nothing still switches for this visit */ }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: choice }));
}

const deviceDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The choice, kept up to date when it changes in another part of the page or another tab. */
export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState(themeChoice);
  useEffect(() => {
    const update = () => setChoice(themeChoice());
    window.addEventListener(CHANGED, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(CHANGED, update); window.removeEventListener('storage', update); };
  }, []);
  return choice;
}

/** Puts the ERP's look on the page while `on` (the website and order links leave it off), following the device as it changes. */
export function useErpTheme(on: boolean) {
  const choice = useThemeChoice();
  const [dark, setDark] = useState(deviceDark);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(q.matches);
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  const theme = !on ? null : choice === 'device' ? (dark ? 'dark' : 'light') : choice;
  useEffect(() => {
    const html = document.documentElement;
    if (theme) html.dataset.theme = theme; else delete html.dataset.theme;
  }, [theme]);
}
