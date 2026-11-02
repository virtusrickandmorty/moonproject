/** Job orders from an order link (the owner's request, Nov 2026): one for the team or group, or a member's own. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, idem, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
let jersey: string, top: string, pants: string;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const item = async (code: string, name: string, cents: number) => {
    const id = (await owner.post('/api/cat/items', { code, name, class: 'made_to_order_garment', garmentType: name, unit: 'pc', setComponents: 1 })).json().id as string;
    const p = await owner.post(`/api/cat/items/${id}/prices`, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: cents }, { 'if-match': '1' });
    expect(p.statusCode, p.body).toBe(200);
    return id;
  };
  [jersey, top, pants] = [await item('JRS-1', 'Team jersey', 45_000), await item('TOP-1', 'Scrub top', 60_000), await item('PNT-1', 'Scrub pants', 55_000)];
});

const answer = async (token: string, body: object, ip = '203.0.113.7') => {
  const r = await env.app.inject({ method: 'POST', url: `/api/olk/l/${token}/answers`, payload: body, remoteAddress: ip });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; key: string };
};
type Prepared = { customer: { id: string; name: string }; contact: string; notes: string;
  lines: { itemId: string; kind: string; description: string; qty: number; listCents: number | null; roster: { personId?: string; name: string; sizeMode: string; size?: string; jerseyName?: string; jerseyNumber?: string; qty: number; notes?: string }[] }[] };
const start = async (linkId: string, body: object) => {
  const r = await owner.post(`/api/olk/links/${linkId}/job-order`, body);
  return { status: r.statusCode, body: r.json() as Prepared & { code?: string } };
};
/** Records the job order as the form would, from what was prepared. */
async function record(p: Prepared) {
  const lines = p.lines.map((l) => ({ kind: l.kind, description: l.description, qty: l.qty, unitPriceCents: l.listCents!, discountCents: 0,
    roster: l.roster.map(({ name, ...r }) => (r.personId ? r : { name, ...r })) }));
  const input = { customerId: p.customer.id, ...(p.contact ? { contact: p.contact } : {}), dueInDays: 15, priority: 'normal', paymentTerms: 'dp50', notes: p.notes, lines };
  return owner.post('/api/docs/jo.job_order/post', { input, expectedTotalCents: lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0) }, idem());
}

it("a team list becomes one job order for the coach as a new customer, with the players' sizes, names and numbers", async () => {
  const link = (await owner.post('/api/olk/links', { kind: 'team', title: 'Made-up League jerseys', closesOn: '2026-10-05', items: [{ itemId: jersey, sizing: 'size' }] })).json();
  const p = (row: number, backName: string, number: string, size: string) => ({ row, backName, number, gender: 'male', pieces: [{ lineNo: 1, qty: 1, size }] });
  const a = await answer(link.token, { name: 'Made-up Coach', gender: 'male', mobile: '09180000000', email: 'Coach@Example.test', address: 'Made-up Gym, Mabini',
    people: [p(1, 'CRUZ', '7', 'L'), p(2, 'SANTOS', '10', 'M'), p(3, 'REYES', '11', 'M')] });

  const { status, body } = await start(link.id, { responseIds: [a.id], together: true });
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.customer.name).toBe('Made-up Coach');
  expect(body).toMatchObject({ contact: 'Made-up Coach · +639180000000', notes: 'From the order link "Made-up League jerseys".' });
  expect(body.lines).toEqual([{ itemId: jersey, kind: 'made_to_order', description: 'Team jersey', isSet: false, qty: 3, listCents: 45_000, roster: [
    { name: 'CRUZ', sizeMode: 'preset', size: 'L', jerseyName: 'CRUZ', jerseyNumber: '7', qty: 1 },
    { name: 'SANTOS', sizeMode: 'preset', size: 'M', jerseyName: 'SANTOS', jerseyNumber: '10', qty: 1 },
    { name: 'REYES', sizeMode: 'preset', size: 'M', jerseyName: 'REYES', jerseyNumber: '11', qty: 1 },
  ] }]);
  expect(env.db.prepare("SELECT email FROM cus_customers WHERE id = ?").pluck().get(body.customer.id)).toBe('coach@example.test');
  expect(env.db.prepare("SELECT phone FROM cus_customer_phones WHERE customer_id = ?").pluck().get(body.customer.id)).toBe('+639180000000');
  const jo = await record(body);
  expect(jo.statusCode, jo.body).toBe(200);
  const detail = (await owner.get(`/api/olk/links/${link.id}`)).json();
  expect(detail.responses[0].made).toMatchObject([{ together: true, customer: 'Made-up Coach' }]);
});

