import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DocDetail, JoStatus } from '../../api.ts';
import { jobOrderView, openingJobOrderView } from './JobOrderView.tsx';

const hooks = vi.hoisted(() => ({ states: null as unknown[] | null, cursor: 0 }));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => hooks.states ? [hooks.states[hooks.cursor++], vi.fn()] : react.useState(initial) };
});
afterEach(() => { hooks.states = null; hooks.cursor = 0; });

const detail = (doc: Record<string, unknown> | undefined = { lines }): DocDetail => ({
  header: { id: 'jo-sample', number: 'JO-000001', status: 'posted', businessDate: '2026-10-04',
    totalCents: 50000, summary: 'Sample order', postedAt: '2026-10-04T09:00:00+08:00', cancelledAt: null, cancelReason: null, replacesId: null, replacedById: null },
  input: { lines: [{ description: 'Input-only garment', roster: [{ name: 'Input-only wearer', size: 'Input-only size' }] }] },
  ...(doc ? { doc } : {}),
});
const lines = [
  { lineNo: 1, description: 'Rowing jersey', qty: 3, unitPriceCents: 15000, discountCents: 1000, lineTotalCents: 44000, roster: [
    { rowNo: 1, wearerName: 'Ari Sample', personId: 'person-private', groupId: 'group-private', sizeMode: 'preset', size: 'L', qty: 1, jerseyName: 'ARI', jerseyNumber: '7', notes: 'Longer sleeves' },
    { rowNo: 2, wearerName: 'Bea Example', sizeMode: 'measured', size: 'Unused preset', chartId: 'chart-private', chartRevision: 3, qty: 2 },
  ] },
  { lineNo: 2, description: 'Training shorts', qty: 1, unitPriceCents: 6000, discountCents: 0, lineTotalCents: 6000, roster: [
    { rowNo: 1, wearerName: 'Coach Guest', sizeMode: 'preset', size: 'XL', qty: 1 },
  ] },
];
const render = (d = detail(), view = jobOrderView) => renderToStaticMarkup(view.extra!(d));

