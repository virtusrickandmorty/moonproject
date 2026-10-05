/**
 * Users, Roles and permissions, Chart of accounts and Settings screens: the menu shows each only with its permission,
 * each screen draws its data, each action asks the right route with the right body, and every refusal reaches the
 * screen as the server's own plain message (against the real server, in memory).
 */
import { describe, expect, it } from 'vitest';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key, type CoaAccount, type Me, type RoleGrid, type Setting, type UserRow } from '../api.ts';
import { buildMenu } from '../shell/menu.ts';
import { PAGES } from './screens.ts';
import { AccountTable, ChartOfAccounts } from './ACC/ChartOfAccounts.tsx';
import { ChangePreview, Settings, SettingList, ValueFields } from './ACC/Settings.tsx';
import { accountNotes, newAccountInput, ownSideCents, renameInput, visibleAccounts } from './ACC/coa.ts';
import { checkDraft, laterVersions, ownScreensFor, percentToBp, valueOn, wordsOf } from './ACC/settings.ts';
import { PermissionGrid, Roles } from './SEC/Roles.tsx';
import { UserTable, Users } from './SEC/Users.tsx';
import { changesFor, grantsOf, groupPermissions, ownerLosses } from './SEC/roles.ts';
import { canDeactivate, newUserInput, rolesWords } from './SEC/users.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const me = (permissions: string[]): Me => ({ userId: 'u-me', username: 'me', displayName: 'Me', roles: [], permissions, mustChangePassword: false, csrfToken: '' });
const html = <P extends object>(component: FunctionComponent<P>, props: P) => renderToStaticMarkup(createElement(component, props));
const menuOf = (group: string, permissions: string[]) => buildMenu([], new Set(permissions)).find((g) => g.group === group)?.items.map((i) => `${i.label} ${i.path}`) ?? [];

const users: UserRow[] = [
  { id: 'u-me', username: 'owner1', displayName: 'Owner One', isActive: true, mustChangePassword: false, roles: ['owner'] },
  { id: 'u-2', username: 'maria', displayName: 'Maria Sample', isActive: true, mustChangePassword: true, roles: ['accountant', 'encoder'] },
  { id: 'u-3', username: 'jose', displayName: 'Jose Sample', isActive: false, mustChangePassword: false, roles: [] },
];
const grid: RoleGrid = {
  roles: ['encoder', 'accountant', 'owner', 'production', 'tv'],
  permissions: [
    { key: 'sec.users.manage', module: 'SEC', label: 'Manage users, roles and passwords', roles: ['owner'] },
    { key: 'acc.coa.view', module: 'ACC', label: 'See the chart of accounts with balances', roles: ['accountant', 'owner'] },
    { key: 'acc.coa.manage', module: 'ACC', label: 'Add, rename, reserve and deactivate accounts', roles: ['accountant'] },
  ],
};
const account = (patch: Partial<CoaAccount> = {}): CoaAccount => ({
  id: 1, code: '1201', name: 'Accounts receivable – trade', type: 'asset', normalSide: 'debit', roleKey: 'AR_TRADE', partyType: 'customer', isHeader: false, isCashPlace: false,
  isReserved: false, isActive: true, version: 1, balanceCents: 250_000, ...patch,
});
const vatSetting: Setting = {
  key: 'tax.vat_rate_bp', label: 'VAT rate, in basis points (1200 = 12%)', current: 1200,
  versions: [
    { id: 2, key: 'tax.vat_rate_bp', effectiveFrom: '2027-01-01', value: 1000, reason: 'Planned change', createdAt: '', createdBy: null },
    { id: 1, key: 'tax.vat_rate_bp', effectiveFrom: '2000-01-01', value: 1200, reason: 'Default', createdAt: '', createdBy: null },
  ],
};

