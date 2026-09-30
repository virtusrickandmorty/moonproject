/**
 * The practice shop's made-up history closes everything the day it opens (every job order is released and paid, every
 * payroll released), so a trainee's first morning starts with nothing to pick on half the screens. This puts open work
 * into it, through the same routes staff use, so each "+ New" form has something to choose. All of it is made up.
 */
import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';

type Json = Record<string, any>;

export interface Signed {
  get(path: string): Promise<Json>;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Json>;
  close(): Promise<void>;
}

/**
 * Signs in through the API, as the browser does, and keeps the session cookie and the CSRF token. The cookie is Secure, which
 * the browser accepts from 127.0.0.1 and this client's own cookie jar does not, so it is sent by hand.
 */
export async function signInApi(baseURL: string, username: string, password: string): Promise<Signed> {
  const ctx: APIRequestContext = await playwrightRequest.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', { data: { username, password } });
  expect(login.ok(), `sign in as ${username}: ${await login.text()}`).toBe(true);
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const cookie = (login.headers()['set-cookie'] ?? '').split(';')[0]!;
  const check = async (what: string, r: Awaited<ReturnType<APIRequestContext['get']>>) => {
    expect(r.ok(), `${what} as ${username}: ${r.status()} ${await r.text()}`).toBe(true);
    return (await r.json()) as Json;
  };
  return {
    get: async (path) => check(`GET ${path}`, await ctx.get(path, { headers: { cookie } })),
    post: async (path, body, headers = {}) => check(`POST ${path}`, await ctx.post(path, { data: body as object, headers: { cookie, 'x-csrf-token': csrf, ...headers } })),
    close: () => ctx.dispose(),
  };
}

/** Previews a document, then records it with the total the preview gave, as the Record button does. */
async function record(who: Signed, type: string, input: object): Promise<Json> {
  const preview = await who.post(`/api/docs/${type}/preview`, { input });
  const errors = (preview.issues as { level: string; message: string }[]).filter((i) => i.level === 'error');
  expect(errors, `${type} preview`).toEqual([]);
  return who.post(`/api/docs/${type}/post`, { input, expectedTotalCents: preview.totalCents }, { 'idempotency-key': randomUUID() });
}

const jobLine = (description: string, qty: number) => ({ kind: 'made_to_order', description, qty, unitPriceCents: 100_000, discountCents: 0, roster: [] });

