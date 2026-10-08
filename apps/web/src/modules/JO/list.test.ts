import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DocTypeInfo, JoListRow } from '../../api.ts';
import { jobOrderActions, jobOrderColumns, jobOrderDetail } from './list.tsx';

const jo = (over: Partial<JoListRow> = {}): JoListRow => ({ id: 'j1', number: 'JO-000001', businessDate: '2026-10-08', status: 'posted', totalCents: 600_000,
  summary: 'Job order for Sample School', postedAt: '2026-10-08T10:00:00+08:00', cancelledAt: null, cancelReason: null, replacesId: null, replacedById: null,
  balanceDueCents: 300_000, matchedItem: null, awaitingInvoice: [], readyToRelease: false, ...over } as JoListRow);
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
    expect(html(jobOrderActions(types(false))(jo()))).not.toContain('Make payment');
    expect(html(jobOrderActions(types(true))(jo({ balanceDueCents: 0 })))).not.toContain('Make payment');
    expect(jobOrderActions(types(true))(jo({ status: 'cancelled' }))).toBeNull();
  });

  it('shows Release slip to those who release, only once an item is ready to go out', () => {
    const types = (canCreate: boolean) => [{ key: 'jo.release', canCreate } as DocTypeInfo];
    expect(html(jobOrderActions(types(true))(jo({ readyToRelease: true })))).toContain('Release slip');
    expect(html(jobOrderActions(types(true))(jo({ readyToRelease: false })))).not.toContain('Release slip');
    expect(html(jobOrderActions(types(false))(jo({ readyToRelease: true })))).not.toContain('Release slip');
  });

  it('offers Invoice to those who record invoices: greyed out with why until something released waits for its invoice', () => {
    const types = (canCreate: boolean) => [{ key: 'jo.invoice_record', canCreate } as DocTypeInfo];
    const none = html(jobOrderActions(types(true))(jo({ awaitingInvoice: [] })));
    expect(none).toMatch(/<button[^>]*title="Nothing of JO-000001 is released and waiting for its invoice yet"[^>]*disabled=""[^>]*>Invoice<\/button>/);
    const one = html(jobOrderActions(types(true))(jo({ awaitingInvoice: [{ id: 'r1', number: 'REL-000001' }] })));
    expect(one).toContain('title="Record the invoice for REL-000001"');
    expect(one).not.toContain('disabled=""');
    expect(html(jobOrderActions(types(false))(jo({ awaitingInvoice: [{ id: 'r1', number: 'REL-000001' }] })))).not.toContain('Invoice');
  });
});
