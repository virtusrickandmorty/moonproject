import { expect, it } from 'vitest';
import type { LinkPage, PersonForm } from './OrderLinkPage.tsx';
import { mergeEntries, type TeamEntry } from './TeamPlayers.tsx';

const link = { kind: 'team', items: [{ lineNo: 1, name: 'Jersey', sizing: 'size', fields: [] }], sizes: [], guide: [] } as unknown as LinkPage;
const blank = (row: number, backName = ''): PersonForm => ({ row, name: '', backName, number: '', gender: '', measureAtShop: false, measures: {}, own: {}, pieces: { 1: { qty: '1', size: '' } } });
const entry = (id: string, backName: string, size: string, updatedAt = '2026-11-11T10:00:00', onList = false): TeamEntry => ({
  id, sentAt: updatedAt, updatedAt, onList,
  person: { row: 1, backName, gender: 'male', measureAtShop: false, pieces: [{ lineNo: 1, qty: 1, size }], measures: {}, itemMeasures: [] },
});

it("puts the players' rows into the coach's cards: empty cards first, changed rows replaced, rows already sent left out", () => {
  const start = [blank(1, 'COACH TYPED'), blank(2), blank(3)];
  const once = mergeEntries(link, start, [entry('a', 'CRUZ', 'M'), entry('b', 'REYES', 'L'), entry('c', 'LIM', 'S'), entry('d', 'SENT', 'S', '2026-11-11T09:00:00', true)]);
  expect(once.map((p) => [p.row, p.backName, p.pieces[1]?.size, p.entry?.id ?? null])).toEqual([
    [1, 'COACH TYPED', '', null], [2, 'CRUZ', 'M', 'a'], [3, 'REYES', 'L', 'b'], [4, 'LIM', 'S', 'c'],
  ]);
  // The coach changed CRUZ's card; the player has not changed theirs since: the coach's change stays.
  const coachEdit = once.map((p) => (p.entry?.id === 'a' ? { ...p, number: '9' } : p));
  expect(mergeEntries(link, coachEdit, [entry('a', 'CRUZ', 'M')])[1]!.number).toBe('9');
  // REYES changed their size later: their card takes it, on the same row.
  const again = mergeEntries(link, coachEdit, [entry('b', 'REYES', 'XL', '2026-11-11T11:00:00')]);
  expect(again[2]).toMatchObject({ row: 3, backName: 'REYES', pieces: { 1: { size: 'XL' } }, entry: { id: 'b', at: '2026-11-11T11:00:00' } });
  expect(again).toHaveLength(4);
});