describe('menu', () => {
  it('shows each item only with its permission; Settings is for every signed-in user', () => {
    expect(menuOf('Admin', ['sec.users.manage'])).toEqual(expect.arrayContaining(['Users /admin/users', 'Roles and permissions /admin/roles']));
    expect(menuOf('Admin', [])).not.toContain('Users /admin/users');
    expect(menuOf('Admin', ['acc.coa.view'])).not.toContain('Roles and permissions /admin/roles');
    expect(menuOf('Accounting & Tax', ['acc.coa.view'])).toContain('Chart of accounts /acc/chart');
    expect(menuOf('Accounting & Tax', ['acc.coa.manage'])).not.toContain('Chart of accounts /acc/chart'); // seeing is acc.coa.view
    expect(menuOf('Accounting & Tax', [])).toEqual(['Settings /acc/settings']);
  });

  it('routes the four screens', () => {
    expect([PAGES['/admin/users'], PAGES['/admin/roles'], PAGES['/acc/chart'], PAGES['/acc/settings']]).toEqual([Users, Roles, ChartOfAccounts, Settings]);
  });
});

describe('Users screen', () => {
  it('lists name, username, roles and whether each is active; you cannot deactivate yourself', () => {
    const out = html(UserTable, { users, meId: 'u-me', onOpen: () => undefined });
    for (const text of ['Owner One', '(you)', 'owner1', 'Owner', 'Maria Sample', 'Encoder, Accountant', 'Must choose a new password at next sign-in', 'Jose Sample', 'No role', 'Deactivated']) expect(out).toContain(text);
    expect(out.match(/>Deactivate</g)?.length).toBe(1); // Maria only; Owner One is you and Jose is already inactive
    expect(out).toContain('>Activate<');
    expect(out.match(/>Reset password</g)?.length).toBe(3);
    expect([canDeactivate('u-me', 'u-me'), canDeactivate('u-me', 'u-2')]).toEqual([false, true]);
    expect(rolesWords(['tv', 'owner'])).toBe('Owner, TV board');
  });

  it('refuses a user without sec.users.manage', () => {
    expect(html(Users, { me: me([]) })).toContain('do not have permission');
    expect(html(Roles, { me: me([]) })).toContain('do not have permission');
  });

  it('checks the new user in plain words and builds the body the server takes', () => {
    expect(newUserInput({ username: 'a', displayName: '', roles: [], temporaryPassword: '' }).errors).toEqual([
      'The username needs 2 to 40 characters.', 'Enter the name to show, up to 80 characters.', 'Give the user at least one role.', 'Enter a temporary password.',
    ]);
    // The two boxes swapped (the full name typed as the username) and capitals are caught before the user is made.
    expect(newUserInput({ username: 'Juan Dela Cruz', displayName: 'juan', roles: ['encoder'], temporaryPassword: 'x' }).errors)
      .toEqual(['A username is one word with no spaces, like "juan". Is "Juan Dela Cruz" the name to show? Put it in "Name to show".']);
    expect(newUserInput({ username: 'Juan', displayName: 'Juan', roles: ['encoder'], temporaryPassword: 'x' }).errors[0]).toMatch(/no capitals/);
    expect(newUserInput({ username: ' maria ', displayName: ' Maria Sample ', roles: ['encoder', 'accountant'], temporaryPassword: 'three little pigs walked' }).body).toEqual({
      username: 'maria', displayName: 'Maria Sample', roles: ['encoder', 'accountant'], temporaryPassword: 'three little pigs walked',
    });
  });
});

describe('Roles and permissions screen', () => {
  it('draws every permission by its plain label, grouped by module, against every role, with the ticks', () => {
    const saved = grantsOf(grid);
    const out = html(PermissionGrid, { grid, draft: saved, saved, onTick: () => undefined });
    for (const text of ['Accounting &amp; journals', 'Users &amp; security', 'Manage users, roles and passwords', 'Encoder', 'Accountant', 'Owner', 'Production', 'TV board']) expect(out).toContain(text);
    expect(out.match(/type="checkbox"/g)?.length).toBe(15); // 3 permissions x 5 roles
    expect(out.match(/checked=""/g)?.length).toBe(4); // owner x2, accountant x2
    expect(groupPermissions(grid.permissions).map((g) => [g.name, g.permissions.length])).toEqual([['Accounting & journals', 2], ['Users & security', 1]]);
  });

  it('saves a role by the permissions whose tick changed, and warns before the owner loses what runs this screen', () => {
    const saved = grantsOf(grid);
    const draft = new Set(saved.owner);
    draft.delete('sec.users.manage');
    draft.add('acc.coa.manage');
    const keys = grid.permissions.map((p) => p.key);
    const changes = changesFor(saved.owner!, draft, keys);
    expect(changes).toEqual([{ permissionKey: 'sec.users.manage', granted: false }, { permissionKey: 'acc.coa.manage', granted: true }]);
    expect(ownerLosses('owner', changes)).toEqual(['Manage users, roles and passwords']);
    expect(ownerLosses('accountant', changes)).toEqual([]);
    expect(ownerLosses('owner', [{ permissionKey: 'sec.users.manage', granted: true }])).toEqual([]);
    expect(changesFor(saved.owner!, saved.owner!, keys)).toEqual([]);
  });
});

