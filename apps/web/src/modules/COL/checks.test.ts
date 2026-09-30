/** Customer checks on the screens: check details on tenders into Checks on hand only, ticking checks to deposit, the post-dated list's actions, and the menu. */
import { describe, expect, it } from 'vitest';
import type { CheckOnHand } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { PAGES } from '../screens.ts';
import { checkPlaceIds, tendersToInput, tendersToRows } from './money.ts';
import { pdcActions, pdcCollectionPath, ticked } from './checks.ts';

const CHECKS = 3;
const places = checkPlaceIds([{ id: 1, kind: 'cash' }, { id: CHECKS, kind: 'checks' }, { id: 4, kind: 'bank' }, { id: 9 }]);

describe('tenders with checks', () => {
  it('a tender into Checks on hand needs the check number, bank and date; others never send them', () => {
    const row = { cashPlaceId: String(CHECKS), amount: '12,500.00', reference: '', checkNumber: ' 000123 ', bank: ' Sample Bank ', checkDate: '2026-09-25' };
    expect(tendersToInput([row], undefined, places)).toEqual({ tenders: [{ cashPlaceId: CHECKS, amountCents: 1_250_000, check: { number: '000123', bank: 'Sample Bank', date: '2026-09-25' } }], errors: [] });
    expect(tendersToInput([{ ...row, bank: '' }], undefined, places).errors).toEqual(['Payment 1: type the check number, the bank and the date on the check.']);
    expect(tendersToInput([{ ...row, cashPlaceId: '1' }], undefined, places).tenders).toEqual([{ cashPlaceId: 1, amountCents: 1_250_000 }]);
    expect(places).toEqual(new Set([CHECKS]));
  });

  it('an edit fills the check back into its row', () => {
    const rows = tendersToRows([{ cashPlaceId: CHECKS, amountCents: 50_000, check: { number: '77', bank: 'Sample Bank', date: '2026-09-01' } }]);
    expect(rows).toEqual([{ cashPlaceId: '3', amount: '500.00', reference: '', checkNumber: '77', bank: 'Sample Bank', checkDate: '2026-09-01' }]);
    expect(tendersToInput(rows, undefined, places).tenders[0]!.check).toEqual({ number: '77', bank: 'Sample Bank', date: '2026-09-01' });
  });
});

describe('checks on hand and post-dated checks screens', () => {
  const check = (collectionId: string, lineNo: number, amountCents: number) => ({ collectionId, lineNo, amountCents }) as CheckOnHand;
  it('deposits exactly the ticked checks, for their total', () => {
    const list = [check('a', 1, 25_000), check('a', 2, 10_000), check('b', 1, 400_050)];
    expect(ticked(list, new Set(['a:2', 'b:1']))).toEqual({ refs: [{ collectionId: 'a', lineNo: 2 }, { collectionId: 'b', lineNo: 1 }], totalCents: 410_050 });
    expect(ticked(list, new Set())).toEqual({ refs: [], totalCents: 0 });
  });

  it('a post-dated check is recorded once due and voided while listed', () => {
    expect(pdcActions({ status: 'waiting' })).toEqual({ record: false, void: true });
    expect(pdcActions({ status: 'due' })).toEqual({ record: true, void: true });
    expect(pdcActions({ status: 'used' })).toEqual({ record: false, void: false });
    expect(pdcActions({ status: 'voided' })).toEqual({ record: false, void: false });
    expect(pdcCollectionPath('p-1')).toBe('/docs/col.collection/new?pdc=p-1');
  });

  it('shows Checks on hand under Money and Post-dated checks under Sales, only with col.checks.view', () => {
    const labels = (perms: string[]) => buildMenu([], new Set(perms)).flatMap((g) => g.items.map((i) => `${g.group}: ${i.label}`));
    expect(labels(['col.checks.view'])).toEqual(expect.arrayContaining(['Money: Checks on hand', 'Sales: Post-dated checks']));
    expect(labels([]).filter((l) => /checks/i.test(l))).toEqual([]);
    expect(PAGES['/col/checks']).toBeDefined();
    expect(PAGES['/col/pdcs']).toBeDefined();
  });
});
