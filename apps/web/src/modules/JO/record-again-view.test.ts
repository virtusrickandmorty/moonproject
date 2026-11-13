/** The invoice record page's record-again links (the owner's case, Nov 2026): a recorded-again record, cancelled in turn, still offers it. */
import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, type DocDetail } from '../../api.ts';
import { invoiceRecordView } from './JobOrderView.tsx';

const detail = (status: 'posted' | 'cancelled', doc: Record<string, unknown>): DocDetail => ({
  header: { id: 'ir-26', number: 'IR-26', businessDate: '2026-10-30', status, totalCents: 1, summary: '', postedAt: '', cancelledAt: null, cancelReason: null, replacesId: null, replacedById: null },
  input: {}, doc: { jobOrderId: 'jo-9', jobOrderNumber: 'JO-9', ...doc },
});
const html = (d: DocDetail) => renderToStaticMarkup(createElement('div', null, invoiceRecordView.extra!(d)));

it('shows what a record records again, and the way to record it again once it is cancelled', () => {
  vi.spyOn(api, 'docTypes').mockResolvedValue([]);
  const posted = html(detail('posted', { againOf: 'ir-9', againOfNumber: 'IR-9' }));
  expect(posted).toContain('Records IR-9 again');
  const cancelled = html(detail('cancelled', { againOf: 'ir-9', againOfNumber: 'IR-9', againBy: { id: 'ir-27', number: 'IR-27' } }));
  expect(cancelled).toContain('Records IR-9 again');
  expect(cancelled).toContain('Recorded again as IR-27');
});