describe('Chart of accounts screen', () => {
  const rows = [
    account({ id: 9, code: '1000', name: 'ASSETS', isHeader: true, roleKey: null, balanceCents: 0 }),
    account(),
    account({ id: 2, code: '6110', name: 'Rent expense', type: 'expense', roleKey: null, partyType: null, isActive: false, balanceCents: 0 }),
    account({ id: 3, code: '2301', name: 'Output VAT', type: 'liability', normalSide: 'credit', roleKey: 'OUTPUT_VAT', balanceCents: -120_000 }),
  ];

  it('draws code, name, type, role key, balance and active, with the change buttons only for acc.coa.manage', () => {
    const out = html(AccountTable, { accounts: rows, manage: true });
    for (const text of ['1000', 'ASSETS', 'Heading', 'Accounts receivable – trade', 'Asset', 'AR_TRADE', '2,500.00', 'Output VAT', 'Liability', '1,200.00', 'Used by the posting rules', 'Rent expense', 'Expense']) expect(out).toContain(text);
    expect(out.match(/>Rename</g)?.length).toBe(4);
    expect(out.match(/>Activate</g)?.length).toBe(1);
    expect(out.match(/>Deactivate</g)?.length).toBe(3);
    expect(html(AccountTable, { accounts: rows, manage: false })).not.toContain('>Rename<');
    expect(ownSideCents(rows[3]!)).toBe(120_000); // a credit balance shows as positive on a credit account
    expect(accountNotes(account({ isCashPlace: true, isReserved: true, roleKey: null }))).toEqual(['Cash place: managed in Cash Accounts', 'Reserved']);
    expect(visibleAccounts(rows, false).map((a) => a.code)).toEqual(['1000', '1201', '2301']);
    expect(html(ChartOfAccounts, { me: me([]) })).toContain('do not have permission');
  });

  it('checks a new account and a new name with the server\'s rules in plain words', () => {
    expect(newAccountInput({ code: '99', name: 'ab', type: 'expense', contra: false }).errors).toEqual(['Use a four-digit code from 1000 to 8999.', 'The name needs 3 to 120 characters.']);
    expect(newAccountInput({ code: '1150', name: 'Petty box', type: 'asset', contra: false }).errors[0]).toBe('Codes 1101 to 1189 are cash places. Add a cash place in the Cash Accounts screen.');
    expect(newAccountInput({ code: '6190', name: ' Delivery costs ', type: 'expense', contra: false }).body).toEqual({ code: '6190', name: 'Delivery costs', type: 'expense' });
    expect(newAccountInput({ code: '1295', name: 'Allowance for x', type: 'asset', contra: true }).body).toEqual({ code: '1295', name: 'Allowance for x', type: 'asset', normalSide: 'credit' });
    expect(renameInput('Rent', 'Rent')).toEqual({ error: 'Enter a different name.' });
    expect(renameInput('R', 'Rent').error).toContain('3 to 120');
    expect(renameInput(' Office rent ', 'Rent')).toEqual({ error: '', name: 'Office rent' });
  });
});

