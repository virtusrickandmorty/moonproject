/**
 * The job order, release slip and invoice record forms (PLAN E4, D3): their form rules, the job order view's buttons, and
 * each form's web client calls against the real server (in memory): the input each sends fills from the server's
 * preview, the body is what the server takes, and the server's refusals reach staff in plain words.
 */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { ApiError, createApi, newIdempotencyKey as key, type JoStatus } from '../../api.ts';
import { FORMS, VIEWS } from '../screens.ts';
import {
  allLeft, collectionPreset, emptyJo, emptyJoLine, emptyRelease, fromWearer, invoiceInput, joActions, joInput, joValues, lineQty, oneOff, priceChanged, releaseInput,
  type JoInput, type JoValues,
} from './forms.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const typedJo = (over: Partial<JoValues> = {}): JoValues => ({
  ...emptyJo(),
  customer: { id: 'c-school', name: 'Moonlight Test School' },
  paymentTerms: 'dp50',
  lines: [
    {
      ...emptyJoLine(),
      description: 'Team jersey set',
      qty: '99', // the roster's pieces win
      price: '1,500.00',
      listCents: 150_000,
      roster: [
        { personId: 'p-ari', name: 'Ari Sample', sizeMode: 'preset', size: 'l', jerseyName: 'ari', jerseyNumber: '7', qty: '1' },
        { personId: 'p-bea', name: 'Bea Example', sizeMode: 'measured', size: '', jerseyName: '', jerseyNumber: '', qty: '1' },
        { ...oneOff(' Coach Guest '), size: 'XL', qty: '2' },
      ],
    },
    emptyJoLine(),
  ],
  ...over,
});

const status = (over: Partial<JoStatus> = {}, money: Partial<JoStatus['money']> = {}): JoStatus => ({
  jobOrder: { id: 'jo-1', number: 'JO-000001', docType: 'jo.job_order', status: 'posted', customerId: 'c-school', customerName: 'Moonlight Test School', dueDate: '2026-10-13' },
  stage: 'open',
  stageLabel: 'Open',
  money: { totalCents: 600_000, invoicedCents: 0, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 600_000, collectedCents: 0, requiredDownpaymentCents: 300_000, ...money },
  lines: [{ lineNo: 1, description: 'Team jersey set', qty: 4, releasedQty: 0, leftQty: 4 }],
  awaitingInvoice: [],
  depositVat: { mode: 'A', words: 'deposit only', setting: 'A', settingWords: 'deposit only', lockedBy: null, kept: null },
  dpInvoices: [],
  ...over,
});

describe('job order form rules', () => {
  it('turns what was typed into the input: the roster sets the pieces, sizes and jersey names upper-case, blank lines left out', () => {
    const { input, totalCents, errors } = joInput(typedJo());
    expect(errors).toEqual([]);
    expect(input).toEqual({
      customerId: 'c-school',
      dueInDays: 15,
      priority: 'normal',
      paymentTerms: 'dp50',
      lines: [{
        kind: 'made_to_order', description: 'Team jersey set', qty: 4, unitPriceCents: 150_000, discountCents: 0,
        roster: [
          { personId: 'p-ari', sizeMode: 'preset', size: 'L', jerseyName: 'ARI', jerseyNumber: '7', qty: 1 },
          { personId: 'p-bea', sizeMode: 'measured', qty: 1 },
          { name: 'Coach Guest', sizeMode: 'preset', size: 'XL', qty: 2 },
        ],
      }],
    });
    expect(totalCents).toBe(600_000);
    // An edit starts from what was recorded, with the wearers' names kept beside the input.
    const doc = { customerName: 'Moonlight Test School', lines: [{ roster: [{ wearerName: 'Ari Sample' }, { wearerName: 'Bea Example' }, { wearerName: 'Coach Guest' }] }] };
    expect(joInput(joValues(input, doc)).input).toEqual(input);
    expect(joValues(input, doc).lines[0]!.roster.map((r) => r.name)).toEqual(['Ari Sample', 'Bea Example', 'Coach Guest']);
  });

  it('says what is missing in plain words', () => {
    expect(joInput({ ...emptyJo(), dueInDays: '0' }).errors).toEqual(['Pick the customer.', 'Due in: type the number of days, 1 to 365.', 'Pick the payment terms.', 'Add at least one line.']);
    const bad = typedJo({ lines: [{ ...emptyJoLine(), description: '', qty: '0', price: 'abc', roster: [] }, { ...emptyJoLine(), description: 'Shorts', roster: [oneOff(), { ...oneOff('Dee'), qty: 'x' }] }] });
    expect(joInput(bad).errors).toEqual([
      'Line 1: pick an item from the price list or say what is made.',
      'Line 1: the quantity must be a whole number like 1 or 20.',
      'Line 1: type amounts like 450.00',
      'Line 2, row 1: pick a wearer or type a name.',
      'Line 2, row 1: pick a size.',
      'Line 2, Dee: the quantity must be a whole number like 1 or 2.',
      'Line 2, Dee: pick a size.',
    ]);
  });

  it('fills a picked wearer with the size on file; tells a price changed from the price list', () => {
    expect(fromWearer({ personId: 'p', wearerName: 'Bea', groupId: null, sizeMode: 'preset', size: 'M', jerseyName: 'BEA' })).toEqual({ personId: 'p', name: 'Bea', sizeMode: 'preset', size: 'M', jerseyName: 'BEA', jerseyNumber: '', qty: '1' });
    const line = { ...emptyJoLine(), qty: '12', price: '1,400.00', listCents: 140_000 };
    expect([lineQty(line), priceChanged(line), priceChanged({ ...line, price: '1,350' }), priceChanged({ ...line, listCents: null })]).toEqual(['12', false, true, false]);
  });
});