describe('recorded job order garments and wearers', () => {
  it('shows all five columns, centavo-exact recorded amounts and zero discounts', () => {
    const html = render(detail({ lines: [{ ...lines[0], lineTotalCents: 43999 }, lines[1]] }));
    for (const text of ['Garments and wearers', 'Description', 'Quantity', 'Price each', 'Discount', 'Amount',
      'Rowing jersey', 'Training shorts', '₱150.00', '₱10.00', '₱439.99', '₱60.00', '₱0.00']) expect(html).toContain(text);
    // A recorded amount is displayed as received, rather than recomputed from the inputs or the header total.
    expect(html).not.toContain('₱440.00');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('sticky left-0');
    expect(html).toContain('tabindex="0"');
  });

  it('keeps each roster under its own line, with wearer quantity and jersey details', () => {
    const html = render();
    const first = html.slice(html.indexOf('Wearers for line 1'), html.indexOf('Wearers for line 2'));
    const second = html.slice(html.indexOf('Wearers for line 2'));
    expect(html.indexOf('</table>')).toBeLessThan(html.indexOf('Wearers for line 1'));
    for (const text of ['Ari Sample', 'Size: L', 'Quantity: 1', 'Jersey name: ARI', 'Jersey number: 7', 'Longer sleeves', 'Bea Example', 'Quantity: 2']) expect(first).toContain(text);
    expect(first).not.toContain('Coach Guest');
    expect(second).toContain('Coach Guest');
    expect(second).toContain('Size: XL');
    expect(second).not.toContain('Ari Sample');
    expect(second).not.toContain('Bea Example');
  });

  it('uses the recorded measurement revision and only supplied detail, without IDs or an input fallback', () => {
    const html = render();
    expect(html).toContain('Measured · revision 3');
    for (const hidden of ['Unused preset', 'person-private', 'group-private', 'chart-private', 'Input-only garment', 'Input-only wearer', 'Input-only size']) expect(html).not.toContain(hidden);
    expect(render({ ...detail(), doc: undefined })).not.toContain('Garments and wearers');
    expect(render(detail({}))).not.toContain('Garments and wearers');
  });

  it('distinguishes an empty roster from unavailable wearer detail and tolerates a missing measurement revision', () => {
    const html = render(detail({ lines: [
      { ...lines[0], roster: [] },
      { ...lines[1], roster: undefined },
      { ...lines[1], lineNo: 3, roster: [{ rowNo: 1, wearerName: 'Measured Guest', sizeMode: 'measured', chartRevision: null, qty: 1 }] },
    ] }));
    expect(html).toContain('No wearers listed.');
    expect(html).toContain('Wearer details are not available.');
    expect(html).toContain('Measured · Quantity: 1');
    expect(html).not.toContain('revision null');
  });

  it('also shows opening-order lines and explains that they are the part still to release at recording', () => {
    const html = render(detail(), openingJobOrderView);
    expect(html).toContain('Rowing jersey');
    expect(html).toContain('Ari Sample');
    expect(html).toContain('These are the garments still to release when this opening order was recorded.');
    const empty = render(detail({ lines: [], receivableCents: 50000 }), openingJobOrderView);
    expect(empty).toContain('No garments left to release when this opening order was recorded.');
    expect(empty).not.toContain('<table');
  });

  it('shows recorded lines on a cancelled order and escapes names, descriptions and notes', () => {
    const d = detail({ lines: [{ ...lines[0], description: '<script>garment</script>', roster: [
      { rowNo: 1, wearerName: '<b>Guest</b>', sizeMode: 'preset', size: 'M', qty: 1, notes: '<img src=x>' },
    ] }] });
    d.header.status = 'cancelled';
    const html = render(d);
    for (const text of ['&lt;script&gt;garment&lt;/script&gt;', '&lt;b&gt;Guest&lt;/b&gt;', '&lt;img src=x&gt;']) expect(html).toContain(text);
    expect(html).not.toContain('<script>');
  });

  it('retains balance, next-step buttons and their prefilled links above the garment detail', () => {
    const s: JoStatus = {
      jobOrder: { id: 'jo-sample', number: 'JO-000001', docType: 'jo.job_order', status: 'posted', customerId: 'customer-sample', customerName: 'Sample school', dueDate: '2026-10-19' },
      stage: 'ready', stageLabel: 'Ready', money: { totalCents: 50000, invoicedCents: 6000, receivableCents: 0, depositsHeldCents: 10000, balanceDueCents: 34000, collectedCents: 16000, requiredDownpaymentCents: 25000 },
      lines: [{ lineNo: 1, description: 'Rowing jersey', qty: 3, releasedQty: 0, leftQty: 3 }],
      awaitingInvoice: [{ id: 'release-sample', number: 'REL-000001', businessDate: '2026-10-04', totalCents: 6000 }],
      depositVat: { mode: 'A', words: 'deposit only', setting: 'A', settingWords: 'deposit only', lockedBy: null, kept: null }, dpInvoices: [],
    };
    hooks.states = [s, null, { collect: true, release: true, invoice: true, dpInvoice: true, move: true, refund: true }];
    const html = render();
    for (const text of ['Collected', 'Invoiced', 'Deposits held', 'Balance due', '₱340.00', 'Take the downpayment', 'Take a payment', 'Release', 'Record invoice']) expect(html).toContain(text);
    for (const path of ['/docs/col.collection/new?jo=jo-sample&amp;for=downpayment', '/docs/col.collection/new?jo=jo-sample', '/docs/jo.release/new?jo=jo-sample', '/docs/jo.invoice_record/new?release=release-sample']) expect(html).toContain(`href="${path}"`);
    expect(html.indexOf('Balance due')).toBeLessThan(html.indexOf('Garments and wearers'));
  });
});
