import { schemaFields, type BoxErrors } from '../JO/boxes.ts';
import { cents } from '../COL/money.ts';
import { saleInput } from './validation.ts';
import type { LineRow } from './lines.ts';

export function saleFields(rows: LineRow[], input: unknown): BoxErrors {
  const errors = schemaFields(saleInput, input);
  for (const name of Object.keys(errors)) if (name.startsWith('lines.')) delete errors[name];
  rows.forEach((r, i) => {
    if (!r.description.trim() && !r.price.trim() && !r.discount.trim()) return;
    const parsed = schemaFields(saleInput.shape.lines.element, { kind: r.kind, description: r.description.trim(), qty: Number(r.qty),
      unitPriceCents: cents(r.price), discountCents: cents(r.discount) });
    Object.assign(errors, Object.fromEntries(Object.entries(parsed).map(([name, message]) => [`lines.${i}.${name}`, message])));
    if ((cents(r.discount) ?? 0) > Number(r.qty) * (cents(r.price) ?? 0)) errors[`lines.${i}.discountCents`] = 'The discount is more than the line amount.';
  });
  return errors;
}
