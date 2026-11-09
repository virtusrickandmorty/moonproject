/** A delivery's own page shows who received it (the owner looked for it there, Nov 2026). Made-up names only. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DocDetail } from '../../api.ts';
import { tplDeliveryView } from './Program.tsx';

const page = (status: string, doc: Record<string, unknown>) => renderToStaticMarkup(tplDeliveryView.extra!({
  header: { id: 'd1', number: 'DR-000009', businessDate: '2026-11-06', status }, doc,
} as unknown as DocDetail) as React.ReactElement);

describe("the delivery's own page", () => {
  it('says who received it, once recorded', () => {
    expect(page('posted', { receivedBy: 'Ana Halimbawa', receivedOn: '2026-11-07' })).toContain('Received by <b>Ana Halimbawa</b>');
  });

  it('says it is not recorded yet, so it can be typed from the signed receipt', () => {
    expect(page('posted', {})).toContain('Not recorded yet');
    expect(page('cancelled', {})).not.toContain('Not recorded yet');
  });
});
