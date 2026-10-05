import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, id, invalid } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { Lend, TakeBack } from './Sizers.tsx';
const set = { id: id(1), code: 'SAMPLE', garmentType: 'Jersey', sizesIncluded: 'S, M', holder: { loanId: id(2), loanVersion: 3, customerName: 'Sample School' } } as never;
afterEach(() => vi.restoreAllMocks());
const lend = () => Lend({ set, today: '2026-10-05', onClose: () => undefined, onDone: () => undefined });
const back = () => TakeBack({ set, onClose: () => undefined, onDone: () => undefined });
it('an early sizer return date is shown on its date box', () => {
  const f = form(lend); change(f.field('Due back on'), '2026-10-04'); blur(f.field('Due back on')); invalid(f, 'Due back on');
});
it('sizer lending keeps the same ids and expected return date', async () => {
  const save = vi.spyOn(api, 'sizerLend').mockResolvedValue({} as never);
  const f = form(lend); f.render().find((n) => n.props.value === null && n.props.onChange)!.props.onChange({ id: id(3), name: 'Sample School' });
  change(f.field('Due back on'), '2026-10-12'); await f.find('children', 'Lend it').props.onClick();
  expect(save).toHaveBeenCalledWith({ setId: id(1), customerId: id(3), expectedReturnDate: '2026-10-12' });
});
it('a bad sizer condition is shown on its own box', () => {
  const f = form(back); change(f.field('Condition'), 'x'.repeat(501)); blur(f.field('Condition')); invalid(f, 'Condition');
});
it('sizer return keeps the loan version, status and trimmed condition', async () => {
  const save = vi.spyOn(api, 'sizerReturn').mockResolvedValue({} as never);
  const f = form(back); change(f.field('Condition'), ' Complete '); await f.find('children', 'Record the return').props.onClick();
  expect(save).toHaveBeenCalledWith(id(2), 3, { status: 'in shop', conditionOnReturn: 'Complete' });
});
