import { schemaFields, type BoxErrors } from '../JO/boxes.ts';
import { collectionTenderInput, tenderInput } from './validation.ts';
import { cents, type TenderRow } from './money.ts';

/** Validate every typed row before the request builder leaves blank or invalid rows out. */
export function tenderFields(rows: TenderRow[], checks: ReadonlySet<number> = new Set(), max = 10, today = ''): BoxErrors {
  const errors: BoxErrors = {};
  let used = 0;
  rows.forEach((r, i) => {
    if (!r.cashPlaceId && !r.amount.trim() && !r.reference.trim()) return;
    used++;
    const check = checks.has(Number(r.cashPlaceId));
    const parsed = schemaFields(check ? collectionTenderInput : tenderInput, { cashPlaceId: Number(r.cashPlaceId), amountCents: cents(r.amount),
      ...(r.reference.trim() ? { reference: r.reference.trim() } : {}), ...(check ? { check: { number: r.checkNumber?.trim() ?? '', bank: r.bank?.trim() ?? '', date: r.checkDate ?? '' } } : {}) });
    Object.assign(errors, Object.fromEntries(Object.entries(parsed).map(([name, message]) => [`tenders.${i}.${name}`, message])));
    if (check && today && (r.checkDate ?? '') > today) errors[`tenders.${i}.check.date`] = 'Put a post-dated check on the post-dated checks list until its date.';
  });
  if (!used) { errors['tenders.0.cashPlaceId'] = 'Pick where the money went.'; errors['tenders.0.amountCents'] = 'Type the amount.'; }
  if (used > max) errors.tenders = `Use at most ${max} payments.`;
  return errors;
}
