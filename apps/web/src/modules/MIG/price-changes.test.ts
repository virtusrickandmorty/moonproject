/** What the import check shows for a price list uploaded again, and how the result reads. Made-up items only. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DryRunResult, MigCommitResult } from '../../api.ts';
import { peso } from '../../components/ui.tsx';
import { PriceChanges } from './Finish.tsx';
import { commitLines, priceListWords, ratesGoingDown } from './importer.ts';

const priceList: NonNullable<DryRunResult['priceList']> = {
  newItems: ['Sample cap'], unchanged: 3,
  rates: [{ item: 'Sample shirt', what: 'Sewing', row: 2, fromCents: 7_000, toCents: 5_000 }, { item: 'Sample shorts', what: 'Sewing', row: 3, fromCents: 4_000, toCents: 4_500 }, { item: 'Sample cap', what: 'Sewing', row: 4, fromCents: null, toCents: 1_000 }],
  prices: [{ item: 'Sample shirt', what: 'Price', row: 2, fromCents: 45_000, toCents: 48_000 }],
  zeroKept: [{ item: 'Sample vest', what: 'Sewing', row: 5, keptCents: 3_000 }],
  clashes: [{ item: 'Sample set', what: 'Sewing (upper)', rows: [6, 7], usedRow: 7 }],
};
const dry = { priceList } as DryRunResult;

describe('a price list uploaded again', () => {
  it('counts what changes, and picks out the rates going down', () => {
    expect(priceListWords(dry)).toBe('3 rates change, 1 price changes, 1 new item, 3 rows have no change');
    expect(ratesGoingDown(dry).map((c) => c.item)).toEqual(['Sample shirt']);
    expect(ratesGoingDown({} as DryRunResult)).toEqual([]);
  });

  it('shows every change before anything is imported, with what to watch for', () => {
    const markup = renderToStaticMarkup(createElement(PriceChanges, { dry }));
    for (const words of ['What this price list will change', '1 rate goes down', 'exclude its row', 'said twice', 'rows 6, 7', 'is ignored', 'New items: Sample cap', 'None yet', peso(7_000), peso(5_000), peso(48_000)]) expect(markup).toContain(words);
  });

  it('shows nothing for an upload with no price list', () => {
    expect(renderToStaticMarkup(createElement(PriceChanges, { dry: {} as DryRunResult }))).toBe('');
  });

  it('says rows were updated or had no change, not that they were imported before', () => {
    const counts = { customer: { imported: 0, alreadyImported: 0 }, group: { imported: 0, alreadyImported: 0 }, wearer: { imported: 0, alreadyImported: 0 }, measurement: { imported: 0, alreadyImported: 0 }, employee: { imported: 0, alreadyImported: 0 }, piece_rate: { imported: 2, alreadyImported: 5 } };
    const lines = commitLines({ counts } as unknown as MigCommitResult);
    expect(lines.map(([, value]) => value)).toContain('2 added or updated, 5 with no change');
  });
});
