/** System Health's colours and where each light is fixed (PLAN C8), kept apart from the page so they can be tested. */
import type { HealthLight } from '../../api.ts';

export const DOT: Record<HealthLight, string> = {
  green: 'bg-green-500', amber: 'bg-amber-400', red: 'bg-red-600', grey: 'bg-slate-300',
};

export const OVERALL: Record<Exclude<HealthLight, 'grey'>, string> = {
  green: 'Everything is in order.',
  amber: 'Something needs doing soon. See the amber lights.',
  red: 'Something needs doing now. See the red lights.',
};

/** The page that fixes a light, and who can open it. */
const FIX: Record<string, { path: string; label: string; permission: string }> = {
  backups: { path: '/bak', label: 'Open Backups', permission: 'bak.view' },
  offsite: { path: '/bak', label: 'Open Backups', permission: 'bak.view' },
  usb: { path: '/bak', label: 'Open Backups', permission: 'bak.view' },
  drill: { path: '/bak', label: 'Open Backups', permission: 'bak.view' },
  books: { path: '/aud/integrity', label: 'Open Integrity check', permission: 'aud.integrity.view' },
  audit: { path: '/aud/integrity', label: 'Open Integrity check', permission: 'aud.integrity.view' },
  practice: { path: '/admin/practice', label: 'Open Practice shop', permission: '' },
};

/** A link to fix a light that is not green, when the signed-in user may open that page. */
export function fixLink(key: string, light: HealthLight, permissions: string[]): { path: string; label: string } | null {
  const f = FIX[key];
  if (!f || light === 'green' || light === 'grey') return null;
  return !f.permission || permissions.includes(f.permission) ? { path: f.path, label: f.label } : null;
}

/** The Home dot's words: the worst light, and that it opens System Health. */
export const HOME_DOT: Record<Exclude<HealthLight, 'grey'>, string> = {
  green: 'System health: everything is in order',
  amber: 'System health: something needs doing soon',
  red: 'System health: something needs doing now',
};
