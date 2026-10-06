/** The asset screens' read-only routes: one asset's page, the months with no depreciation run, and who may see them. */
import { describe, expect, it } from 'vitest';
import { cashPlaceId, createTestEnv, idem, encoderOwnDefaults } from '../../../../test/helpers.ts';

async function shop() {
  const env = await createTestEnv(); encoderOwnDefaults(env); // today is 2026-09-28
  let acc = await env.as('accountant');
  const supplierId = (await acc.post('/api/pur/suppliers', { name: 'Sample Machines', registeredName: 'Sample Machines Corp.', tin: '123-456-789-000', isVatRegistered: true })).json().id as string;
  const buy = (await acc.post('/api/docs/fa.buy/post', {
    input: { classCode: 'machinery', description: 'Heat press', supplierId, supplierInvoiceNo: 'SI-2001', supplierInvoiceDate: '2026-09-28', amountCents: 11_200_000, residualCents: 1_000_000, cashPlaceId: cashPlaceId(env.db, '1111'), paidCents: 11_200_000 },
    expectedTotalCents: 11_200_000,
  }, idem())).json() as { id: string; number: string };
  const run = async (month: string) => {
    const total = (await acc.post('/api/docs/fa.depreciation/preview', { input: { month } })).json().totalCents;
    return (await acc.post('/api/docs/fa.depreciation/post', { input: { month }, expectedTotalCents: total }, idem())).json() as { id: string; number: string };
  };
  const goTo = async (iso: string) => (env.clock.set(iso), (acc = await env.as('accountant')));
  return { env, buy, run, goTo, acc: () => acc };
}

describe('fixed-asset screens: read-only routes', () => {
  it('an asset page has its months from the recorded runs, its documents and no missing month while runs are up to date', async () => {
    const { env, buy, run, acc } = await shop();
    const r = await run('2026-09');
    const page = (await acc().get(`/api/fa/assets/${buy.id}`)).json();
    expect(page).toMatchObject({ id: buy.id, number: buy.number, className: 'Machinery and production equipment', status: 'in service', costCents: 10_000_000, accumulatedCents: 150_000, bookValueCents: 9_850_000, missingMonths: [] });
    expect(page.depreciation).toEqual([{ month: '2026-09', documentId: r.id, documentNumber: r.number, chargeCents: 150_000, accumulatedCents: 150_000 }]);
    expect(page.documents.map((d: { docType: string; number: string; status: string }) => [d.docType, d.number, d.status])).toEqual([['fa.buy', buy.number, 'posted'], ['fa.depreciation', r.number, 'posted']]);
    expect((await acc().get('/api/fa/depreciation-gaps')).json()).toEqual({ thisMonth: '2026-09', lastRunMonth: '2026-09', months: [] });
    env.db.close();
  });

  it('a month before this one with no charge is a gap, on the register and on the asset; catching up later does not hide it', async () => {
    const { buy, run, goTo, acc } = await shop();
    await run('2026-09');
    await goTo('2026-11-15T10:00:00+08:00');
    expect((await acc().get('/api/fa/depreciation-gaps')).json()).toEqual({ thisMonth: '2026-11', lastRunMonth: '2026-09', months: ['2026-10'] });
    expect((await acc().get(`/api/fa/assets/${buy.id}`)).json().missingMonths).toEqual(['2026-10']);
    const caughtUp = await acc().post('/api/docs/fa.depreciation/post', { input: { month: '2026-11' }, expectedTotalCents: 300_000 }, idem());
    expect(caughtUp.statusCode).toBe(200); // the November run charges October too, but October has no run of its own
    expect((await acc().get('/api/fa/depreciation-gaps')).json().months).toEqual(['2026-10']);
  });

  it('a disposed asset lists its disposal and has no gaps', async () => {
    const { buy, run, goTo, acc } = await shop();
    await run('2026-09');
    await goTo('2026-11-15T10:00:00+08:00');
    const d = (await acc().post('/api/docs/fa.disposal/post', { input: { assetId: buy.id, kind: 'retirement', reason: 'Scrapped, no longer used' }, expectedTotalCents: 10_000_000 }, idem())).json();
    const page = (await acc().get(`/api/fa/assets/${buy.id}`)).json();
    expect(page).toMatchObject({ status: 'disposed', bookValueCents: 0, missingMonths: [] });
    expect(page.documents.at(-1)).toMatchObject({ docType: 'fa.disposal', number: d.number, status: 'posted' });
    expect((await acc().get('/api/fa/depreciation-gaps')).json().months).toEqual([]);
  });

  it('needs fa.assets.view, and an unknown asset is 404', async () => {
    const { env, buy, acc } = await shop();
    for (const role of ['encoder', 'production', 'tv'] as const) {
      const c = await env.as(role);
      expect((await c.get(`/api/fa/assets/${buy.id}`)).statusCode, role).toBe(403);
      expect((await c.get('/api/fa/depreciation-gaps')).statusCode, role).toBe(403);
    }
    expect((await acc().get('/api/fa/assets/nope')).statusCode).toBe(404);
    expect((await (await env.as('owner')).get(`/api/fa/assets/${buy.id}`)).statusCode).toBe(200);
  });
});
