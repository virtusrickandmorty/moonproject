/** The web client and form rules against the real server (in memory), proven with the Fund Transfer (cash.transfer). */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey as key } from './api.ts';
import { fieldsOf, toInput, toValues } from './generic/fields.ts';

/** fetch() backed by app.inject, with a cookie jar that behaves like the browser's. */
const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('web client with the Fund Transfer', () => {
  it('first owner; record after confirm; retried click; view; edit = cancel and reissue; cancel; drafts; sign out', async () => {
    const env = await createTestEnv();
    const api = createApi(injectFetch(env.app));
    expect(await api.setupStatus()).toEqual({ needsFirstOwner: true });
    await api.firstOwner({ username: 'owner1', displayName: 'Test Owner', password: 'moon garden paper lamp' });
    expect(await api.me()).toMatchObject({ displayName: 'Test Owner', roles: ['owner'], mustChangePassword: false });

    const trf = (await api.docTypes()).find((d) => d.key === 'cash.transfer')!;
    expect(trf).toMatchObject({ module: 'CASH', title: 'Fund Transfer', canCreate: true, canPost: true, canCancel: true });
    const fields = fieldsOf(trf.inputJsonSchema);
    const place = async (name: string) => String((await api.cashPlaces()).find((p) => p.name.endsWith(name))!.id);
    const typed = { fromCashPlaceId: await place('BDO'), toCashPlaceId: await place('China Bank'), amountSentCents: '10,000', amountReceivedCents: '9,975.00' };
    const { input } = toInput(fields, typed);
    const pre = await api.preview(trf.key, input);
    expect(pre.summary).toBe('This will move ₱10,000.00 from Cash in bank – BDO to Cash in bank – China Bank (₱9,975.00 arrived, fee ₱25.00).');
    expect(pre.journal).toHaveLength(3); // owners see "Behind the scenes" in the confirm dialog

    const k = key();
    const first = await api.post(trf.key, input, pre.totalCents, k);
    expect(first).toMatchObject({ number: 'TRF-000001', totalCents: 1_000_000 });
    expect((await api.post(trf.key, input, pre.totalCents, k)).id).toBe(first.id); // a retried click records once
    await expect(api.post(trf.key, input, 999, key())).rejects.toMatchObject({ code: 'TOTALS_CHANGED', status: 409 });

    const view = await api.get(trf.key, first.id);
    expect(toValues(fields, view.input)).toEqual({ ...typed, amountSentCents: '10,000.00' });
    expect(view.journals![0]!.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])).toEqual([['1112', 997_500, 0], ['6230', 2_500, 0], ['1111', 0, 1_000_000]]);

    const edited = toInput(fields, { ...toValues(fields, view.input), amountReceivedCents: '10,000' }).input;
    const re = await api.reissue(trf.key, first.id, edited, (await api.preview(trf.key, edited)).totalCents, 'The bank refunded the fee', key());
    expect(re.number).toBe('TRF-000002');
    await api.cancel(trf.key, re.id, 'Recorded on the wrong day', key());
    const list = await api.list(trf.key);
    expect(list.map((r) => [r.number, r.status, r.cancelReason, r.replacedById])).toEqual([
      ['TRF-000002', 'cancelled', 'Recorded on the wrong day', null],
      ['TRF-000001', 'cancelled', 'The bank refunded the fee', re.id],
    ]);
    expect(await api.list(trf.key, { status: 'posted' })).toEqual([]);
    const filters = { q: 'TRF-000001', from: view.header.businessDate, to: view.header.businessDate };
    expect((await api.list(trf.key, { ...filters, limit: 25 })).map((r) => r.number)).toEqual(['TRF-000001']);
    expect(await api.docCounts(trf.key, filters)).toEqual({ all: 1, posted: 0, cancelled: 1 });
    expect(await api.docCounts(trf.key, { q: 'BDO' })).toEqual({ all: 2, posted: 0, cancelled: 2 });
    expect(await api.list(trf.key, { q: 'no such supplier' })).toEqual([]);
    expect(await api.docCounts(trf.key, { q: 'no such supplier' })).toEqual({ all: 0, posted: 0, cancelled: 0 });

    const d = await api.createDraft(trf.key, { values: { amountSentCents: '500' } });
    await api.saveDraft(d.id, d.version, { values: { amountSentCents: '750' } });
    await expect(api.saveDraft(d.id, d.version, { values: {} })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await api.drafts(trf.key)).map((x) => x.payload)).toEqual([{ values: { amountSentCents: '750' } }]);
    await api.discardDraft(d.id);
    expect(await api.drafts(trf.key)).toEqual([]);

    await api.logout();
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
  });

  it('encoders never get debits and credits; changes need the in-memory CSRF token; lost sessions are reported', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'encoder1', ['encoder']);
    createUser(env.db, 'newhire', ['encoder'], true);
    const jar = { cookie: '' };
    const api = createApi(injectFetch(env.app, jar));
    const signedOut: string[] = [];
    api.onSignedOut((e) => signedOut.push(e.code));

    await api.login('encoder1', PASSWORD);
    const [a, b] = await api.cashPlaces();
    const input = { fromCashPlaceId: a!.id, toCashPlaceId: b!.id, amountSentCents: 50_000, amountReceivedCents: 50_000 };
    const pre = await api.preview('cash.transfer', input);
    expect(pre.journal).toBeUndefined();
    const { id } = await api.post('cash.transfer', input, pre.totalCents, key());
    expect((await api.get('cash.transfer', id)).journals).toBeUndefined();
    // Same cookie, but this client never received the token.
    await expect(createApi(injectFetch(env.app, jar)).preview('cash.transfer', input)).rejects.toMatchObject({ code: 'CSRF', status: 403 });

    env.clock.advance(61 * 60_000); // idle timeout
    await expect(api.docTypes()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await api.login('newhire', PASSWORD);
    await expect(api.docTypes()).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    await api.changePassword(PASSWORD, 'a brand new long passphrase');
    expect((await api.me()).mustChangePassword).toBe(false);
    expect(signedOut).toEqual(['AUTH_REQUIRED', 'PASSWORD_CHANGE_REQUIRED']);
  });
});

it('encodes list search, dates, status and cursor; counts receive only the shared filters', async () => {
  const urls: URL[] = [];
  const api = createApi(async (url) => { urls.push(new URL(url, 'http://shop.test')); return new Response('[]'); });
  const filters = { q: 'Sample & supplier %_\\', from: '2026-09-01', to: '2026-09-30' };
  await api.list('cash.transfer', { ...filters, status: 'cancelled', before: '2026-09-25T12:00:00+08:00', limit: 25 });
  await api.docCounts('cash.transfer', filters);
  expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ ...filters, status: 'cancelled', before: '2026-09-25T12:00:00+08:00', limit: '25' });
  expect(urls[1]!.pathname).toBe('/api/docs/cash.transfer/counts');
  expect(Object.fromEntries(urls[1]!.searchParams)).toEqual(filters);
});