describe('Settings screen', () => {
  it('shows the value in force today in plain words with its dated history, and links settings that have their own screen', () => {
    const list = html(SettingList, { settings: [vatSetting], today: '2026-09-28', mayChange: true });
    for (const text of ['VAT rate', 'In force today', '12%', '2000-01-01', '2027-01-01', '10%', 'starts later', 'Planned change', 'Default', 'New version from a date']) expect(list).toContain(text);
    expect(html(SettingList, { settings: [vatSetting], today: '2026-09-28', mayChange: false })).not.toContain('New version from a date');
    expect(ownScreensFor(['tax.registers.view']).map((s) => s.path)).toEqual(['/tax/1702q', '/tax/1702rt']);
    expect(ownScreensFor([])).toEqual([]);
    expect(wordsOf('col.cr_mode', { mode: 'system', signOff: { name: 'Ana Cruz', date: '2026-09-01', basis: 'Reviewed the booklet' } })).toBe('Numbered and printed by the system, signed off by Ana Cruz on 2026-09-01');
    expect(wordsOf('tax.top_withholding_agent', true)).toBe('Yes');
    expect(wordsOf('sales.deposit_vat_mode', 'B')).toBe('B: VAT on the deposit');
  });

  it('reads the value in force on a date from its versions, and sees later versions that will replace a new one', () => {
    expect([valueOn(vatSetting.versions, '2026-09-28'), valueOn(vatSetting.versions, '2027-01-01')]).toEqual([1200, 1000]);
    expect(laterVersions(vatSetting.versions, '2026-09-28').map((v) => v.effectiveFrom)).toEqual(['2027-01-01']);
    expect(percentToBp('12')).toBe(1200);
    expect(percentToBp('1.25')).toBe(125);
    expect([percentToBp('x'), percentToBp('1.255'), percentToBp('')]).toEqual([null, null, null]);
  });

  it('previews the old value beside the new before saving, and says plainly what is wrong', () => {
    const draft = { effectiveFrom: '2026-10-01', form: { percent: '10' }, reason: 'Rate cut by law' };
    const ok = checkDraft(vatSetting, draft, '2026-09-28');
    expect(ok.body).toEqual({ effectiveFrom: '2026-10-01', value: 1000, reason: 'Rate cut by law' });
    expect(ok.preview?.rows).toEqual([{ label: 'VAT rate', before: '12%', after: '10%', changed: true }]);
    expect(ok.preview?.later.map((v) => v.effectiveFrom)).toEqual(['2027-01-01']);
    const shown = renderToStaticMarkup(createElement(ChangePreview, { checked: ok, from: '2026-10-01' }));
    for (const text of ['12%', '10%', 'What changes', 'already starts on 2027-01-01']) expect(shown).toContain(text);
    expect(checkDraft(vatSetting, { ...draft, form: { percent: '12' } }, '2026-09-28').preview?.unchanged).toBe(true);
    expect(checkDraft(vatSetting, { effectiveFrom: '2026-09-01', form: { percent: '60' }, reason: 'short' }, '2026-09-28').errors).toEqual([
      'A setting can change from today or a later date, never an earlier one, so recorded documents keep the setting they used.',
      'Enter a percent from 0 to 50, with at most 2 decimals.', 'Give a reason of 10 to 500 characters.',
    ]);
    const cr = { key: 'col.cr_mode', label: '', current: { mode: 'booklet' }, versions: [{ id: 1, key: 'col.cr_mode', effectiveFrom: '2000-01-01', value: { mode: 'booklet' }, reason: 'Default', createdAt: '', createdBy: null }] };
    expect(checkDraft(cr, { effectiveFrom: '2026-10-01', form: { mode: 'system', name: 'A', date: '', basis: 'x' }, reason: 'Switching to system numbers' }, '2026-09-28').errors).toHaveLength(3);
    const eight = Object.fromEntries(['rent_5', 'contractor_2', 'prof_ind_5', 'prof_ind_10', 'prof_firm_10', 'prof_firm_15', 'goods_1', 'services_2'].map((k) => [k, '5']));
    expect(html(ValueFields, { settingKey: 'tax.ewt_rates_bp', form: eight, set: () => undefined }).match(/<input/g)?.length).toBe(8);
  });
});

