/** Owner money and officer transactions as typed -> server input (PLAN E10), and back for an edit. Pure, so they are tested without a browser. */
import { formatPesos } from '@moonproject/shared';
import type { EqPerson } from '../../api.ts';
import { cents } from '../COL/money.ts';

/** Owner money is always in; how the accountant classifies it (the server's CLASSIFICATIONS), in words. */
export const CLASSIFICATIONS: [string, string][] = [
  ['advance', 'An advance: the company owes it back'],
  ['capital_stock', 'Payment for capital stock'],
  ['subscription_payment', 'Payment on a stock subscription'],
  ['dffs_equity', 'Deposit for future stock subscription (equity)'],
  ['dffs_liability', 'Deposit for future stock subscription (liability)'],
];

/** Only the accountant classifies (eq.own.classify, ACC-10), and only a stockholder's money is more than an advance. `current` stays pickable on an edit. */
export const classificationsFor = (p: EqPerson | undefined, canClassify: boolean, current = 'advance') =>
  CLASSIFICATIONS.filter(([k]) => k === 'advance' || k === current || (canClassify && p?.isStockholder));

/** Officer money in or out: the kind, in words, and the cash place question it asks. */
export const OFFICER_KINDS = [
  ['taken', 'Out: they took money, or the company paid a personal expense of theirs', 'Where did the money come from?'],
  ['returned', 'In: they paid back money they took', 'Where did the money go?'],
  ['repaid_to_officer', 'Out: the company paid back money they advanced', 'Where did the money come from?'],
] as const;

export const personLabel = (p: EqPerson) => `${p.name} (${[p.isStockholder && 'stockholder', p.isOfficer && (p.position ?? 'officer')].filter(Boolean).join(', ')})`;

/** `kind` is the owner money's classification or the officer transaction's kind; `note` is the officer's purpose. */
export interface EqValues { personId: string; kind: string; cashPlaceId: string; amount: string; parValue: string; note: string }
export const emptyEq = (kind: string): EqValues => ({ personId: '', kind, cashPlaceId: '', amount: '', parValue: '', note: '' });

function checked(v: EqValues, who: string, where: string) {
  const amountCents = cents(v.amount);
  const errors = [
    ...(v.personId ? [] : [`Pick the ${who}.`]),
    ...(v.kind ? [] : ['Pick in or out.']),
    ...(v.cashPlaceId ? [] : [`Pick ${where}.`]),
    ...(amountCents === undefined || amountCents <= 0 ? ['Type the amount, like 5,000.00'] : []),
  ];
  return { base: { personId: v.personId, cashPlaceId: Number(v.cashPlaceId), amountCents: amountCents ?? 0 }, errors };
}

export function ownerMoneyInput(v: EqValues) {
  const { base, errors } = checked(v, 'owner', 'where the money went');
  const par = v.kind === 'capital_stock' ? cents(v.parValue) : 0;
  if (par === undefined || (v.kind === 'capital_stock' && par <= 0)) errors.push('Type the par value of the shares issued.');
  return { input: { ...base, classification: v.kind, ...(par ? { parValueCents: par } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) }, errors };
}

export function officerInput(v: EqValues) {
  const { base, errors } = checked(v, 'officer', v.kind === 'returned' ? 'where the money went' : 'where the money came from');
  if (v.note.trim().length < 3) errors.push('Say what it was for.');
  return { input: { ...base, kind: v.kind, purpose: v.note.trim() }, errors };
}

/** A recorded owner money or officer transaction's input -> typed values, to prefill an edit. */
export const eqValues = (i: { personId: string; cashPlaceId: number; amountCents: number; classification?: string; kind?: string; parValueCents?: number; note?: string; purpose?: string }): EqValues => ({
  personId: i.personId, kind: i.classification ?? i.kind ?? '', cashPlaceId: String(i.cashPlaceId), amount: formatPesos(i.amountCents),
  parValue: i.parValueCents ? formatPesos(i.parValueCents) : '', note: i.note ?? i.purpose ?? '',
});
