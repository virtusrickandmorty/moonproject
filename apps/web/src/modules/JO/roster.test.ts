import { describe, expect, it } from 'vitest';
import { parseRosterPaste, rosterPieces, toRosterInput, type PulledWearer } from './roster.ts';

const team: PulledWearer[] = [
  { personId: 'p-ari', wearerName: 'Ari Sample', sizeMode: 'preset', jerseyName: 'ARI', jerseyNumber: '7' },
  { personId: 'p-bea', wearerName: 'Bea Example', sizeMode: 'measured' },
];

describe('roster paste from Excel (PLAN E4)', () => {
  it('skips the header and blank lines, uppercases sizes and jersey names, defaults qty to 1', () => {
    const { rows, errors } = parseRosterPaste('Name\tSize\tJersey\tNo.\tQty\r\nGuest Coach\txl\tcoach\t00\t2\r\n\r\nWalk-in\tm\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { name: 'Guest Coach', wearerName: 'Guest Coach', sizeMode: 'preset', size: 'XL', jerseyName: 'COACH', jerseyNumber: '00', qty: 2 },
      { name: 'Walk-in', wearerName: 'Walk-in', sizeMode: 'preset', size: 'M', qty: 1 },
    ]);
    expect(rosterPieces(rows)).toBe(3);
  });

  it('takes the garment type from a sixth column', () => {
    const { rows, errors } = parseRosterPaste('Ana Reyes\ts\tana\t7\t1\tJersey (women)\nBen Cruz\tl\t\t\t2\t');
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.wearerName, r.qty, r.garmentType])).toEqual([['Ana Reyes', 1, 'Jersey (women)'], ['Ben Cruz', 2, undefined]]);
  });

  it("matches the group's wearers by name and keeps their measurements and jersey defaults", () => {
    const { rows } = parseRosterPaste('ari  sample\nBEA EXAMPLE\t\tbee\nBea Example\tL', team);
    expect(rows.map(toRosterInput)).toEqual([
      { personId: 'p-ari', sizeMode: 'preset', jerseyName: 'ARI', jerseyNumber: '7', qty: 1 },
      { personId: 'p-bea', sizeMode: 'measured', jerseyName: 'BEE', qty: 1 },
      { personId: 'p-bea', sizeMode: 'preset', size: 'L', qty: 1 },
    ]);
  });

  it('reports rows it cannot read, by row number', () => {
    expect(parseRosterPaste('\tM\nGood Row\tS\t\t\t0\nAlso Good\tS\t\t\ttwo').errors).toEqual([
      'Row 1: the name is empty.',
      'Row 2: the quantity must be a whole number like 1 or 2.',
      'Row 3: the quantity must be a whole number like 1 or 2.',
    ]);
  });
});