/** Open work for the owner's tour: what the "+ New" forms ask the person to pick. */
export async function openWork(owner: Signed, production: Signed, accountant: Signed): Promise<void> {
  const places = (await owner.get('/api/cash/places')) as unknown as { id: number; name: string }[];
  const till = places.find((p) => p.name === 'Practice counter till')!.id;
  const bank = places.find((p) => p.name === 'Practice bank')!.id;
  const [c1, c2, c3] = ((await owner.get('/api/cus/customers?q=Practice')) as unknown as { id: string }[]).map((c) => c.id);
  const sewer = ((await owner.get('/api/emp/employees')) as unknown as { id: string; costCentre: string }[]).find((e) => e.costCentre === 'production')!.id;
  const supplier = ((await owner.get('/api/pur/suppliers')) as unknown as { id: string; name: string }[]).find((s) => s.name === 'Practice Fabric Supplier')!.id;
  const supply = ((await owner.get('/api/pur/supplies')) as unknown as { id: string }[])[0]!.id;

  // A job order with a deposit, still in production: a release, a production entry, a refund, a forfeit, a deposit transfer.
  const inProduction = await record(owner, 'jo.job_order', { customerId: c1, dueInDays: 7, priority: 'normal', paymentTerms: 'dp50', lines: [jobLine('Tour polo shirts', 6)] });
  await record(owner, 'col.collection', { customerId: c1, crNumber: '880001', applications: [{ jobOrderId: inProduction.id, amountCents: 300_000 }], tenders: [{ cashPlaceId: till, amountCents: 300_000 }] });
  await production.post(`/api/prd/jobs/${inProduction.id}/lines/1/setup`, { templateId: 1, stepIds: [6, 8], garmentType: 'T-shirt', complexity: 'standard' });
  // A second one for the deposit to move to.
  await record(owner, 'jo.job_order', { customerId: c1, dueInDays: 7, priority: 'normal', paymentTerms: 'dp50', lines: [jobLine('Tour caps', 3)] });

  // A release with its invoice recorded and nothing collected (a 2307 for it), and one whose invoice is still to follow.
  const invoiced = await record(owner, 'jo.job_order', { customerId: c1, dueInDays: 7, priority: 'normal', paymentTerms: 'net7', lines: [jobLine('Tour aprons', 4)] });
  await owner.post('/api/jo/releases', {
    release: { jobOrderId: invoiced.id, lines: [{ lineNo: 1, qty: 4 }], claimedBy: 'Practice Collector', idSeen: 'other_id', creditNote: 'Paid in a week', creditDueInDays: 7, overrideReason: 'Made-up rush for the tour' },
    invoice: { invoiceNumber: '880101' }, expectedTotalCents: 400_000,
  }, { 'idempotency-key': randomUUID() });
  const toFollow = await record(owner, 'jo.job_order', { customerId: c3 ?? c2, dueInDays: 7, priority: 'normal', paymentTerms: 'net7', lines: [jobLine('Tour scarves', 2)] });
  await owner.post('/api/jo/releases', {
    release: { jobOrderId: toFollow.id, lines: [{ lineNo: 1, qty: 2 }], claimedBy: 'Practice Collector', idSeen: 'other_id', creditNote: 'Paid in a week', creditDueInDays: 7, overrideReason: 'Made-up rush for the tour' },
    invoice: null, expectedTotalCents: 200_000,
  }, { 'idempotency-key': randomUUID() });

  // A machine bought, for the disposal form to pick.
  const classes = (await owner.get('/api/fa/classes')) as unknown as { code: string }[];
  await record(owner, 'fa.buy', { classCode: classes[0]!.code, description: 'Practice sewing machine (made up)', supplierId: supplier, amountCents: 2_000_000, residualCents: 0, cashPlaceId: till, paidCents: 2_000_000 });

  // Money owed to and by the shop.
  await record(owner, 'ca.advance', { employeeId: sewer, cashPlaceId: till, amountCents: 200_000, installmentCents: 50_000, note: 'Made-up advance' });
  await record(owner, 'ap.advance', { supplierId: supplier, amountCents: 100_000, tenders: [{ cashPlaceId: till, amountCents: 100_000 }], ewtClass: 'none' });
  await record(owner, 'pur.po', { supplierId: supplier, lines: [{ supplyId: supply, qty: 10, unitCostCents: 5_000 }] });
  await record(owner, 'loan.loan', { lender: 'Practice Lender (made up)', kind: 'loan', cashPlaceId: bank, principalCents: 6_000_000, feeCents: 0, interestRateBp: 1_200, termMonths: 12, schedule: 'declining' });
  await owner.post('/api/eq/people', { name: 'Practice Stockholder', isStockholder: true, isOfficer: false });
  await owner.post('/api/eq/people', { name: 'Practice Officer', isStockholder: false, isOfficer: true, position: 'Treasurer' });

  // A payroll worked out and not yet paid out: the first period still to record that has people in it.
  for (const payGroup of ['SEMI_MONTHLY', 'WEEKLY_PIECE', 'SEMI_DAILY']) {
    const periods = (await accountant.get(`/api/pay/periods?payGroup=${payGroup}`)) as unknown as { periodStart: string; recorded: unknown; employees: number }[];
    const period = periods.find((p) => !p.recorded && p.employees > 0);
    if (period) return void (await record(accountant, 'pay.run', { payGroup, periodStart: period.periodStart }));
  }
}
