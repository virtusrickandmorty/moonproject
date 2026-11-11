import { expect, it } from 'vitest';
import { colName, readCsv, readSheetFile, readXlsx, unzip, xlsx, zip } from './xlsx.ts';

it('writes an .xlsx that reads back: header, rows, empty cells, numbers and odd characters', async () => {
  const bytes = await xlsx({ name: 'Players', header: ['Name on the back', 'Number', 'Size'], rows: [['CRUZ', 7, 'L'], ['DELA <ROSA> & CO', '', 'M'], ['ÑIÑO "JR"', 23, '']],
    lists: [{ col: 2, choices: ['S', 'M', 'L'] }] });
  expect(await readXlsx(bytes)).toEqual([['Name on the back', 'Number', 'Size'], ['CRUZ', '7', 'L'], ['DELA <ROSA> & CO', '', 'M'], ['ÑIÑO "JR"', '23']]);
  const parts = await unzip(bytes);
  expect([...parts.keys()]).toContain('xl/worksheets/sheet1.xml');
  const sheet = new TextDecoder().decode(parts.get('xl/worksheets/sheet1.xml'));
  expect(sheet).toContain('<formula1>"S,M,L"</formula1>'); // the size drop-down
  expect(sheet).toContain('state="frozen"');
});

it('reads a sheet saved by Excel: compressed, shared strings with rich text, a second sheet, cells out of order', async () => {
  const enc = new TextEncoder();
  const files = {
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="List" sheetId="5" r:id="rId9"/><sheet name="Other" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId9"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name on the back</t></si><si><r><t>RE</t></r><r><rPr/><t xml:space="preserve">YES</t></r></si><si><t>Tom &amp; Jerry</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="C3"><v>12.5</v></c><c r="A3" t="s"><v>1</v></c><c r="B3" t="b"><v>1</v></c></row></sheetData></worksheet>',
  };
  const bytes = await zip(Object.entries(files).map(([name, text]) => ({ name, data: enc.encode(text) })), true);
  expect(await readXlsx(bytes)).toEqual([['Name on the back'], [], ['REYES', 'TRUE', '12.5']]);
});

it('reads .csv files (commas, semicolons, quotes) and knows an old .xls when it sees one', async () => {
  expect(readCsv('﻿Name,Size\r\n"CRUZ, JR",L\n"SAY ""HI""",M\n')).toEqual([['Name', 'Size'], ['CRUZ, JR', 'L'], ['SAY "HI"', 'M']]);
  expect(readCsv('Name;Size\nCRUZ;L')).toEqual([['Name', 'Size'], ['CRUZ', 'L']]);
  const csv = Object.assign(new Blob(['A,B\n1,2']), { name: 'list.csv' });
  expect(await readSheetFile(csv)).toEqual([['A', 'B'], ['1', '2']]);
  const xls = Object.assign(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])]), { name: 'list.xls' });
  await expect(readSheetFile(xls)).rejects.toThrow('OLD_XLS');
  expect([0, 25, 26, 27, 51, 52].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
});
