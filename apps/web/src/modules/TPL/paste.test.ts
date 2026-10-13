import { describe, expect, it } from 'vitest';
import { parseItemPaste } from './Program.tsx';

describe('TPL items pasted from Excel (the owner\'s request, Oct 2026)', () => {
  it('reads item, size, price, restock at and kind; skips the header and blank lines', () => {
    expect(parseItemPaste('Item\tSize\tPrice\tRestock at\tKind\nSchool polo, white\tM\t₱450.00\t20\tmade to order\n\nSchool cap\t\t150\t\tready-made\n')).toEqual([
      { description: 'School polo, white', size: 'M', price: '450.00', reorder: '20', kind: 'made_to_order' },
      { description: 'School cap', size: '', price: '150', reorder: '0', kind: 'ready_made' },
    ]);
  });
});
