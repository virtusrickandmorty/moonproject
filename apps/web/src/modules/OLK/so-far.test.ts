import { expect, it } from 'vitest';
import { CUSTOM, tallyOf, type LinkPage, type PersonForm } from './OrderLinkPage.tsx';

const link = {
  kind: 'team', title: 'Made-up Eagles', closesOn: '2026-12-01', open: true, payOwn: false, guide: [],
  sizes: [{ label: 'S', category: 'adult' }, { label: 'M', category: 'adult' }, { label: 'L', category: 'adult' }],
  items: [{ lineNo: 1, name: 'Jersey', sizing: 'size', customFit: true, fields: [] }, { lineNo: 2, name: 'Shorts', sizing: 'measure', fields: [] }],
} as unknown as LinkPage;
const player = (row: number, jersey: [string, string], shorts: string): PersonForm => ({
  row, name: '', backName: `P${row}`, number: '', gender: 'male', measureAtShop: false, measures: {}, own: {},
  pieces: { 1: { qty: jersey[0], size: jersey[1] }, 2: { qty: shorts, size: '' } },
});

it("counts what the order link form holds so far: players, each item's pieces by size, sizes still to pick (the floating summary)", () => {
  const t = tallyOf(link, [player(1, ['1', 'L'], '1'), player(2, ['2', 'S'], '0'), player(3, ['1', ''], '1'), player(4, ['1', CUSTOM], '0'), player(5, ['0', ''], '0')]);
  expect(t.headline).toBe('4 players · 7 pieces'); // player 5 has no pieces
  expect(t.items).toEqual([
    { lineNo: 1, name: 'Jersey', qty: 5, sizes: [['S', 2], ['L', 1], ['Custom fit', 1], ['Size not picked yet', 1]] },
    { lineNo: 2, name: 'Shorts', qty: 2, sizes: [['Made to measurements', 2]] },
  ]);
  expect(t.unpicked).toBe(1);
  expect(t.share).toBeUndefined(); // only a member who pays their own share sees one
  const group = { ...link, kind: 'group', payOwn: true, prices: [{ lineNo: 1, tiers: [{ fromQty: 1, unitPriceCents: 50_000 }] }] } as LinkPage;
  expect(tallyOf(group, [player(1, ['2', 'M'], '0')])).toMatchObject({ headline: '2 pieces', share: 100_000 });
  expect(tallyOf(group, [player(1, ['1', 'M'], '1')]).share).toBeNull(); // the shorts have no price on the list
});
