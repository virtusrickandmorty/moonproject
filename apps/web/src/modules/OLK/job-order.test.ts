import { expect, it } from 'vitest';
import { joInput } from '../JO/forms.ts';
import { joValuesFrom } from './OrderLinks.tsx';

it("fills the job order form from answers: price list price, wearers, sizes, and each row's note kept to the record", () => {
  const v = joValuesFrom({
    customer: { id: 'c1', name: 'Made-up Clinic' }, contact: '', notes: 'From the order link "Made-up Clinic uniforms" (2 answers).',
    lines: [
      { itemId: 'i1', kind: 'made_to_order', description: 'Scrub top', isSet: false, qty: 2, listCents: 60_000, roster: [{ name: 'Made-up Ana', sizeMode: 'preset', size: 'M', qty: 2 }] },
      { itemId: 'i2', kind: 'made_to_order', description: 'Scrub pants', isSet: false, qty: 1, listCents: null,
        roster: [{ personId: 'p1', name: 'Made-up Ana', sizeMode: 'measured', qty: 1, notes: 'For this item: pants length 40.5 in' }] },
    ],
  });
  expect(v.lines.map((l) => [l.description, l.qty, l.price])).toEqual([['Scrub top', '2', '600.00'], ['Scrub pants', '1', '']]);
  v.lines[1]!.price = '550.00';
  const { input, errors } = joInput(v);
  expect(errors).toEqual([]);
  expect(input.lines[1]!.roster).toEqual([{ personId: 'p1', sizeMode: 'measured', qty: 1, notes: 'For this item: pants length 40.5 in' }]);
  expect(input.lines[0]!.roster).toEqual([{ name: 'Made-up Ana', sizeMode: 'preset', size: 'M', qty: 2 }]);
});
