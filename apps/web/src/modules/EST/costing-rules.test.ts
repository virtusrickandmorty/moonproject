import { describe, expect, it } from 'vitest';
import { percentBp, rulesOf } from './Costing.tsx';

const form = (o: object = {}) => ({ overhead: '10', commission: '0', roundTo: '500', tiers: [{ fromQty: '1', margin: '45' }, { fromQty: '12', margin: '35' }], reason: 'Our own costing rules', ...o });

describe('the costing rules form', () => {
  it('takes percents typed with a % sign, spaces or decimals, and quantities with commas', () => {
    expect([percentBp('10%'), percentBp(' 12.5 % '), percentBp('0'), percentBp('ten')]).toEqual([1_000, 1_250, 0, null]);
    expect(rulesOf(form({ overhead: '15%', tiers: [{ fromQty: '1', margin: '45%' }, { fromQty: '1,000', margin: '20%' }] })).rules)
      .toEqual({ overheadBp: 1_500, commissionBp: 0, roundToCents: 500, tiers: [{ fromQty: 1, marginBp: 4_500 }, { fromQty: 1_000, marginBp: 2_000 }], reason: 'Our own costing rules' });
  });

  it('names each box that is not right instead of one message for all', () => {
    expect(rulesOf(form({ commission: 'five', tiers: [{ fromQty: '12', margin: '95' }], reason: 'short' })).problems).toEqual([
      'Commission: type a percent from 0 to 50, like 5.', 'Tier 1: type the margin as a percent up to 90, like 35.', 'One tier starts at 1 piece.',
      'A margin and the commission together must stay under 95%.', 'Reason: say why the rules change (10 characters or more).',
    ]);
  });
});
