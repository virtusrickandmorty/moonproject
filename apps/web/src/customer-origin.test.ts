/** Customer links stay on the website's address, also when copied on the ERP's (the owner's request, Nov 2026). */
import { describe, expect, it } from 'vitest';
import { isWebsitePage } from '@moonproject/shared';
import { customerOrigin } from './customer-origin.ts';

describe('where a customer link opens', () => {
  it('the website, from the ERP address, the website or a PC on the network; the practice shop keeps its own', () => {
    expect(customerOrigin({ hostname: 'erp.virtusgarments.com', origin: 'https://erp.virtusgarments.com' })).toBe('https://www.virtusgarments.com');
    expect(customerOrigin({ hostname: 'www.virtusgarments.com', origin: 'https://www.virtusgarments.com' })).toBe('https://www.virtusgarments.com');
    expect(customerOrigin({ hostname: 'practice.virtusgarments.com', origin: 'https://practice.virtusgarments.com' })).toBe('https://practice.virtusgarments.com');
    expect(customerOrigin({ hostname: '192.168.1.20', origin: 'https://192.168.1.20' })).toBe('https://www.virtusgarments.com');
  });

  it('the website door answers its own pages and customer links, not the ERP screens', () => {
    for (const p of ['/', '/shop', '/order/WEB-000001', `/l/${'x'.repeat(22)}`, `/p/${'y'.repeat(22)}`, `/r/${'z'.repeat(22)}`]) expect(isWebsitePage(p), p).toBe(true);
    for (const p of ['/sign-in', '/floor', '/docs/jo.job_order', '/l/short', '/x/' + 'a'.repeat(22)]) expect(isWebsitePage(p), p).toBe(false);
  });
});