describe('release slip and invoice record form rules', () => {
  const left = [{ lineNo: 1, description: 'Jersey', qty: 10, releasedQty: 4, leftQty: 6 }, { lineNo: 2, description: 'Shorts', qty: 5, releasedQty: 5, leftQty: 0 }];

  it('releases only what is left; the invoice is recorded with it unless it is to follow', () => {
    expect(allLeft(left)).toEqual({ 1: '6' });
    const v = { ...emptyRelease('jo-1'), qtys: allLeft(left), claimedBy: ' Coach Placeholder ', idSeen: 'school_id' as const, invoiceNumber: ' 0501 ' };
    expect(releaseInput(v, left)).toEqual({
      release: { jobOrderId: 'jo-1', lines: [{ lineNo: 1, qty: 6 }], claimedBy: 'Coach Placeholder', idSeen: 'school_id' },
      invoice: { invoiceNumber: '0501' },
      errors: [],
      releaseErrors: [],
    });
    const later = releaseInput({ ...v, invoiceToFollow: true, invoiceNumber: '', creditNote: 'Pays on Friday', creditDueInDays: '7', overrideReason: 'Needed for the game today' }, left);
    expect(later.invoice).toBeNull();
    expect(later.release).toMatchObject({ creditNote: 'Pays on Friday', creditDueInDays: 7, overrideReason: 'Needed for the game today' });
  });

  it('says what is wrong in plain words', () => {
    expect(releaseInput(emptyRelease(), left).errors).toEqual(['Pick the job order.', 'Type who claimed it.', 'Pick the ID seen.', 'Type the invoice number from the booklet (digits only), or tick "Invoice to follow".']);
    const over = releaseInput({ ...emptyRelease('jo-1'), qtys: { 1: '7', 2: '1' }, claimedBy: 'A', idSeen: 'none', creditDueInDays: '400', invoiceToFollow: true }, left);
    expect(over.errors).toEqual(['Line 1: only 6 of 10 pieces are left to release.', 'Line 2 is already fully released.', 'Pay within: type the number of days, 1 to 365.']);
    expect(releaseInput({ ...emptyRelease('jo-1'), claimedBy: 'A', idSeen: 'none', invoiceToFollow: true }, left).errors).toEqual(['Tick the lines and pieces going out.']);
    expect(invoiceInput({ releaseId: '', invoiceNumber: 'no. 5', note: '' }).errors).toEqual(['Pick the release by its number.', 'Type the invoice number from the booklet (digits only).']);
    expect(invoiceInput({ releaseId: 'r-1', invoiceNumber: ' 0502 ', note: ' Booklet 3 ' })).toEqual({ input: { releaseId: 'r-1', invoiceNumber: '0502', note: 'Booklet 3' }, errors: [] });
  });
});

