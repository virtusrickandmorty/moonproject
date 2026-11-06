/** The Delivery panel on a release slip's page. Made-up values only. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DocDetail } from '../../api.ts';
import { ReleaseReceived, receivedOf } from './ReleaseReceived.tsx';

const detail = (doc: Record<string, unknown>) => ({ header: { id: 'r1', number: 'REL-000001', status: 'posted', businessDate: '2026-11-06' }, input: {}, doc }) as unknown as DocDetail;
const show = (doc: Record<string, unknown>) => renderToStaticMarkup(createElement(ReleaseReceived, { d: detail(doc) }));

describe('the Delivery panel', () => {
  it('is only on a release for delivery', () => {
    expect(show({ claimedBy: 'Sample Person' })).toBe('');
  });
  it('says when nobody is recorded yet', () => {
    expect(show({ forDelivery: true })).toContain('not recorded yet');
  });
  it('shows who received it and when', () => {
    const markup = show({ forDelivery: true, receivedBy: 'Sample Person', receivedOn: '2026-11-07' });
    expect(markup).toContain('Sample Person');
    expect(markup).toContain('November 7, 2026');
  });
  it('reads only a complete record', () => {
    expect(receivedOf({ receivedBy: 'Sample Person' })).toBeNull();
    expect(receivedOf(undefined)).toBeNull();
  });
});
