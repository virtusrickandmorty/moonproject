import { describe, expect, it } from 'vitest';
import { GO_LIVE_PRINT_TITLE, visibleDecisions } from './go-live.ts';
describe('Go-Live Decisions print and filter', () => {
  const rows = [{ id: 'ACC-01', group: 'accountant' }, { id: 'CO-01', group: 'co-owners' }] as never;
  it('uses the required print title and filters by decision maker', () => { expect(GO_LIVE_PRINT_TITLE).toBe('Go-Live Decisions'); expect(visibleDecisions(rows, 'accountant').map((r) => r.id)).toEqual(['ACC-01']); });
});