describe("the job order view's buttons", () => {
  const all = { collect: true, release: true, invoice: true };

  it('open the payment, release and invoice record forms already filled for this job order', () => {
    expect(joActions(status(), all)).toEqual([
      { label: 'Take the downpayment', to: '/docs/col.collection/new?jo=jo-1&for=downpayment', primary: true },
      { label: 'Take a payment', to: '/docs/col.collection/new?jo=jo-1' },
      { label: 'Release', to: '/docs/jo.release/new?jo=jo-1' },
    ]);
    const paid = status({ lines: [{ lineNo: 1, description: 'Jersey', qty: 4, releasedQty: 4, leftQty: 0 }], awaitingInvoice: [{ id: 'rel-1', number: 'REL-000001', businessDate: '2026-09-28', totalCents: 600_000 }] }, { balanceDueCents: 0, collectedCents: 600_000 });
    expect(joActions(paid, all)).toEqual([{ label: 'Record invoice', to: '/docs/jo.invoice_record/new?release=rel-1' }]);
    const two = { ...paid, awaitingInvoice: [...paid.awaitingInvoice, { id: 'rel-2', number: 'REL-000002', businessDate: '2026-09-28', totalCents: 1 }] };
    expect(joActions(two, all).map((a) => a.to)).toEqual(['/docs/jo.invoice_record/new?jo=jo-1']);
    expect(joActions(status(), { collect: false, release: true, invoice: false }).map((a) => a.label)).toEqual(['Release']);
    expect(joActions(status({ jobOrder: { ...status().jobOrder, status: 'cancelled' } }), all)).toEqual([]);
  });

  it('the collection form starts with the downpayment still asked, or the balance due', () => {
    expect(collectionPreset(status(), true)).toEqual({ customer: { id: 'c-school', name: 'Moonlight Test School' }, key: 'jo:jo-1', cents: 300_000 });
    expect(collectionPreset(status({}, { collectedCents: 100_000, balanceDueCents: 500_000 }), true).cents).toBe(200_000);
    expect(collectionPreset(status({}, { collectedCents: 300_000, balanceDueCents: 300_000 }), true).cents).toBe(300_000); // downpayment in: the balance
    expect(collectionPreset(status(), false).cents).toBe(600_000);
  });

  it('each document has its own screen', () => {
    expect([FORMS['jo.job_order'], FORMS['jo.release'], FORMS['jo.invoice_record']].every(Boolean)).toBe(true);
    expect(VIEWS['jo.release']?.noEdit).toBe(true);
  });
});

