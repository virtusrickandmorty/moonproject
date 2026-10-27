/**
 * One rate change for many items (the owner's request, Oct 27, 2026): the items now paid the same rate get the new rate
 * in one save, each as its own new row (its own history), with the same rules as one rate; all saved or none.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
beforeEach(async () => { env = await createTestEnv(); owner = await env.as('owner'); });
afterEach(async () => { await env.app.close(); env.db.close(); });

const rate = (garmentType: string, part: string, rateCents: number) =>
  owner.post('/api/rate/rates', { garmentType, stepCode: 'SEWING', complexity: 'standard', part, rateCents, effectiveFrom: '2026-09-28', reason: 'Sewing rate for this set' });
const current = async (garmentType: string, part: string) =>
  ((await owner.get('/api/rate/rates')).json().current as { garmentType: string; stepCode: string; part: string; rateCents: number; complexity: string }[])
    .find((r) => r.garmentType === garmentType && r.stepCode === 'SEWING' && r.part === part && r.complexity === 'standard')?.rateCents;

describe('one rate change for many items', () => {
  it('sets the new rate for every item picked, from the date, each with its own history', async () => {
    const sets = ['Jersey set - Hexagon', 'Jersey set - Sporty Max', 'Jersey set - Micro Cool'];
    for (const g of sets) expect((await rate(g, 'upper', 5_000)).statusCode).toBe(200);
    const r = await owner.post('/api/rate/rates/bulk', { garmentTypes: [...sets.slice(0, 2), 'jersey set - hexagon'], stepCode: 'SEWING', complexity: 'standard', part: 'upper',
      rateCents: 5_500, effectiveFrom: '2026-09-28', reason: 'Owner raised the sewing rate for jersey sets' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().count).toBe(2); // the same item twice, in another case, is changed once
    expect(await current(sets[0]!, 'upper')).toBe(5_500);
    expect(await current(sets[1]!, 'upper')).toBe(5_500);
    expect(await current(sets[2]!, 'upper')).toBe(5_000); // not picked: unchanged
    const history = (await owner.get('/api/rate/rates')).json().history as { garmentType: string; rateCents: number }[];
    expect(history.filter((h) => h.garmentType === sets[0]).map((h) => h.rateCents).sort()).toEqual([5_000, 5_500]);
  });

  it('keeps the rules of one rate, and saves none when one cannot be saved', async () => {
    await rate('Polo - Pique', 'whole', 4_000);
    const base = { stepCode: 'SEWING', complexity: 'standard', rateCents: 4_500, reason: 'Owner raised the polo sewing rate' };
    expect((await owner.post('/api/rate/rates/bulk', { ...base, garmentTypes: ['Polo - Pique'], effectiveFrom: '2026-09-01' })).json().code).toBe('RATE_BACKDATED');
    expect((await owner.post('/api/rate/rates/bulk', { ...base, garmentTypes: [], effectiveFrom: '2026-09-28' })).statusCode).toBe(400);
    expect((await owner.post('/api/rate/rates/bulk', { ...base, stepCode: 'NO_SUCH', garmentTypes: ['Polo - Pique'], effectiveFrom: '2026-09-28' })).json().code).toBe('STEP');
    expect(await current('Polo - Pique', 'whole')).toBe(4_000);
    expect((await (await env.as('production')).post('/api/rate/rates/bulk', { ...base, garmentTypes: ['Polo - Pique'], effectiveFrom: '2026-09-28' })).statusCode).toBe(403);
  });
});
