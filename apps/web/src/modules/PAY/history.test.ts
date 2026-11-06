/** The Payroll history panel: the words, the year's totals, and where each line goes. Made-up figures. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PayHistoryRow } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { HistoryTable, historyOf, releaseWords } from './History.tsx';

const row = (over: Partial<PayHistoryRow>): PayHistoryRow => ({ id: 'r1', kind: 'run', number: 'PAY-000001', payDate: '2026-10-31', periodStart: '2026-10-16', periodEnd: '2026-10-31', grossCents: 100_000, netCents: 90_000, paidCents: 0, leftCents: 90_000, releases: [], ...over });

describe('payroll history', () => {
  it('says how much of the net pay went out', () => {
    expect(releaseWords(row({}))).toBe('Not released');
    expect(releaseWords(row({ paidCents: 10_000, leftCents: 80_000 }))).toBe('Partly released');
    expect(releaseWords(row({ paidCents: 90_000, leftCents: 0 }))).toBe('Released');
    expect(releaseWords(row({ netCents: 0, leftCents: 0 }))).toBe('Nothing to release');
  });

  it('adds up the year picked, or every year', () => {
    const rows = [row({}), row({ id: 'r2', periodEnd: '2025-12-31', netCents: 10_000, paidCents: 10_000, leftCents: 0 })];
    expect(historyOf(rows, '').totals).toMatchObject({ netCents: 100_000, paidCents: 10_000, leftCents: 90_000 });
    expect(historyOf(rows, '2025')).toMatchObject({ shown: [{ id: 'r2' }], totals: { netCents: 10_000, leftCents: 0 } });
  });

  it('opens the payroll and its payslip, and names each part released', () => {
    const markup = renderToStaticMarkup(createElement(HistoryTable, { canSeeReleases: true, rows: [row({ paidCents: 30_000, leftCents: 60_000, releases: [
      { id: 'p1', number: 'POUT-000001', date: '2026-11-01', amountCents: 10_000 }, { id: 'p2', number: 'POUT-000002', date: '2026-11-02', amountCents: 20_000 }] })] }));
    for (const words of ['href="/docs/pay.run/r1"', 'href="/pay/runs/r1/payslips"', 'href="/docs/pay.release/p1"', 'POUT-000002', peso(10_000), peso(100_000 - 90_000), 'Partly released']) expect(markup).toContain(words);
  });

  it('shows a release number without a link to those who may not open it', () => {
    const markup = renderToStaticMarkup(createElement(HistoryTable, { canSeeReleases: false, rows: [row({ releases: [{ id: 'p1', number: 'POUT-000001', date: '2026-11-01', amountCents: 90_000 }] })] }));
    expect(markup).toContain('POUT-000001');
    expect(markup).not.toContain('/docs/pay.release/p1');
  });

  it('names 13th-month pay, which has no payslip of its own', () => {
    const markup = renderToStaticMarkup(createElement(HistoryTable, { canSeeReleases: true, rows: [row({ kind: 'thirteenth', id: 't1', number: 'TH13-000001', periodEnd: '2026-12-31' })] }));
    expect(markup).toContain('13th-month pay 2026');
    expect(markup).toContain('href="/docs/pay.thirteenth/t1"');
    expect(markup).not.toContain('payslips');
  });
});
