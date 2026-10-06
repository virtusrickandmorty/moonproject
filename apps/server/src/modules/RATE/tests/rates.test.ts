/** Piece-rate table (PLAN E7 RATE): starter rates, effective-dated versions with history, lookup, permissions. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';
import { rateAt } from '../rates.ts';

let env: TestEnv;
let encoder: Client;
let accountant: Client;

beforeEach(async () => {
  env = await createTestEnv(); encoderOwnDefaults(env);
  encoder = await env.as('encoder');
  accountant = await env.as('accountant');
});

const RATES = '/api/rate/rates';
const add = (body: object, who = accountant) => who.post(RATES, { garmentType: 'Polo shirt', stepCode: 'SEWING', complexity: 'standard', rateCents: 6_500, effectiveFrom: '2026-09-28', reason: 'Owner raised the polo rate', ...body });

describe('piece rates', () => {
  it('starts with the made-up starter table, one current rate per garment type, step and complexity', async () => {
    const r = (await encoder.get(RATES)).json();
    expect(r.asOf).toBe('2026-09-28');
    expect(r.current).toHaveLength(22);
    expect(r.current.find((x: { garmentType: string; stepCode: string; complexity: string }) => x.garmentType === 'T-shirt' && x.stepCode === 'SEWING' && x.complexity === 'standard')).toMatchObject({ rateCents: 4_000, effectiveFrom: '2026-01-01' });
    expect(r.garmentTypes).toEqual(['Blouse', 'Jacket', 'Jersey (NBA cut)', 'Jogging pants', 'Polo shirt', 'Scrub suit pants', 'Scrub suit top', 'Shorts', 'T-shirt']);
    expect(r.history).toHaveLength(22);
  });

  it('a new rate starts on its date and keeps the old one in the history; never backdated', async () => {
    const res = await add({});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ garmentType: 'Polo shirt', rateCents: 6_500, effectiveFrom: '2026-09-28' });
    expect(rateAt(env.db, 'Polo shirt', 'SEWING', 'standard', '2026-09-27')?.rateCents).toBe(6_000);
    expect(rateAt(env.db, 'polo SHIRT', 'SEWING', 'standard', '2026-09-28')?.rateCents).toBe(6_500); // any case

    expect((await add({ garmentType: 'polo shirt', rateCents: 6_800, effectiveFrom: '2026-10-05' })).json().garmentType).toBe('Polo shirt'); // joins the existing name
    const now = (await encoder.get(RATES)).json();
    expect(now.current.filter((x: { garmentType: string }) => x.garmentType === 'Polo shirt').map((x: { rateCents: number }) => x.rateCents)).toEqual([1_200, 7_000, 5_500, 6_500]);
    expect(now.history.slice(0, 2).map((x: { rateCents: number }) => x.rateCents)).toEqual([6_800, 6_500]);
    expect((await encoder.get(`${RATES}?asOf=2026-10-05`)).json().current.find((x: { garmentType: string; complexity: string; stepCode: string }) => x.garmentType === 'Polo shirt' && x.complexity === 'standard' && x.stepCode === 'SEWING').rateCents).toBe(6_800);

    // Two rows on the same date: the later one wins.
    await add({ rateCents: 6_600 });
    expect(rateAt(env.db, 'Polo shirt', 'SEWING', 'standard', '2026-09-28')?.rateCents).toBe(6_600);
    const audit = env.db.prepare(`SELECT COUNT(*) FROM audit_log WHERE action = 'rate.add'`).pluck().get();
    expect(audit).toBe(3);
  });

  it('refuses backdating, unknown steps, bad values and client extras', async () => {
    expect((await add({ effectiveFrom: '2026-09-27' })).json()).toMatchObject({ code: 'RATE_BACKDATED' });
    expect((await add({ effectiveFrom: '28/09/2026' })).json()).toMatchObject({ code: 'BAD_DATE' });
    expect((await add({ stepCode: 'IRONING' })).json()).toMatchObject({ code: 'STEP' });
    for (const bad of [{ rateCents: -1 }, { rateCents: 1_000_001 }, { complexity: 'hard' }, { reason: 'short' }, { garmentType: '' }, { createdBy: 'x' }]) {
      expect((await add(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await encoder.get(`${RATES}?asOf=yesterday`)).statusCode).toBe(400);
  });

  it('encoders and production see rates; only the accountant and owner set them', async () => {
    const production = await env.as('production');
    expect((await production.get(RATES)).statusCode).toBe(200);
    expect((await add({}, encoder)).statusCode).toBe(403);
    expect((await add({}, production)).statusCode).toBe(403);
    expect((await add({}, await env.as('owner'))).statusCode).toBe(200);
    expect((await (await env.as('tv')).get(RATES)).statusCode).toBe(403);
    const grants = env.db.prepare(`SELECT role_key FROM role_permissions WHERE permission_key = 'rate.override' AND granted = 1 ORDER BY role_key`).pluck().all();
    expect(grants).toEqual(['accountant', 'encoder', 'owner']); // OWN-26: encoders may override, with a reason
  });
});
