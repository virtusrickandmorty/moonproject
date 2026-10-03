import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DashHomeData, DashNotification, DashOwnerCharts, DashOwnerHealth, DashWidget } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { AgingBars, Bars, CashLine, HomeContent, OwnerHealthFigures, attentionItems } from './Home.tsx';

const months = (values: number[]): DashOwnerCharts['months'] => values.map((value, i) => ({
  month: `2026-${String(i + 1).padStart(2, '0')}`, from: '2026-01-01', to: '2026-01-31',
  salesCents: value, collectionsCents: value, expensesCents: value, cashCents: value,
}));
const note = (kind: string, id = kind): DashNotification => ({ kind, id, label: kind, href: `/notes/${id}`, read: false });
const work: DashWidget[] = [
  { key: 'cash', title: 'Cash position', amountCents: 10000 },
  { key: 'ready', title: 'Ready for release', items: [{ id: 'ready', label: 'JO-1', href: '/docs/jo.job_order/1' }] },
  { key: 'due', title: 'Job orders due this week', items: [{ id: 'due', label: 'JO-2', href: '/docs/jo.job_order/2' }] },
  { key: 'integrity', title: 'Integrity', tone: 'danger', href: '/aud/integrity', items: [{ id: 'fail', label: 'Last integrity check', detail: '2 found' }] },
];

describe('Home puts work first', () => {
  it('keeps a short list with warnings and due work ahead of routine activity and figures', () => {
    const notes = [note('cancel'), note('health-red'), ...Array.from({ length: 8 }, (_, i) => note('step-up-action', String(i)))];
    const items = attentionItems(work, notes);
    expect(items).toHaveLength(8);
    expect(items.slice(0, 4).map((i) => i.label)).toEqual(['Integrity', 'health-red', 'Job orders due this week · JO-2', 'Ready for release · JO-1']);
    expect(items.some((i) => i.label === 'Cash position')).toBe(false);
    expect(items[0]?.href).toBe('/aud/integrity');
  });

  it('omits read notifications and avoids repeating a widget record already in an unread reminder', () => {
    const items = attentionItems(work.slice(1, 3), [{ ...note('jo-ready'), href: '/docs/jo.job_order/1' }, { ...note('jo-overdue'), read: true }]);
    expect(items.map((i) => i.label)).toEqual(['Job orders due this week · JO-2', 'jo-ready']);
    expect(items[1]?.notificationId).toBe('jo-ready');
  });

  it.each(['owner', 'accountant', 'encoder', 'production'])('puts %s attention before daily actions and keeps full role detail', (role) => {
    const widgets = [...work, { key: 'drafts', title: 'My drafts', items: Array.from({ length: 12 }, (_, i) => ({ id: String(i), label: `Draft ${i}`, href: `/draft/${i}` })) }];
    const home: DashHomeData = { role, asOf: '2026-10-03', widgets, showCharts: role === 'owner' };
    const markup = renderToStaticMarkup(createElement(HomeContent, { home, actions: createElement('h2', {}, 'Daily actions') }));
    expect(markup.indexOf('Needs attention')).toBeLessThan(markup.indexOf('Daily actions'));
    expect(markup.indexOf('Daily actions')).toBeLessThan(markup.indexOf('Cash position'));
    expect(markup).toContain('See all notifications');
    expect(markup).toContain('More role details');
    expect(markup).toContain('Draft 11');
    if (role === 'owner') {
      expect(markup.indexOf('Daily actions')).toBeLessThan(markup.indexOf('Loading how the business is doing'));
      expect(markup.indexOf('Loading how the business is doing')).toBeLessThan(markup.indexOf('Loading the last 12 months'));
    } else expect(markup).not.toContain('Loading how the business is doing');
  });

  it('opens both sales and VAT figures on the registered sales screen with the period intact', () => {
    const data: DashOwnerHealth = { asOf: '2026-10-03', periods: [{ label: 'This month', from: '2026-10-01', to: '2026-10-03', salesCents: 10000, vatCents: 1200, collectionsCents: 5000, payrollCents: 0 }],
      cashPlaces: [], receivables: { totalCents: 0, over30Cents: 0, over60Cents: 0, over90Cents: 0 }, payables: { totalCents: 0, dueNext7DaysCents: 0 }, jobs: { open: 0, dueThisWeek: 0, late: 0 }, depositsHeldCents: 0, taxDeadlines: [] };
    const markup = renderToStaticMarkup(createElement(OwnerHealthFigures, { data }));
    expect(markup.match(/href="\/tax\/sales\?from=2026-10-01&amp;to=2026-10-03"/g)).toHaveLength(2);
    expect(markup).not.toContain('/tax/sales-register');
  });
});

describe('signed owner charts', () => {
  it.each([[10000, -10000], [-10000, -5000], [0, 0], [10000, 5000]])('keeps bars and cash inside the plot for %j', (...values) => {
    const data = months(values);
    for (const chart of [Bars, CashLine]) {
      const markup = renderToStaticMarkup(createElement(chart, { data }));
      const zero = Number(/<line[^>]* y1="([^"]+)"/.exec(markup)![1]);
      expect(zero).toBeGreaterThanOrEqual(40);
      expect(markup).toContain('₱0');
      expect(markup).not.toMatch(/NaN|Infinity/);
      if (chart === CashLine) {
        const ys = [...markup.matchAll(/<circle[^>]* cy="([^"]+)"/g)].map((m) => Number(m[1]));
        ys.forEach((y, i) => { expect(y).toBeGreaterThanOrEqual(40); expect(y).toBeLessThanOrEqual(170); if (values[i]! < 0) expect(y).toBeGreaterThan(zero); });
      } else {
        const bars = [...markup.matchAll(/<rect[^>]* y="([^"]+)" width="10" height="([^"]+)"/g)].slice(0, values.length * 3);
        bars.forEach((m, i) => { const y = Number(m[1]); const height = Number(m[2]); expect(y).toBeGreaterThanOrEqual(40); expect(y + height).toBeLessThanOrEqual(190); if (values[Math.floor(i / 3)]! < 0) { expect(y).toBe(zero); expect(height).toBeGreaterThan(0); } });
      }
      if (values.some((v) => v < 0)) expect(markup).toContain(peso(-10000));
    }
  });

  it('draws a negative receivable below zero and labels its signed amount', () => {
    const markup = renderToStaticMarkup(createElement(AgingBars, { data: [{ key: 'current', label: 'Current', amountCents: 10000 }, { key: 'old', label: 'Over 90', amountCents: -5000 }] }));
    const zero = Number(/<line[^>]* y1="([^"]+)"/.exec(markup)![1]);
    const negative = [...markup.matchAll(/<rect[^>]* y="([^"]+)" width="42" height="([^"]+)"/g)][1]!;
    expect(Number(negative[1])).toBe(zero);
    expect(Number(negative[1]) + Number(negative[2])).toBe(170);
    expect(markup).toContain(peso(-5000));
    expect(markup).toContain('Negative receivables');
  });
});
