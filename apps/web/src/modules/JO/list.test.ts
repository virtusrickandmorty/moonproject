import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DocTypeInfo, JoListRow } from '../../api.ts';
import { jobOrderActions, jobOrderColumns, jobOrderDetail } from './list.tsx';

const jo = (over: Partial<JoListRow> = {}): JoListRow => ({ id: 'j1', number: 'JO-000001', businessDate: '2026-10-08', status: 'posted', totalCents: 600_000,
  summary: 'Job order for Sample School', postedAt: '2026-10-08T10:00:00+08:00', cancelledAt: null, cancelReason: null, replacesId: null, replacedById: null,
  balanceDueCents: 300_000, matchedItem: null, ...over } as JoListRow);
const html = (node: ReactNode) => (isValidElement(node) ? renderToStaticMarkup(node) : String(node ?? ''));
const balance = jobOrderColumns[0]!;

describe('job order list', () => {
  it('shows what is left to pay, Paid when nothing is, and nothing on a cancelled order', () => {
    expect(balance.head).toBe('Balance');
    expect(html(balance.cell(jo()))).toContain('₱3,000.00');
    expect(html(balance.cell(jo({ balanceDueCents: 0 })))).toContain('Paid');
    expect(html(balance.cell(jo({ status: 'cancelled', balanceDueCents: 0 })))).toBe('');
  });

  it('says which item a search found', () => {
    expect(html(jobOrderDetail(jo({ matchedItem: 'Jersey for the rowing team' })))).toContain('Item: Jersey for the rowing team');
    expect(jobOrderDetail(jo())).toBeNull();
  });

  it('offers Make payment only to those who record collections, on a recorded order with a balance', () => {
    const types = (canCreate: boolean) => [{ key: 'col.collection', canCreate } as DocTypeInfo];
    expect(html(jobOrderActions(types(true))(jo()))).toContain('Make payment');
    expect(jobOrderActions(types(false))(jo())).toBeNull();
    expect(jobOrderActions(types(true))(jo({ balanceDueCents: 0 }))).toBeNull();
    expect(jobOrderActions(types(true))(jo({ status: 'cancelled' }))).toBeNull();
  });
});
