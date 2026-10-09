/**
 * Permission keys are exact strings such as "cash.trf.post" (PLAN C6).
 * Modules declare their own keys and default role grants in defineModule().
 * There is no super-admin: an owner can do only what the Owner role grants.
 */
export type PermissionKey = string;

// Shown as departments (the owner's decision, Oct 9, 2026): Sales, Accounting, Administrator, Production, Live view, Purchasing.
export const ROLES = ['encoder', 'accountant', 'owner', 'production', 'tv', 'purchasing'] as const;
export type RoleKey = (typeof ROLES)[number];

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  /** Roles that get this permission on a fresh install. Owners can change the grid later. */
  defaultRoles: RoleKey[];
}
