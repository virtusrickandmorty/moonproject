/** Accounting & Tax › Chart of accounts (PLAN D2): the words and the checks in front of the server's own rules, kept apart from the page so they can be tested. */
import type { CoaAccount, NewAccountBody } from '../../api.ts';

export const TYPE_WORDS: Record<CoaAccount['type'], string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };
export const TYPES = Object.keys(TYPE_WORDS) as CoaAccount['type'][];
const NORMAL: Record<CoaAccount['type'], 'debit' | 'credit'> = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' };

/** The balance on the account's own side: positive when it is where the account normally sits. `balanceCents` from the server is debit-positive. */
export const ownSideCents = (a: Pick<CoaAccount, 'normalSide' | 'balanceCents'>) => (a.normalSide === 'debit' ? a.balanceCents : -a.balanceCents);

/** What the list says about an account besides its name: header, cash place, posting-rule role, reserved. */
export function accountNotes(a: CoaAccount): string[] {
  return [
    ...(a.isHeader ? ['Heading'] : []),
    ...(a.isCashPlace ? ['Cash place: managed in Cash Accounts'] : []),
    ...(a.roleKey ? ['Used by the posting rules'] : []),
    ...(a.isReserved ? ['Reserved'] : []),
  ];
}

/** The list, with inactive accounts left out when asked. Rows stay in the code order the server sent. */
export const visibleAccounts = (accounts: CoaAccount[], showInactive: boolean) => (showInactive ? accounts : accounts.filter((a) => a.isActive));

export interface NewAccountValues { code: string; name: string; type: CoaAccount['type']; contra: boolean }

/** The new account's body, or plain messages. The code rules are the server's (four digits from 1000 to 8999; 1101 to 1189 are cash places). */
export function newAccountInput(v: NewAccountValues): { errors: string[]; body?: NewAccountBody } {
  const code = v.code.trim();
  const name = v.name.trim();
  const errors: string[] = [];
  if (!/^[1-8]\d{3}$/.test(code)) errors.push('Use a four-digit code from 1000 to 8999.');
  else if (/^11(0[1-9]|[1-8]\d)$/.test(code)) errors.push('Codes 1101 to 1189 are cash places. Add a cash place in the Cash Accounts screen.');
  if (name.length < 3 || name.length > 120) errors.push('The name needs 3 to 120 characters.');
  if (errors.length) return { errors };
  const opposite = NORMAL[v.type] === 'debit' ? 'credit' : 'debit';
  return { errors, body: { code, name, type: v.type, ...(v.contra ? { normalSide: opposite } : {}) } };
}

/** The new name, or a plain message. */
export function renameInput(name: string, current: string): { error: string; name?: string } {
  const n = name.trim();
  if (n.length < 3 || n.length > 120) return { error: 'The name needs 3 to 120 characters.' };
  if (n === current) return { error: 'Enter a different name.' };
  return { error: '', name: n };
}
