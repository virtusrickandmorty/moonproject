import { describe, expect, it } from 'vitest';
import { changedItems, editRowOf, parseItemPaste } from './Program.tsx';
import type { TplItem } from './types.ts';

describe('TPL items pasted from Excel (the owner\'s request, Oct 2026)', () => {
  it('reads item, size, price, restock at and kind; skips the header and blank lines', () => {
    expect(parseItemPaste('Item\tSize\tPrice\tRestock at\tKind\nSchool polo, white\tM\t₱450.00\t20\tmade to order\n\nSchool cap\t\t150\t\tready-made\n')).toEqual([
      { description: 'School polo, white', size: 'M', price: '450.00', reorder: '20', kind: 'made_to_order' },
      { description: 'School cap', size: '', price: '150', reorder: '0', kind: 'ready_made' },
    ]);
  });
});

describe('TPL change many items (the owner\'s request, Oct 28, 2026)', () => {
  const item = (id: string, description: string, priceCents: number): TplItem =>
    ({ id, programId: 'p', kind: 'made_to_order', description, size: 'M', priceCents, reorderLevel: 10, isActive: true, version: 3, onHand: 0 });
  const polo = item('a', 'School polo', 45_000);
  const cap = item('b', 'School cap', 15_000);

  it('sends only the items changed, each with the version it was read at', () => {
    const rows = { a: { ...editRowOf(polo), price: '480.00' }, b: editRowOf(cap) };
    expect(changedItems([polo, cap], rows)).toEqual([{ id: 'a', kind: 'made_to_order', description: 'School polo', size: 'M', priceCents: 48_000, reorderLevel: 10, isActive: true, version: 3 }]);
    expect(changedItems([polo, cap], { a: editRowOf(polo), b: { ...editRowOf(cap), on: false, reorder: '0' } }).map((c) => [c.id, c.isActive, c.reorderLevel])).toEqual([['b', false, 0]]);
    expect(changedItems([polo, cap], { a: editRowOf(polo), b: editRowOf(cap) })).toEqual([]);
  });

  it('names the item when a row is not right', () => {
    expect(() => changedItems([polo], { a: { ...editRowOf(polo), price: 'abc' } })).toThrow('School polo (M): type the price a piece');
    expect(() => changedItems([polo], { a: { ...editRowOf(polo), description: ' ' } })).toThrow('School polo (M): type the item.');
  });
});
