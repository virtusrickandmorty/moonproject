/** The release form: part of a wearer's pieces can go out (the owner's request, Nov 2026). Made-up values only. */
import { describe, expect, it } from 'vitest';
import { emptyRelease, readyWearers, releaseInput, wearerLeft, wearersQty } from './forms.ts';

const wearer = (rowNo: number, wearerName: string, qty: number, more: object = {}) => ({ rowNo, wearerName, size: 'M', jerseyNumber: null, qty, releasedOn: null, ready: true, ...more });
const line = { lineNo: 1, description: 'Sample jersey', qty: 13, releasedQty: 2, leftQty: 11,
  wearers: [wearer(1, 'Ari Sample', 1), wearer(2, 'Bea Example', 10, { releasedQty: 2, partlyOn: 'REL-000001' }), wearer(3, 'Cy Placeholder', 2)] };
const v = { ...emptyRelease('jo-1'), claimedBy: 'Coach Placeholder', idSeen: 'school_id' as const, invoiceToFollow: true };

describe('pieces by wearer on a release', () => {
  it('starts with all that is left of each ready wearer', () => {
    expect(wearerLeft(line.wearers[1]!)).toBe(8);
    expect(readyWearers([line], { 1: '11' })).toEqual({ wearers: { 1: [1, 2, 3] }, qtys: { 1: '11' } });
  });

  it('sends a wearer alone when all that is left goes, and the pieces when only part of them goes', () => {
    const pieces = { 1: { 2: '5' } };
    expect(wearersQty(line, [1, 2], pieces[1])).toBe('6');
    const r = releaseInput({ ...v, wearers: { 1: [2, 1] }, wearerPieces: pieces }, [line]);
    expect(r.errors).toEqual([]);
    expect(r.release.lines).toEqual([{ lineNo: 1, qty: 6, wearers: [1, { rowNo: 2, qty: 5 }] }]);
    expect(releaseInput({ ...v, wearers: { 1: [3] } }, [line]).release.lines).toEqual([{ lineNo: 1, qty: 2, wearers: [3] }]);
  });

  it('says what is wrong in plain words', () => {
    const errors = (p: string) => releaseInput({ ...v, wearers: { 1: [2] }, wearerPieces: { 1: { 2: p } } }, [line]).errors;
    expect(errors('9')).toEqual(['Line 1: Bea Example has only 8 pieces left to release.']);
    expect(errors('0')).toEqual(['Line 1: type the pieces going out for Bea Example, or untick them.']);
    expect(errors('two')).toEqual(['Line 1: type the pieces going out for Bea Example, or untick them.']);
  });
});