/** Every action's route and body, as the api client sends them. */
describe('the routes the actions call', () => {
  it('sends the right method, path, body and version header', async () => {
    const sent: { method: string; url: string; body: unknown; ifMatch?: string }[] = [];
    const web = createApi(async (url, init) => {
      sent.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body as string) : undefined, ifMatch: (init.headers as Record<string, string>)['if-match'] });
      return new Response('{}', { status: 200 });
    });
    await web.users();
    await web.addUser({ username: 'maria', displayName: 'Maria Sample', roles: ['encoder'], temporaryPassword: 'three little pigs walked' });
    await web.setUserRoles('u 2', ['accountant']);
    await web.resetUserPassword('u-2', 'a much longer temporary phrase');
    await web.setUserActive('u-2', false);
    await web.roles();
    await web.setRolePermission('owner', 'acc.coa.view', true);
    await web.coaAccounts();
    await web.addAccount({ code: '6190', name: 'Delivery costs', type: 'expense' });
    await web.renameAccount(7, 3, 'Office rent');
    await web.deactivateAccount(7, 4);
    await web.activateAccount(7, 5);
    await web.settings();
    await web.addSetting('tax.vat_rate_bp', { effectiveFrom: '2026-10-01', value: 1000, reason: 'Rate cut by law' });
    expect(sent).toEqual([
      { method: 'GET', url: '/api/users', body: undefined },
      { method: 'POST', url: '/api/users', body: { username: 'maria', displayName: 'Maria Sample', roles: ['encoder'], temporaryPassword: 'three little pigs walked' } },
      { method: 'POST', url: '/api/users/u%202/roles', body: { roles: ['accountant'] } },
      { method: 'POST', url: '/api/users/u-2/reset-password', body: { temporaryPassword: 'a much longer temporary phrase' } },
      { method: 'POST', url: '/api/users/u-2/active', body: { active: false } },
      { method: 'GET', url: '/api/roles', body: undefined },
      { method: 'POST', url: '/api/roles/owner/permissions', body: { permissionKey: 'acc.coa.view', granted: true } },
      { method: 'GET', url: '/api/acc/accounts', body: undefined },
      { method: 'POST', url: '/api/acc/accounts', body: { code: '6190', name: 'Delivery costs', type: 'expense' } },
      { method: 'PUT', url: '/api/acc/accounts/7', body: { name: 'Office rent' }, ifMatch: '3' },
      { method: 'POST', url: '/api/acc/accounts/7/deactivate', body: undefined, ifMatch: '4' },
      { method: 'POST', url: '/api/acc/accounts/7/activate', body: undefined, ifMatch: '5' },
      { method: 'GET', url: '/api/settings', body: undefined },
      { method: 'POST', url: '/api/settings/tax.vat_rate_bp', body: { effectiveFrom: '2026-10-01', value: 1000, reason: 'Rate cut by law' } },
    ].map((r) => ({ ifMatch: undefined, ...r })));
  });
});

