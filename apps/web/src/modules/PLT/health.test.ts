import { describe, expect, it } from 'vitest';
import { PAGES } from '../screens.ts';
import { buildMenu } from '../../shell/menu.ts';
import { fixLink, HOME_DOT, OVERALL } from './health.ts';
import { restoredWords } from '../BAK/backups.ts';
import { addressKind } from '../SEC/fingerprint.ts';

describe('System health page', () => {
  it('links a light that is not green to the page that fixes it, when the user may open that page', () => {
    expect(fixLink('backups', 'red', ['bak.view'])).toEqual({ path: '/bak', label: 'Open Backups' });
    expect(fixLink('backups', 'red', [])).toBeNull();
    expect(fixLink('backups', 'green', ['bak.view'])).toBeNull();
    expect(fixLink('books', 'red', ['aud.integrity.view'])).toEqual({ path: '/aud/integrity', label: 'Open Integrity check' });
    expect(fixLink('practice', 'amber', [])).toEqual({ path: '/admin/practice', label: 'Open Practice shop' });
    expect(fixLink('disk', 'red', ['bak.view'])).toBeNull();
    expect(OVERALL.red).toBe('Something needs doing now. See the red lights.');
  });

  it('is in the Admin menu for those who may see it, at /admin/health', () => {
    expect(PAGES['/admin/health']).toBeDefined();
    const admin = (perms: string[]) => buildMenu([], new Set(perms)).find((g) => g.group === 'Admin')?.items.map((i) => i.label) ?? [];
    expect(admin(['sec.health.view'])).toContain('System health');
    expect(admin([])).not.toContain('System health');
  });

  it('shows one dot on the Home in words, a restore at the next sign-in, and where each join address works', () => {
    expect(HOME_DOT.red).toBe('System health: something needs doing now');
    expect(Object.keys(HOME_DOT)).toEqual(['green', 'amber', 'red']);
    expect(restoredWords({ file: 'moonproject-2026-09-28T09-00-00-daily.db.gz.age', at: '2026-09-28T10:05:00.000+08:00' }))
      .toBe('Restored from moonproject-2026-09-28T09-00-00-daily.db.gz.age at 2026-09-28 10:05.');
    expect(addressKind('vpn')).toContain('VPN');
  });
});