it('a group order: one job order for everyone with their measurements, or a late member on their own', async () => {
  const school = (await owner.post('/api/cus/customers', { kind: 'organization', displayName: 'Made-up Clinic' })).json().id as string;
  const link = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Clinic uniforms', closesOn: '2026-10-10', customerId: school,
    items: [{ itemId: top, sizing: 'size' }, { itemId: pants, sizing: 'measure', fields: ['lowerWaist', 'hips', 'lowerLength'] }] })).json();
  const member = (name: string, email: string, person: object) => ({ name, gender: 'female', mobile: '0917 000 0000', email, address: '12 Made-up St.', people: [{ row: 0, gender: 'female', ...person }] });
  const ana = await answer(link.token, member('Made-up Ana', 'ana@example.test', { pieces: [{ lineNo: 1, qty: 2, size: 'M' }, { lineNo: 2, qty: 2 }],
    measures: { lowerWaist: 30, hips: 39, lowerLength: 39 }, itemMeasures: [{ lineNo: 2, field: 'lowerLength', value: 40.5 }] }));
  const bea = await answer(link.token, member('Made-up Bea', 'bea@example.test', { pieces: [{ lineNo: 2, qty: 1 }], measureAtShop: true }), '203.0.113.8');

  // More than one answer and no customer picked: the link's customer.
  const { status, body } = await start(link.id, { responseIds: [ana.id, bea.id], together: true });
  expect(status, JSON.stringify(body)).toBe(200);
  expect(body.customer).toEqual({ id: school, name: 'Made-up Clinic' });
  expect(body.notes).toBe('From the order link "Made-up Clinic uniforms" (2 answers).');
  expect(body.lines.map((l) => [l.description, l.qty, l.listCents])).toEqual([['Scrub top', 2, 60_000], ['Scrub pants', 3, 55_000]]);
  const [anaRow, beaRow] = body.lines[1]!.roster;
  expect(anaRow).toMatchObject({ name: 'Made-up Ana', sizeMode: 'measured', qty: 2, notes: 'For this item: pants length 40.5 in' });
  expect(beaRow).toMatchObject({ name: 'Made-up Bea', sizeMode: 'measured', qty: 1, notes: 'Measure at the shop' });
  const chart = env.db.prepare("SELECT lower_waist_hundredths AS w, hips_hundredths AS h, revision_no AS rev FROM cus_measure_charts WHERE person_id = ? AND status = 'active'");
  expect(chart.get(anaRow!.personId)).toEqual({ w: 3000, h: 3900, rev: 1 });
  expect(chart.get(beaRow!.personId)).toBeUndefined(); // to be measured at the shop: the job order asks for it before recording
  expect((await record(body)).json().code).toBe('VALIDATION');

  // Started again after Ana changed her answer: the same wearer, a new chart revision.
  await env.app.inject({ method: 'PUT', url: `/api/olk/l/${link.token}/answers/${ana.key}`, payload: member('Made-up Ana', 'ana@example.test', { pieces: [{ lineNo: 2, qty: 1 }], measures: { lowerWaist: 31, hips: 39, lowerLength: 39 } }) });
  const again = (await start(link.id, { responseIds: [ana.id], together: true })).body;
  expect(again.lines[0]!.roster[0]!.personId).toBe(anaRow!.personId);
  expect(chart.get(anaRow!.personId)).toEqual({ w: 3100, h: 3900, rev: 2 });
  expect((await record(again)).statusCode).toBe(200);

  // A member's own job order: that member as the customer, the one already on file with that email when there is one.
  const own = await answer(link.token, member('Made-up Cora', 'cora@example.test', { pieces: [{ lineNo: 1, qty: 1, size: 'S' }] }), '203.0.113.9');
  const cora = (await start(link.id, { responseIds: [own.id], together: false })).body;
  expect(cora.customer.name).toBe('Made-up Cora');
  expect((await start(link.id, { responseIds: [own.id], together: false })).body.customer.id).toBe(cora.customer.id);
  expect((await start(link.id, { responseIds: [own.id, ana.id], together: false })).body.code).toBe('ANSWER');
});

it('asks for the customer of a group with no customer on the link, and the right to make customers', async () => {
  const link = (await owner.post('/api/olk/links', { kind: 'group', title: 'Made-up Office polos', closesOn: '2026-10-10', items: [{ itemId: top, sizing: 'size' }] })).json();
  const one = (n: string, ip: string) => answer(link.token, { name: `Made-up ${n}`, gender: 'male', mobile: '09170000001', email: `${n}@example.test`, address: '12 Made-up St.',
    people: [{ row: 0, gender: 'male', pieces: [{ lineNo: 1, qty: 1, size: 'L' }] }] }, ip);
  const [a, b] = [await one('dan', '203.0.113.10'), await one('eli', '203.0.113.11')];
  expect((await start(link.id, { responseIds: [a.id, b.id], together: true })).body.code).toBe('CUSTOMER');
  const other = (await start(link.id, { responseIds: [a.id], together: true, customerId: '00000000-0000-4000-8000-000000000000' })).body;
  expect(other.code).toBe('CUSTOMER');
  const tv = await env.as('tv');
  expect((await tv.post(`/api/olk/links/${link.id}/job-order`, { responseIds: [a.id], together: true })).statusCode).toBe(403);
});
