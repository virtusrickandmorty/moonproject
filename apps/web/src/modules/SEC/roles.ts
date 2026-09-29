/** Admin › Roles and permissions: grouping, the changes a role's column has, and the permissions the owner must keep (PLAN C6). */
import type { RoleGrid } from '../../api.ts';

type Perm = RoleGrid['permissions'][number];

/** Plain names for the module codes the permissions table groups by. */
export const MODULE_NAMES: Record<string, string> = {
  ACC: 'Accounting & journals', AP: 'Payables', AUD: 'Audit & integrity', BAK: 'Backup & restore', CA: 'Cash advances', CAL: 'Calendar', CASH: 'Cash & banks',
  CAT: 'Catalog & pricing', COL: 'Collections & receivables', CUS: 'Customers & measurements', DASH: 'Homes and notifications', EMP: 'Employees & time', EQ: 'Owners & officers',
  EXP: 'Expenses', FA: 'Fixed assets', INV: 'Inventory', JO: 'Job orders & release', LOAN: 'Loans', MIG: 'Migration & opening', PAY: 'Payroll', PRD: 'Production',
  PRT: 'Printing & company profile', PUR: 'Suppliers & purchasing', QS: 'Quick sale', QUO: 'Quotations', RATE: 'Piece-rate table', RPT: 'Books & statements',
  STAT: 'Government remittances', SZR: 'Sizer tracker', TAX: 'Tax compliance', SEC: 'Users & security', PLT: 'Platform', NAV: 'Navigation', COM: 'Communications',
};
export const moduleName = (code: string) => MODULE_NAMES[code] ?? MODULE_NAMES[code.toUpperCase()] ?? code;

/**
 * The permissions the owner role needs to keep the shop running: the ones on the Users and Roles screens themselves.
 * Take them off the owner role and nobody can put them back from the browser.
 */
export const OWNER_KEEPS: Record<string, string> = { 'sec.users.manage': 'Manage users, roles and passwords' };

export interface PermGroup { module: string; name: string; permissions: Perm[] }
/** Permissions grouped by module (in module-name order), each group in the order the server sent. */
export function groupPermissions(perms: Perm[]): PermGroup[] {
  const by = new Map<string, Perm[]>();
  for (const p of perms) by.set(p.module, [...(by.get(p.module) ?? []), p]);
  return [...by].map(([module, permissions]) => ({ module, name: moduleName(module), permissions })).sort((a, b) => a.name.localeCompare(b.name));
}

/** What each role has now: role -> the keys it is granted. */
export const grantsOf = (grid: RoleGrid): Record<string, Set<string>> =>
  Object.fromEntries(grid.roles.map((r) => [r, new Set(grid.permissions.filter((p) => p.roles.includes(r)).map((p) => p.key))]));

export interface RoleChange { permissionKey: string; granted: boolean }
/** The changes to save for one role: where the ticks differ from what is saved. */
export function changesFor(saved: Set<string>, draft: Set<string>, keys: string[]): RoleChange[] {
  return keys.flatMap((k) => (saved.has(k) === draft.has(k) ? [] : [{ permissionKey: k, granted: draft.has(k) }]));
}

/** The kept permissions this change would take off the owner role, as plain labels; empty for any other role. */
export function ownerLosses(role: string, changes: RoleChange[]): string[] {
  return role === 'owner' ? changes.filter((c) => !c.granted && c.permissionKey in OWNER_KEEPS).map((c) => OWNER_KEEPS[c.permissionKey]!) : [];
}
