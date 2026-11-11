/** Where an order is, with the little shirt: every step shows, the one the order is on is marked, and an unknown status shows nothing. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STEPS, StatusJourney } from './StatusJourney.tsx';

const html = (kind: 'job_order' | 'online', status: string, fulfilment?: 'pickup' | 'delivery') => renderToStaticMarkup(createElement(StatusJourney, { kind, status, fulfilment }));

describe('the order status journey', () => {
  it('shows every step of a job order with the one it is on marked, and what is happening now', () => {
    const markup = html('job_order', 'in_production');
    for (const s of STEPS.job_order.steps) expect(markup).toContain(s);
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="step"[^>]*>(?:<[^>]+>)*?<\/span>In production/);
    expect(markup).toContain('Being made!');
    expect(markup).toContain('Tap the shirt');
  });

  it('says pickup or delivery for a ready online order', () => {
    expect(html('online', 'ready', 'pickup')).toContain('Come pick it up at the shop');
    expect(html('online', 'ready', 'delivery')).toContain('On its way to you!');
    expect(html('online', 'completed')).toContain('All done.');
  });

  it('shows nothing for a status off the steps (cancelled, expired)', () => {
    expect(html('online', 'cancelled')).toBe('');
    expect(html('job_order', 'cancelled')).toBe('');
  });
});