describe('web client for job orders, releases and invoice records', () => {
  it('a job order from the price list with its roster, the downpayment, a release with its invoice to follow, then the invoice record', async () => {
    const env = await createTestEnv();
    const ownerId = createUser(env.db, 'owner1', ['owner']);
    createUser(env.db, 'enc1', ['encoder']);
    const c = seedCustomers(env.db, ownerId);
    const jar = { cookie: '' };
    const fetchIt = injectFetch(env.app, jar);
    const api = createApi(fetchIt);
    await api.login('owner1', PASSWORD);
    const CASH = cashPlaceId(env.db, '1101');

    // The price list: one item with a 10-piece tier (as the catalog screen sets it up).
    const { csrfToken } = await api.me();
    const send = async (url: string, body: unknown, ifMatch?: string) =>
      (await fetchIt(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...(ifMatch ? { 'if-match': ifMatch } : {}) }, body: JSON.stringify(body) })).json() as Promise<{ id: string; version: number }>;
    const item = await send('/api/cat/items', { code: 'JER-01', name: 'Team jersey set', class: 'made_to_order_garment', garmentType: 'jersey', unit: 'pc', setComponents: 1 });
    await send(`/api/cat/items/${item.id}/prices`, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 160_000 }, '1');
    await send(`/api/cat/items/${item.id}/prices`, { effectiveFrom: '2026-09-28', minQty: 4, unitPriceCents: 150_000 }, '2');
    expect((await api.catItems('jersey')).map((i) => [i.name, i.class])).toEqual([['Team jersey set', 'made_to_order_garment']]);
    expect([(await api.catPrice(item.id, 1)).unitPriceCents, (await api.catPrice(item.id, 4)).unitPriceCents]).toEqual([160_000, 150_000]);

    // The customer's wearers with the size on file: Bea has a preset M chart; the others have none.
    const people = await api.joWearers(c.school);
    expect(people.groups.map((g) => g.name)).toEqual(['Chess Team']);
    expect(people.wearers.map((w) => [w.wearerName, w.sizeMode, w.size ?? '', w.jerseyName ?? ''])).toEqual([['Ari Sample', 'preset', '', 'ARI'], ['Bea Example', 'preset', 'M', ''], ['Cy Placeholder', 'preset', '', '']]);

    // The form: pull the Chess Team, a size for Ari, a one-off name; the tier price for 3 pieces.
    const team = people.wearers.filter((w) => w.groupId === c.team).map(fromWearer);
    const roster = [{ ...team[0]!, size: 'L', jerseyNumber: '7' }, team[1]!, { ...oneOff('Coach Guest'), size: 'XL', qty: '2' }];
    const line = { ...emptyJoLine(), itemId: item.id, description: 'Team jersey set', roster, price: '1,500.00', listCents: (await api.catPrice(item.id, 4)).unitPriceCents };
    const typed = joInput({ ...emptyJo(), customer: { id: c.school, name: 'Moonlight Test School' }, paymentTerms: 'dp50', lines: [line] });
    expect(typed.errors).toEqual([]);
    const pre = await api.preview('jo.job_order', typed.input);
    expect(pre).toMatchObject({ totalCents: 600_000, issues: [], doc: { requiredDownpaymentCents: 300_000, dueDate: '2026-10-13' } });
    expect(pre.summary).toContain('Downpayment asked: ₱3,000.00');
    // A wrong roster comes back as the server's words.
    const noSize = await api.preview('jo.job_order', { ...typed.input, lines: [{ ...typed.input.lines[0]!, roster: [{ name: 'Walk-in Wearer', sizeMode: 'preset', qty: 4 }] }] });
    expect(noSize.issues.map((i) => i.message)).toEqual(['Line 1, row 1: pick a size.']);
    const jo = await api.post('jo.job_order', typed.input, pre.totalCents, key());
    expect(jo.number).toBe('JO-000001');
    const stored = await api.get('jo.job_order', jo.id);
    expect(joInput(joValues(stored.input as unknown as JoInput, stored.doc as never)).input).toEqual(typed.input); // its Edit starts from this

    // The view's buttons, then "Take the downpayment": the collection for this job order.
    let s = await api.joStatus(jo.id);
    expect(s.jobOrder).toMatchObject({ number: 'JO-000001', customerName: 'Moonlight Test School' });
    expect(joActions(s, { collect: true, release: true, invoice: true }).map((a) => a.label)).toEqual(['Take the downpayment', 'Take a payment', 'Release']);
    const dp = collectionPreset(s, true);
    await api.post('col.collection', { customerId: dp.customer.id, crNumber: '0801', applications: [{ jobOrderId: jo.id, amountCents: dp.cents }], tenders: [{ cashPlaceId: CASH, amountCents: dp.cents }] }, dp.cents, key());
    s = await api.joStatus(jo.id);
    expect(s.money).toMatchObject({ collectedCents: 300_000, balanceDueCents: 300_000, depositsHeldCents: 300_000 });
    expect(joActions(s, { collect: true, release: true, invoice: true }).map((a) => a.label)).toEqual(['Take a payment', 'Release']);

    // The release form: pick the job order by customer; everything left ticked.
    expect((await api.joPickOrders('moonlight')).map((x) => [x.number, x.stageLabel, x.leftPieces, x.balanceDueCents])).toEqual([['JO-000001', 'Open', 4, 300_000]]);
    const rv = { ...emptyRelease(jo.id), qtys: allLeft(s.lines), claimedBy: 'Coach Placeholder', idSeen: 'school_id' as const, invoiceToFollow: true };
    let rel = releaseInput(rv, s.lines);
    // Not ready yet and a balance still due: the server says so plainly.
    let rp = await api.joReleasePreview(rel.release);
    expect(rp.release.issues.map((i) => i.code)).toEqual(['NOT_READY', 'CREDIT_NOTE']);
    expect(rp.release.issues[0]!.message).toBe('JO-000001 is Open. Mark it Ready for release first, or ask the owner to release it anyway with a reason.');
    expect(rp.release.issues[1]!.message).toBe('₱3,000.00 is still due on JO-000001. Write why it goes out before it is paid, and when it will be paid.');
    rel = releaseInput({ ...rv, overrideReason: 'Needed for the tournament today', creditNote: 'Pays the rest on Friday', creditDueInDays: '7' }, s.lines);
    rp = await api.joReleasePreview(rel.release);
    expect(rp).toMatchObject({ release: { totalCents: 600_000, issues: [], doc: { balanceDueCents: 300_000 } }, booklet: { grossCents: 600_000, vatableSalesCents: 535_714, vatCents: 64_286 }, depositAppliedCents: 300_000 });
    // An encoder may not release it before it is ready (the owner's); unpaid is fine, as for the accountant (6 Oct 2026).
    const enc = createApi(injectFetch(env.app));
    await enc.login('enc1', PASSWORD);
    expect((await enc.joReleasePreview(rel.release)).release.issues.map((i) => i.message)).toEqual([
      'Only the owner can release a job order that is not ready yet.',
    ]);
    const out = await api.joRelease({ release: rel.release, invoice: rel.invoice }, rp.release.totalCents, key());
    expect([out.release.number, out.invoiceRecord]).toEqual(['REL-000001', null]);
    s = await api.joStatus(jo.id);
    expect(joActions(s, { collect: true, release: true, invoice: true })).toEqual([
      { label: 'Take a payment', to: `/docs/col.collection/new?jo=${jo.id}` },
      { label: 'Record invoice', to: `/docs/jo.invoice_record/new?release=${out.release.id}` },
    ]);

    // The invoice record form: the release by its number, what to write on the booklet, the invoice number.
    expect((await api.joPickReleases('')).map((r) => [r.number, r.invoice])).toEqual([['REL-000001', null]]);
    const info = await api.joReleaseInfo(out.release.id);
    expect(info).toMatchObject({ release: { number: 'REL-000001', jobOrderNumber: 'JO-000001', invoice: null }, booklet: { grossCents: 600_000, vatCents: 64_286 }, depositAppliedCents: 300_000 });
    const inv = invoiceInput({ releaseId: info.release.id, invoiceNumber: '0501', note: '' });
    const ip = await api.preview('jo.invoice_record', inv.input);
    expect(ip).toMatchObject({ totalCents: 600_000, issues: [], doc: { grossCents: 600_000, vatableSalesCents: 535_714, vatCents: 64_286, depositAppliedCents: 300_000 } });
    const ir = await api.post('jo.invoice_record', inv.input, ip.totalCents, key());
    expect(ir.number).toBe('IR-000001');

    // It says plainly when the release already has its invoice, and when a booklet number was used.
    expect((await api.joPickReleases('REL-000001'))[0]!.invoice).toEqual({ id: ir.id, number: 'IR-000001', invoiceNumber: '0501' });
    expect((await api.joPickReleases('')).length).toBe(0);
    const again = await api.preview('jo.invoice_record', { ...inv.input, invoiceNumber: '0502' });
    expect(again.issues.map((i) => i.message)).toEqual(['REL-000001 already has invoice no. 0501 (IR-000001). Cancel that one first to record another.']);
    const e = await api.post('jo.invoice_record', { ...inv.input, invoiceNumber: '0502' }, 600_000, key()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).message).toContain('already has invoice no. 0501');

    // The rest paid: the balance due is zero.
    const rest = collectionPreset(await api.joStatus(jo.id), false);
    expect(rest.cents).toBe(300_000);
    await api.post('col.collection', { customerId: c.school, crNumber: '0802', applications: [{ jobOrderId: jo.id, amountCents: rest.cents }], tenders: [{ cashPlaceId: CASH, amountCents: rest.cents }] }, rest.cents, key());
    expect((await api.joStatus(jo.id)).money).toMatchObject({ balanceDueCents: 0, receivableCents: 0, depositsHeldCents: 0 });
  });
});
