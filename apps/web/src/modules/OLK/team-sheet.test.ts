import { expect, it } from 'vitest';
import { readXlsx, xlsx } from '../../generic/xlsx.ts';
import { CUSTOM, type LinkPage, type PersonForm } from './OrderLinkPage.tsx';
import { peopleFromRows, teamSheet } from './TeamSheet.tsx';

const link = {
  kind: 'team', title: 'Made-up Eagles', closesOn: '2026-12-01', open: true, payOwn: false,
  sizes: [{ label: 'S', category: 'adult' }, { label: 'M', category: 'adult' }, { label: 'L', category: 'adult' }],
  guide: [{ key: 'chest', label: 'Chest' }, { key: 'waist', label: 'Waist' }],
  items: [{ lineNo: 1, name: 'Jersey', sizing: 'size', customFit: true, fields: ['chest'] }, { lineNo: 2, name: 'Shorts', sizing: 'size', fields: [] }],
} as unknown as LinkPage;
const blank = (row: number): PersonForm => ({ row, name: '', backName: '', number: '', gender: '', measureAtShop: false, measures: {}, own: {},
  pieces: { 1: { qty: '1', size: '' }, 2: { qty: '1', size: '' } } });

it("makes the team's Excel template with the players already typed, and reads the filled file back into the form", async () => {
  const typed = { ...blank(1), backName: 'cruz', number: '7', gender: 'male' as const, pieces: { 1: { qty: '1', size: CUSTOM }, 2: { qty: '2', size: 'L' } }, measures: { chest: '38' } };
  const spec = teamSheet(link, [typed, blank(2)], CUSTOM);
  expect(spec.header).toEqual(['Name on the back', 'Number', 'Full name (optional)', 'Gender (Female or Male)', 'Jersey: how many', 'Jersey: size', 'Shorts: how many', 'Shorts: size', 'Chest (inches)']);
  expect(spec.rows).toEqual([['CRUZ', '7', '', 'Male', '1', 'Custom fit', '2', 'L', '38']]); // the blank card is left out
  expect(spec.lists).toEqual([{ col: 3, choices: ['Female', 'Male'] }, { col: 5, choices: ['S', 'M', 'L', 'Custom fit'] }, { col: 7, choices: ['S', 'M', 'L'] }]);

  // The coach adds rows in Excel: numbers come back as numbers, sizes in any case, an empty "how many" is 1.
  const rows = await readXlsx(await xlsx({ ...spec, rows: [...spec.rows,
    ['santos', 12, 'Made-up Santos', 'f', '', 'm', 0, '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['REYES', '1A', '', 'Lalaki', 'two', 'XXL', '', 'custom', ''],
    ['', '', 'Made-up No Back', '', '', 'S', '', 'S', ''],
  ] }));
  const got = peopleFromRows(link, rows, blank, CUSTOM);
  if ('problem' in got) throw new Error(got.problem);
  expect(got.people.map((p) => [p.row, p.backName, p.number, p.name, p.gender, p.pieces[1], p.pieces[2], p.measures])).toEqual([
    [1, 'CRUZ', '7', '', 'male', { qty: '1', size: CUSTOM }, { qty: '2', size: 'L' }, { chest: '38' }],
    [2, 'SANTOS', '12', 'Made-up Santos', 'female', { qty: '1', size: 'M' }, { qty: '0', size: '' }, {}],
    [3, 'REYES', '', '', 'male', { qty: '1', size: '' }, { qty: '1', size: '' }, {}],
    [4, '', '', 'Made-up No Back', '', { qty: '1', size: 'S' }, { qty: '1', size: 'S' }, {}],
  ]);
  expect(got.notes).toEqual([
    'Row 5: "1A" is not a number of up to 3 digits.',
    'Row 5: "two" for how many Jersey is not a number; 1 was put.',
    'Row 5: size "XXL" for Jersey is not on the shop\'s list; pick it on the form.',
    'Row 5: size "custom" for Shorts is not on the shop\'s list; pick it on the form.', // the shorts have no custom fit
    'Row 6 has no name on the back: type it on the form.',
  ]);
});

it('says plainly when the file is not the template or has no players', () => {
  expect(peopleFromRows(link, [['Name', 'Size'], ['CRUZ', 'L']], blank, CUSTOM)).toMatchObject({ problem: expect.stringContaining('not the shop\'s template') });
  expect(peopleFromRows(link, [['Name on the back', 'Number'], ['', '']], blank, CUSTOM)).toMatchObject({ problem: expect.stringContaining('no players yet') });
});
