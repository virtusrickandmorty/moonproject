/**
 * Customer search, word by word (the owner's request, Oct 28, 2026): every typed word, in any order, in the name, code,
 * registered name, TIN, email, phones or contact persons; the customer numbered as typed first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env?.db.close(); env = undefined; });

describe('customer search', () => {
  it('finds a customer by any of its words, its phone, TIN or contact person', async () => {
    env = await createTestEnv();
    const encoder = await env.as('encoder');
    const add = async (body: object) => { const r = await encoder.post('/api/cus/customers', body); expect(r.statusCode, r.body).toBe(200); return r.json() as { id: string; code: string }; };
    const mary = await add({ kind: 'organization', displayName: 'St. Mary Academy', tin: '123456789000' });
    const club = await add({ kind: 'organization', displayName: 'Paper Lantern Club' });
    expect((await encoder.post(`/api/cus/customers/${mary.id}/phones`, { phone: '0917 000 1234' })).statusCode).toBe(200);
    expect((await encoder.post(`/api/cus/customers/${club.id}/contacts`, { name: 'Coach Placeholder', phone: '0917 555 0101' })).statusCode).toBe(200);
    const find = async (search: string) => ((await encoder.get(`/api/cus/customers?${new URLSearchParams({ search, limit: '200' })}`)).json() as { id: string; search_text?: string }[]);
    const ids = async (search: string) => (await find(search)).map((r) => r.id);

    expect(await ids('academy mary')).toEqual([mary.id]);
    expect(await ids('0917 000 1234')).toEqual([mary.id]);
    expect(await ids('09170001234')).toEqual([mary.id]);
    expect(await ids('123-456-789-000')).toEqual([mary.id]);
    expect(await ids('coach')).toEqual([club.id]);
    expect(await ids('09175550101')).toEqual([club.id]);
    expect(await ids('mary lantern')).toEqual([]);
    expect((await find('mary'))[0]).not.toHaveProperty('search_text');
    // The customer numbered as typed first: CUS-…2 for "2".
    expect((await ids(String(Number(club.code.replace(/\D/g, ''))))).at(0)).toBe(club.id);
    // Nothing typed: every customer, by name, in pages.
    const all = (await encoder.get('/api/cus/customers?limit=1&offset=1')).json() as { display_name: string }[];
    expect(all.map((r) => r.display_name)).toEqual(['St. Mary Academy']);
  });
});
