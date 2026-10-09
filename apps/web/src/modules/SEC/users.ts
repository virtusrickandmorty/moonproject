/** Admin › Users: the words and the checks in front of the server's own (PLAN C6), kept apart from the page so they can be tested. */
import { ROLES } from '@moonproject/shared';

/** The roles as departments (the owner's decision, Oct 9, 2026); the keys stay as they were. */
export const ROLE_LABELS: Record<string, string> = { owner: 'Administrator', accountant: 'Accounting', encoder: 'Sales', production: 'Production', purchasing: 'Purchasing', tv: 'Live view' };
export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;
/** What each role is for, shown beside the tick boxes. */
export const ROLE_HINTS: Record<string, string> = {
  owner: 'The owner: everything this role is given, including these screens.',
  accountant: 'Books, taxes and settings.',
  encoder: 'Day-to-day sales, job orders, collections and expenses.',
  production: 'Sees and assigns production work.',
  purchasing: 'Suppliers, purchase orders, receiving, supplier bills and stock counts.',
  tv: 'Read-only production board for the shop TV.',
};
/** Departments in the order the screens show them. */
export const ROLE_ORDER: readonly string[] = ['owner', 'accountant', 'encoder', 'production', 'purchasing', 'tv'];
/** Role keys in the screens' order (any the screen does not know yet go last, as the server lists them). */
export const sortRoles = (roles: string[]) => [...ROLE_ORDER.filter((r) => roles.includes(r)), ...ROLES.filter((r) => roles.includes(r) && !ROLE_ORDER.includes(r))];
export const rolesWords = (roles: string[]) => (roles.length ? sortRoles(roles).map(roleLabel).join(', ') : 'No role');

export interface NewUserValues { username: string; displayName: string; roles: string[]; temporaryPassword: string }

/** The new user's body, or the plain messages to show first. The passphrase rules are the server's: its message is shown as it is. */
export function newUserInput(v: NewUserValues): { errors: string[]; body?: { username: string; displayName: string; roles: string[]; temporaryPassword: string } } {
  const username = v.username.trim();
  const displayName = v.displayName.trim();
  const errors: string[] = [];
  if (username.length < 2 || username.length > 40) errors.push('The username needs 2 to 40 characters.');
  // Signing in matches the username exactly, so it is kept to one plain word: a full name with spaces typed here (the two
  // boxes swapped) or a capital letter a phone adds by itself would lock the person out.
  else if (/\s/.test(username)) errors.push(`A username is one word with no spaces, like "${username.split(/\s+/)[0]!.toLowerCase()}". Is "${username}" the name to show? Put it in "Name to show".`);
  else if (!/^[a-z0-9._-]+$/.test(username)) errors.push('Use small letters, numbers, dots, dashes or underscores in the username (no capitals), so it is typed the same way every time.');
  if (!displayName || displayName.length > 80) errors.push('Enter the name to show, up to 80 characters.');
  if (v.roles.length === 0) errors.push('Give the user at least one role.');
  if (!v.temporaryPassword) errors.push('Enter a temporary password.');
  if (errors.length) return { errors };
  return { errors, body: { username, displayName, roles: sortRoles(v.roles), temporaryPassword: v.temporaryPassword } };
}

export const rolesInput = (roles: string[]) => sortRoles(roles);

/** A user cannot deactivate their own login; the server refuses it too (SELF_DEACTIVATE). */
export const canDeactivate = (meId: string, userId: string) => meId !== userId;
