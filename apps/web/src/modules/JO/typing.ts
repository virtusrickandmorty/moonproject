import { cents } from '../COL/money.ts';
import { schemaFields, type BoxErrors } from './boxes.ts';
import { jobOrderInput, lineInput, openingJobOrderInput, releaseInput } from './validation.ts';
import { joInput, lineQty, type JoValues, type ReleaseValues } from './forms.ts';
import { openingInput, type OpeningValues } from './opening.ts';
import type { JoStatus } from '../../api.ts';

const prefix = (errors: BoxErrors, name: string): BoxErrors => Object.fromEntries(Object.entries(errors).map(([key, value]) => [`${name}.${key}`, value]));

export function joFields(v: JoValues): BoxErrors {
  const { input } = joInput(v);
  const errors = schemaFields(jobOrderInput, { ...input, dueInDays: Number(v.dueInDays), paymentTerms: v.paymentTerms });
  for (const key of Object.keys(errors)) if (key.startsWith('lines.')) delete errors[key];
  v.lines.forEach((l, i) => {
    if (!l.description.trim() && !l.price.trim() && !l.discount.trim() && !l.roster.length && !l.itemId) return;
    const roster = l.roster.map((r) => ({ ...(r.personId ? { personId: r.personId } : { name: r.name.trim() }), sizeMode: r.sizeMode,
      ...(r.sizeMode === 'preset' ? { size: r.size.trim().toUpperCase() } : {}), ...(r.jerseyName.trim() ? { jerseyName: r.jerseyName.trim().toUpperCase() } : {}),
      ...(r.jerseyNumber.trim() ? { jerseyNumber: r.jerseyNumber.trim() } : {}), qty: Number(r.qty) }));
    Object.assign(errors, prefix(schemaFields(lineInput, { kind: l.kind, description: l.description.trim(), qty: Number(lineQty(l)),
      unitPriceCents: cents(l.price), discountCents: cents(l.discount), roster }), `lines.${i}`));
    l.roster.forEach((r, j) => {
      if (!r.personId && !r.name.trim()) errors[`lines.${i}.roster.${j}.name`] = 'Pick a wearer or type a one-off name.';
      if (r.sizeMode === 'preset' && !r.size.trim()) errors[`lines.${i}.roster.${j}.size`] = 'Pick a size.';
    });
    if ((cents(l.discount) ?? 0) > Number(lineQty(l)) * (cents(l.price) ?? 0)) errors[`lines.${i}.discountCents`] = 'The discount is more than the line amount.';
  });
  return errors;
}

export function openingFields(v: OpeningValues): BoxErrors {
  const { input } = openingInput(v);
  const errors = schemaFields(openingJobOrderInput, { ...input, paymentTerms: v.paymentTerms, depositsCents: cents(v.deposits), receivableCents: cents(v.receivable) });
  for (const key of Object.keys(errors)) if (key.startsWith('lines.')) delete errors[key];
  v.lines.forEach((l, i) => {
    if (!l.description.trim() && !l.price.trim() && !l.discount.trim()) return;
    Object.assign(errors, prefix(schemaFields(lineInput, { kind: l.kind, description: l.description.trim(), qty: Number(l.qty),
      unitPriceCents: cents(l.price), discountCents: cents(l.discount), roster: l.roster }), `lines.${i}`));
    if ((cents(l.discount) ?? 0) > Number(l.qty) * (cents(l.price) ?? 0)) errors[`lines.${i}.discountCents`] = 'The discount is more than the line amount.';
  });
  if (cents(v.receivable) && !v.oldInvoices.trim()) errors.oldInvoices = 'Type the old invoice numbers of the amount not yet paid.';
  if (!input.lines.length && !cents(v.receivable)) errors.receivableCents = 'Add the lines still to release, or the amount invoiced and not yet paid.';
  return errors;
}

export function releaseFields(v: ReleaseValues, left: JoStatus['lines']): BoxErrors {
  const rows = left.filter((l) => (v.qtys[l.lineNo] ?? '').trim() && Number(v.qtys[l.lineNo]) !== 0);
  const errors = schemaFields(releaseInput, { jobOrderId: v.jobOrderId, claimedBy: v.claimedBy.trim(), idSeen: v.idSeen,
    lines: rows.map((l) => ({ lineNo: l.lineNo, qty: Number(v.qtys[l.lineNo]) })),
    ...(v.creditNote.trim() ? { creditNote: v.creditNote.trim() } : {}), ...(v.overrideReason.trim() ? { overrideReason: v.overrideReason.trim() } : {}),
    ...(v.creditDueInDays.trim() ? { creditDueInDays: Number(v.creditDueInDays) } : {}) });
  for (const [key, message] of Object.entries(errors)) {
    const match = /^lines\.(\d+)\.qty$/.exec(key);
    if (match) { delete errors[key]; errors[`qtys.${rows[Number(match[1])]!.lineNo}`] = message; }
  }
  for (const l of rows) if (Number(v.qtys[l.lineNo]) > l.leftQty) errors[`qtys.${l.lineNo}`] = `Only ${l.leftQty} pieces are left to release.`;
  return errors;
}
