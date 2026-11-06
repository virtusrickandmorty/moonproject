/** The release form for delivery: no receiver or ID to type, and what it sends. Made-up values only. */
import { describe, expect, it } from 'vitest';
import { FOR_DELIVERY, emptyRelease, nothingToCharge, releaseInput } from './forms.ts';

const left = [{ lineNo: 1, description: 'Sample shirt', qty: 2, releasedQty: 0, leftQty: 2 }] as never;
const v = { ...emptyRelease('jo-1'), qtys: { 1: '2' }, invoiceToFollow: true };

describe('a release for delivery', () => {
  it('asks for no receiver and no ID', () => {
    const r = releaseInput({ ...v, forDelivery: true }, left);
    expect(r.errors).toEqual([]);
    expect(r.release).toMatchObject({ claimedBy: FOR_DELIVERY, idSeen: 'none', forDelivery: true });
  });

  it('ignores a name typed before the tick', () => {
    expect(releaseInput({ ...v, forDelivery: true, claimedBy: 'Sample Person', idSeen: 'school_id' }, left).release).toMatchObject({ claimedBy: FOR_DELIVERY, idSeen: 'none' });
  });

  it('still asks who claimed it when it is not for delivery, and says the way out', () => {
    expect(releaseInput(v, left).errors).toEqual(['Type who claimed it, or tick "For delivery".', 'Pick the ID seen.']);
    expect(releaseInput({ ...v, claimedBy: 'Sample Person', idSeen: 'school_id' }, left).release).not.toHaveProperty('forDelivery');
  });
});

describe('the invoice number', () => {
  it('goes away for a ₱0 job order at once, before anything is typed', () => {
    expect(nothingToCharge(0, undefined)).toBe(true);
  });
  it('goes away for ₱0 lines of a job order with others, once the preview says so', () => {
    expect(nothingToCharge(50_000, undefined)).toBe(false);
    expect(nothingToCharge(50_000, 0)).toBe(true);
    expect(nothingToCharge(50_000, 20_000)).toBe(false);
    expect(nothingToCharge(undefined, undefined)).toBe(false);
  });
  it('is apart from what the release itself needs, so a ₱0 release can leave it out', () => {
    const r = releaseInput({ ...v, invoiceToFollow: false, forDelivery: true }, left);
    expect(r.releaseErrors).toEqual([]);
    expect(r.errors).toEqual(['Type the invoice number from the booklet (digits only), or tick "Invoice to follow".']);
  });
});