describe('the screens against the real server', () => {
  it('users: add with step-up, change roles, reset a password, deactivate; every refusal in the server\'s words', async () => {
    const env = await createTestEnv(); // today is 2026-09-28
    const ownerId = createUser(env.db, 'owner1', ['owner']);
    createUser(env.db, 'enc1', ['encoder']);
    const web = createApi(injectFetch(env.app));
    await web.login('owner1', PASSWORD);

    const body = { username: 'maria', displayName: 'Maria Sample', roles: ['encoder'], temporaryPassword: 'three little pigs walked' };
    await expect(web.addUser(body)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED', message: 'Please enter your password again to continue.' });
    await expect(web.stepUp('wrong password entirely')).rejects.toMatchObject({ code: 'BAD_PASSWORD', message: 'Wrong password.' });
    await web.stepUp(PASSWORD);
    await expect(web.addUser({ ...body, temporaryPassword: 'too short' })).rejects.toMatchObject({ code: 'WEAK_PASSWORD', message: 'Use a passphrase of at least 15 characters, for example three or four words.' });
    await expect(web.addUser({ ...body, username: 'enc1' })).rejects.toMatchObject({ code: 'USERNAME_TAKEN', message: 'That username is already used.' });
    const { id } = await web.addUser(body);

    const list = await web.users();
    expect(list.find((u) => u.id === id)).toMatchObject({ username: 'maria', displayName: 'Maria Sample', roles: ['encoder'], isActive: true, mustChangePassword: true });
    expect(html(UserTable, { users: list, meId: ownerId, onOpen: () => undefined })).toContain('Maria Sample');

    await web.setUserRoles(id, ['accountant', 'encoder']);
    expect((await web.users()).find((u) => u.id === id)?.roles.sort()).toEqual(['accountant', 'encoder']);
    await expect(web.resetUserPassword(id, 'maria is short')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
    await web.resetUserPassword(id, 'a brand new long phrase');
    await expect(web.setUserActive(ownerId, false)).rejects.toMatchObject({ code: 'SELF_DEACTIVATE', message: 'You cannot deactivate yourself.' });
    await web.setUserActive(id, false);
    expect((await web.users()).find((u) => u.id === id)?.isActive).toBe(false);
    await web.setUserActive(id, true);
    expect((await web.users()).find((u) => u.id === id)?.isActive).toBe(true);

    const enc = createApi(injectFetch(env.app));
    await enc.login('enc1', PASSWORD);
    await expect(enc.users()).rejects.toMatchObject({ status: 403 });
    await env.app.close();
  });

  it('roles: the grid has every permission and role, a tick saves, and is read back', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'owner1', ['owner']);
    const web = createApi(injectFetch(env.app));
    await web.login('owner1', PASSWORD);
    const g = await web.roles();
    expect(g.roles).toEqual(['encoder', 'accountant', 'owner', 'production', 'tv']);
    expect(g.permissions.find((p) => p.key === 'sec.users.manage')).toMatchObject({ module: 'SEC', label: 'Manage users, roles and passwords', roles: ['owner'] });
    expect(groupPermissions(g.permissions).length).toBeGreaterThan(10);
    await expect(web.setRolePermission('encoder', 'acc.coa.view', true)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await web.stepUp(PASSWORD);
    await expect(web.setRolePermission('encoder', 'no.such.key', true)).rejects.toMatchObject({ status: 404 });
    await web.setRolePermission('encoder', 'acc.coa.view', true);
    expect((await web.roles()).permissions.find((p) => p.key === 'acc.coa.view')?.roles).toContain('encoder');
    await web.setRolePermission('encoder', 'acc.coa.view', false);
    expect((await web.roles()).permissions.find((p) => p.key === 'acc.coa.view')?.roles).not.toContain('encoder');
    await env.app.close();
  });

  it('chart of accounts: add, rename, and the refusals for a role, a balance and a stale version', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    const web = createApi(injectFetch(env.app));
    await web.login('acct1', PASSWORD);
    const all = await web.coaAccounts();
    expect(all.map((a) => a.code)).toEqual([...all.map((a) => a.code)].sort()); // code order
    const byCode = (code: string, list = all) => list.find((a) => a.code === code)!;
    expect(all.some((a) => a.isHeader)).toBe(true);
    expect(html(AccountTable, { accounts: all, manage: true })).toContain('Accounts receivable');

    const made = await web.addAccount({ code: '8897', name: 'Delivery costs', type: 'expense' });
    expect(made).toMatchObject({ code: '8897', isActive: true, normalSide: 'debit', version: 1 });
    await expect(web.addAccount({ code: '8897', name: 'Delivery again', type: 'expense' })).rejects.toMatchObject({ code: 'CODE_EXISTS', message: 'Account 8897 already exists.' });
    await expect(web.addAccount({ code: '1150', name: 'Petty box', type: 'asset' })).rejects.toMatchObject({ code: 'CASH_PLACE_CODE' });
    const renamed = await web.renameAccount(made.id, made.version, 'Delivery and freight');
    expect(renamed).toMatchObject({ name: 'Delivery and freight', version: 2 });
    await expect(web.renameAccount(made.id, made.version, 'Stale name here')).rejects.toMatchObject({ code: 'VERSION_CHANGED', message: 'Someone changed this account. Reload it and review their change.' });

    const ar = byCode('1201');
    await web.stepUp(PASSWORD);
    await expect(web.deactivateAccount(ar.id, ar.version)).rejects.toMatchObject({ code: 'ACCOUNT_HAS_ROLE', message: '1201 Accounts receivable – trade is used by the posting rules and stays active. Rename it instead.' });

    const rent = byCode('6110');
    await web.post('acc.jv', { memo: 'Rent paid', lines: [{ accountId: rent.id, debitCents: 100_000 }, { accountId: byCode('1101').id, creditCents: 100_000 }] }, 100_000, key());
    const withBalance = byCode('6110', await web.coaAccounts());
    expect(withBalance.balanceCents).toBe(100_000);
    await expect(web.deactivateAccount(rent.id, withBalance.version)).rejects.toMatchObject({ code: 'ACCOUNT_HAS_BALANCE', message: '6110 Rent still has a balance. Move it with a journal voucher first.' });

    const off = await web.deactivateAccount(renamed.id, renamed.version);
    expect(off.isActive).toBe(false);
    await expect(web.deactivateAccount(renamed.id, off.version)).rejects.toMatchObject({ code: 'INACTIVE' });
    expect((await web.activateAccount(renamed.id, off.version)).isActive).toBe(true);

    createUser(env.db, 'owner1', ['owner']);
    const owner = createApi(injectFetch(env.app));
    await owner.login('owner1', PASSWORD);
    expect((await owner.coaAccounts()).length).toBe(all.length + 1); // the owner may see it
    await expect(owner.addAccount({ code: '6196', name: 'Not allowed', type: 'expense' })).rejects.toMatchObject({ status: 403 });
    await env.app.close();
  });

  it('settings: every user reads them; a new version needs acc.settings.manage and a fresh password; refusals in words', async () => {
    const env = await createTestEnv(); // today is 2026-09-28
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'enc1', ['encoder']);
    const web = createApi(injectFetch(env.app));
    await web.login('acct1', PASSWORD);
    const list = await web.settings();
    const vat = list.find((s) => s.key === 'tax.vat_rate_bp')!;
    expect(vat).toMatchObject({ current: 1200 });
    expect(vat.versions.length).toBeGreaterThan(0);
    expect(html(SettingList, { settings: list, today: '2026-09-28', mayChange: true })).toContain('12%');
    expect(list.map((s) => s.key)).toEqual(expect.arrayContaining(['sales.deposit_vat_mode', 'col.cr_mode', 'tax.top_withholding_agent', 'tax.ewt_rates_bp']));

    const draft = { effectiveFrom: '2026-10-01', form: { percent: '10' }, reason: 'Rate cut by law' };
    const { body, preview } = checkDraft(vat, draft, '2026-09-28');
    expect(preview?.rows).toEqual([{ label: 'VAT rate', before: '12%', after: '10%', changed: true }]);
    await expect(web.addSetting('tax.vat_rate_bp', body!)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await web.stepUp(PASSWORD);
    await expect(web.addSetting('tax.vat_rate_bp', { ...body!, effectiveFrom: '2026-09-01' })).rejects.toMatchObject({ code: 'SETTING_BACKDATED' });
    await expect(web.addSetting('tax.vat_rate_bp', { ...body!, value: 1200 })).rejects.toMatchObject({ code: 'NO_CHANGE', message: 'The setting already has this value on that date.' });
    await expect(web.addSetting('tax.vat_rate_bp', { ...body!, value: 9999 })).rejects.toMatchObject({ code: 'BAD_VALUE', message: 'This value is not allowed for this setting.' });
    await web.addSetting('tax.vat_rate_bp', body!);
    const after = (await web.settings()).find((s) => s.key === 'tax.vat_rate_bp')!;
    expect(after.current).toBe(1200); // today's value is unchanged until 1 October
    expect(after.versions[0]).toMatchObject({ effectiveFrom: '2026-10-01', value: 1000, reason: 'Rate cut by law' });
    expect(valueOn(after.versions, '2026-10-01')).toBe(1000);

    const cr = list.find((s) => s.key === 'col.cr_mode')!;
    const system = checkDraft(cr, { effectiveFrom: '2026-10-01', form: { mode: 'system', name: 'Ana Cruz', date: '2026-09-28', basis: 'Reviewed the booklet numbering' }, reason: 'Switching to system numbers' }, '2026-09-28');
    expect(system.errors).toEqual([]);
    await web.addSetting('col.cr_mode', system.body!);
    expect(wordsOf('col.cr_mode', valueOn((await web.settings()).find((s) => s.key === 'col.cr_mode')!.versions, '2026-10-01'))).toContain('signed off by Ana Cruz');

    const enc = createApi(injectFetch(env.app));
    await enc.login('enc1', PASSWORD);
    expect((await enc.settings()).length).toBe(list.length); // every signed-in user sees them
    await expect(enc.addSetting('tax.vat_rate_bp', body!)).rejects.toMatchObject({ status: 403 });
    await env.app.close();
  });
});
