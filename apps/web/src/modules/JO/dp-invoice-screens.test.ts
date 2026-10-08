/**
 * The downpayment invoice screen (downpayment VAT mode C), the job order view's mode and downpayment invoices, the booklet
 * figures on the release and invoice record forms, and a job order made from a quotation: the form rules and texts, and each
 * screen's web client calls against the real server (in memory).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, cashPlaceId, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { addSettingVersion } from '../../../../server/src/engine/settings.ts';
import { tx } from '../../../../server/src/platform/db/driver.ts';
import { stamp, today } from '../../../../server/src/platform/clock.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { createApi, newIdempotencyKey as key, type JoStatus } from '../../api.ts';
import { FORMS, VIEWS } from '../screens.ts';
import { blank, blankLine, jobOrderPrefill, toInput } from '../QUO/quotation.ts';
import {
  collectionPreset, dpBooklet, dpInvoiceInput, dpSplit, dpStartCents, emptyRelease, invoiceBooklet, joActions, joInput, modeText, releaseInput, valuesFromQuotation,
} from './forms.ts';
import { Booklet } from './parts.tsx';
import { DepositVatLines } from './JobOrderView.tsx';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const status = (over: Partial<JoStatus> = {}, money: Partial<JoStatus['money']> = {}): JoStatus => ({
  jobOrder: { id: 'jo-1', number: 'JO-000001', docType: 'jo.job_order', status: 'posted', customerId: 'c-school', customerName: 'Moonlight Test School', dueDate: '2026-10-13' },
  stage: 'open',
  stageLabel: 'Open',
  money: { totalCents: 600_000, invoicedCents: 0, receivableCents: 0, depositsHeldCents: 0, balanceDueCents: 600_000, collectedCents: 0, requiredDownpaymentCents: 300_000, ...money },
  lines: [{ lineNo: 1, description: 'Team jersey set', qty: 4, releasedQty: 0, leftQty: 4 }],
  awaitingInvoice: [],
  depositVat: { mode: 'C', words: 'invoice on downpayment', setting: 'C', settingWords: 'invoice on downpayment', lockedBy: null, kept: null },
  dpInvoices: [],
  ...over,
});
const can = { collect: true, release: true, invoice: true, dpInvoice: true };

/** One shop: an owner, the school, and a job order of four jerseys at 1,500.00 with the 50% downpayment. */
async function shop(setMode?: 'B' | 'C') {
  const env = await createTestEnv();
  const ownerId = createUser(env.db, 'owner1', ['owner']);
  const c = seedCustomers(env.db, ownerId);
  const fetchIt = injectFetch(env.app);
  const api = createApi(fetchIt);
  await api.login('owner1', PASSWORD);
  const setting = (value: 'A' | 'B' | 'C') =>
    tx(env.db, () => addSettingVersion(env.db, { key: 'sales.deposit_vat_mode', effectiveFrom: today(env.clock), value, reason: 'Accountant decision for the test', userId: ownerId, at: stamp(env.clock), today: today(env.clock) }));
  if (setMode) setting(setMode);
  const typed = joInput({
    customer: { id: c.school, name: 'Moonlight Test School' }, contact: '', dueInDays: '15', priority: 'normal', paymentTerms: 'dp50', notes: '',
    lines: [{ itemId: '', kind: 'made_to_order', description: 'Team jersey set', qty: '4', price: '1,500.00', listCents: null, discount: '', roster: [] }],
  });
  const jo = await api.post('jo.job_order', typed.input, 600_000, key());
  return { env, api, fetchIt, c, jo, setting, cash: cashPlaceId(env.db, '1101') };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const collect = (s: Shop, cents: number, cr: string) =>
  s.api.post('col.collection', { customerId: s.c.school, crNumber: cr, applications: [{ jobOrderId: s.jo.id, amountCents: cents }], tenders: [{ cashPlaceId: s.cash, amountCents: cents }] }, cents, key());

const releaseAll = async (s: Shop, invoiceNumber: string | null) => {
  const st = await s.api.joStatus(s.jo.id);
  const rel = releaseInput({ ...emptyRelease(s.jo.id), qtys: { 1: '4' }, claimedBy: 'Coach Placeholder', idSeen: 'school_id', overrideReason: 'Needed for the tournament today',
    creditNote: 'Pays the rest on Friday', creditDueInDays: '7', invoiceToFollow: invoiceNumber === null, invoiceNumber: invoiceNumber ?? '' }, st.lines);
  return { rel, preview: await s.api.joReleasePreview(rel.release) };
};

describe('downpayment invoice form rules', () => {
  it('turns what was typed into the input; says what is missing in plain words', () => {
    const ok = dpInvoiceInput({ jobOrderId: 'jo-1', invoiceNumber: ' 0701 ', amount: '3,000.00', note: ' Booklet 7 ' });
    expect(ok).toEqual({ input: { jobOrderId: 'jo-1', invoiceNumber: '0701', amountCents: 300_000, note: 'Booklet 7' }, errors: [] });
    expect(dpInvoiceInput({ jobOrderId: '', invoiceNumber: 'A-7', amount: '', note: '' }).errors).toEqual([
      'Pick the job order by its number or customer.',
      'Type the invoice number from the booklet (digits only).',
      'Type the downpayment as an amount like 3,000.00',
    ]);
    expect(dpInvoiceInput({ jobOrderId: 'jo-1', invoiceNumber: '1', amount: '-5', note: '' }).errors).toEqual(['Type the downpayment as an amount like 3,000.00']);
  });

  it('starts at the downpayment asked less what is invoiced, never over what is left to invoice; splits the money held from what is left to collect', () => {
    expect(dpStartCents({ requiredDownpaymentCents: 300_000, dpInvoicedCents: 0, notInvoicedCents: 600_000 })).toBe(300_000);
    expect(dpStartCents({ requiredDownpaymentCents: 300_000, dpInvoicedCents: 100_000, notInvoicedCents: 500_000 })).toBe(200_000);
    expect(dpStartCents({ requiredDownpaymentCents: 300_000, dpInvoicedCents: 300_000, notInvoicedCents: 300_000 })).toBe(0);
    expect(dpStartCents({ requiredDownpaymentCents: 300_000, dpInvoicedCents: 0, notInvoicedCents: 120_000 })).toBe(120_000);
    expect(dpSplit(300_000, 100_000)).toEqual({ appliedCents: 100_000, leftToCollectCents: 200_000 });
    expect(dpSplit(300_000, 400_000).leftToCollectCents).toBe(0);
    expect(modeText({ mode: 'C', words: 'invoice on downpayment' })).toBe('Mode C: invoice on downpayment');
  });

  it('is registered as the form and view of jo.dp_invoice', () => {
    expect(FORMS['jo.dp_invoice']).toBeTypeOf('function');
    expect(VIEWS['jo.dp_invoice']!.extra).toBeTypeOf('function');
  });
});

describe("the job order view's mode and buttons", () => {
  it('"Take the downpayment" opens the downpayment invoice first in mode C, then the collection; other modes go straight to the collection', () => {
    const id = 'jo-1';
    expect(joActions(status(), can)[0]).toEqual({ label: 'Take the downpayment', to: `/docs/jo.dp_invoice/new?jo=${id}`, primary: true });
    // Invoiced already (recorded, not cancelled): the collection form opens.
    const invoiced = status({ dpInvoices: [{ id: 'dp-1', number: 'IR-000001', status: 'posted', invoiceNumber: '0701', amountCents: 300_000, vatCents: 32_143 }] });
    expect(joActions(invoiced, can)[0]!.to).toBe(`/docs/col.collection/new?jo=${id}&for=downpayment`);
    const cancelled = status({ dpInvoices: [{ id: 'dp-1', number: 'IR-000001', status: 'cancelled', invoiceNumber: '0701', amountCents: 300_000, vatCents: 32_143 }] });
    expect(joActions(cancelled, can)[0]!.to).toBe(`/docs/jo.dp_invoice/new?jo=${id}`);
    // Not allowed to invoice, or another mode: straight to the collection.
    expect(joActions(status(), { ...can, dpInvoice: false })[0]!.to).toBe(`/docs/col.collection/new?jo=${id}&for=downpayment`);
    for (const mode of ['A', 'B'] as const) {
      expect(joActions(status({ depositVat: { ...status().depositVat, mode } }), can)[0]!.to).toBe(`/docs/col.collection/new?jo=${id}&for=downpayment`);
    }
  });

  it('says the mode in words, which document fixed a mode other than the setting, and lists the downpayment invoices with their booklet numbers', () => {
    const plain = renderToStaticMarkup(createElement(DepositVatLines, { s: status() }));
    expect(plain).toContain('Downpayment VAT: <b class="text-slate-900">Mode C: invoice on downpayment</b>');
    expect(plain).not.toContain('Downpayment invoices');
    const kept = 'JO-000001 took its first downpayment on COL-000004 in mode B (VAT on deposit), so it stays in mode B although mode C (invoice on downpayment) is in force now. A job order never mixes the two.';
    const html = renderToStaticMarkup(createElement(DepositVatLines, {
      s: status({
        depositVat: { mode: 'B', words: 'VAT on deposit', setting: 'C', settingWords: 'invoice on downpayment', lockedBy: 'COL-000004', kept },
        dpInvoices: [
          { id: 'dp-1', number: 'IR-000001', status: 'posted', invoiceNumber: '0701', amountCents: 200_000, vatCents: 21_429 },
          { id: 'dp-2', number: 'IR-000002', status: 'cancelled', invoiceNumber: '0702', amountCents: 100_000, vatCents: 10_714 },
        ],
      }),
    }));
    for (const text of ['Mode B: VAT on deposit', kept, 'Downpayment invoices (₱2,000.00 invoiced)', 'Invoice no. 0701', 'IR-000001', '₱2,000.00', 'Invoice no. 0702', '(cancelled)']) expect(html).toContain(text);
    expect(html).toContain('href="/docs/jo.dp_invoice/dp-1"');
  });
});

describe('booklet figures on the release and invoice record forms', () => {
  it('mode C shows "Less downpayments invoiced" and the balance invoice; mode B says part of the VAT was booked on the deposits; other modes say neither', () => {
    const figures = { vatRateBp: 1200, listCents: 600_000, discountCents: 0, grossCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143 };
    const c = renderToStaticMarkup(createElement(Booklet, { b: { ...figures, downpaymentsInvoicedCents: 300_000, depositVatMode: 'C', depositVatCents: 0 }, depositAppliedCents: 0 }));
    for (const text of ['Less downpayments invoiced', '₱3,000.00', '₱6,000.00', '₱2,678.57', '₱321.43', 'Total']) expect(c).toContain(text);
    const b = renderToStaticMarkup(createElement(Booklet, { b: { ...figures, grossCents: 600_000, vatableSalesCents: 535_714, vatCents: 64_286, downpaymentsInvoicedCents: 0, depositVatMode: 'B', depositVatCents: 32_143 }, depositAppliedCents: 300_000 }));
    expect(b).toContain('₱321.43 of this VAT was already booked as output VAT on the deposits.');
    expect(b).toContain('Deposits applied: ₱3,000.00; left to collect: ₱3,000.00.');
    expect(b).not.toContain('Less downpayments invoiced');
    const a = renderToStaticMarkup(createElement(Booklet, { b: { ...figures, grossCents: 600_000, downpaymentsInvoicedCents: 0, depositVatMode: 'A', depositVatCents: 0 } }));
    expect(a).not.toContain('Less downpayments invoiced');
    expect(a).not.toContain('already booked');
    // The downpayment invoice's own booklet: the whole amount.
    expect(dpBooklet({ amountCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143, depositAppliedCents: 0, mode: 'C' })).toEqual({ grossCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143 });
  });

  it('an invoice record shows the booklet the server works out, not the whole sale', () => {
    expect(invoiceBooklet({
      vatRateBp: 1200, listCents: 600_000, discountCents: 0, dpAppliedCents: 300_000, depositVatMode: 'C', depositVatCents: 0,
      booklet: { grossCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143 },
    })).toEqual({ vatRateBp: 1200, listCents: 600_000, discountCents: 0, grossCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143, downpaymentsInvoicedCents: 300_000, depositVatMode: 'C', depositVatCents: 0 });
  });
});

describe('web client for the downpayment invoice (mode C)', () => {
  it('refuses a job order that is not in mode C in the server\'s words; in mode C: the invoice, its collection, then the release with the balance invoice', async () => {
    const s = await shop();
    // Mode A (the default): the server's own words, no invoice.
    const refused = await s.api.joDpInfo(s.jo.id);
    expect(refused.refusal).toBe('Downpayments are invoiced only in downpayment VAT mode C (invoice on downpayment). Mode A (deposit only) is in force: record the collection only.');
    expect((await s.api.joStatus(s.jo.id)).depositVat).toMatchObject({ mode: 'A', words: 'deposit only', kept: null });
    expect(joActions(await s.api.joStatus(s.jo.id), can)[0]!.to).toBe(`/docs/col.collection/new?jo=${s.jo.id}&for=downpayment`);

    // The accountant sets mode C: the job order has no downpayment yet, so it follows.
    s.setting('C');
    const info = await s.api.joDpInfo(s.jo.id);
    expect(info).toMatchObject({ refusal: null, requiredDownpaymentCents: 300_000, dpInvoicedCents: 0, notInvoicedCents: 600_000, depositsHeldCents: 0, jobOrder: { number: 'JO-000001', customerName: 'Moonlight Test School' } });
    let st = await s.api.joStatus(s.jo.id);
    expect(st.depositVat).toMatchObject({ mode: 'C', words: 'invoice on downpayment', setting: 'C', lockedBy: null, kept: null });
    expect(joActions(st, can)[0]).toEqual({ label: 'Take the downpayment', to: `/docs/jo.dp_invoice/new?jo=${s.jo.id}`, primary: true });
    expect((await s.api.joPickOrders('moonlight')).map((x) => x.number)).toEqual(['JO-000001']); // picked by customer, never by id

    // The form: the amount starts at the downpayment asked; the preview says what to write on the booklet.
    const typed = dpInvoiceInput({ jobOrderId: s.jo.id, invoiceNumber: '0701', amount: formatStart(info), note: '' });
    expect(typed.errors).toEqual([]);
    const pre = await s.api.preview('jo.dp_invoice', typed.input);
    expect(pre).toMatchObject({ totalCents: 300_000, issues: [], doc: { vatableSalesCents: 267_857, vatCents: 32_143, depositAppliedCents: 0, mode: 'C' } });
    expect(pre.summary).toContain('downpayment invoice no. 0701');
    // Over what is left to invoice, and a used booklet number: the server says so.
    expect((await s.api.preview('jo.dp_invoice', { ...typed.input, amountCents: 700_000 })).issues.map((i) => i.code)).toEqual(['OVER_ORDER']);
    const dp = await s.api.post('jo.dp_invoice', typed.input, pre.totalCents, key());
    expect(dp.number).toBe('IR-000001');
    expect((await s.api.preview('jo.dp_invoice', { ...typed.input, amountCents: 100 })).issues.map((i) => i.code)).toEqual(['INVOICE_USED']);

    // The view: the mode, the downpayment invoice with its booklet number; the button now goes to the collection.
    st = await s.api.joStatus(s.jo.id);
    expect(st.dpInvoices).toEqual([{ id: dp.id, number: 'IR-000001', status: 'posted', invoiceNumber: '0701', amountCents: 300_000, vatCents: 32_143 }]);
    expect(joActions(st, can)[0]!.to).toBe(`/docs/col.collection/new?jo=${s.jo.id}&for=downpayment`);
    expect(dpStartCents(await s.api.joDpInfo(s.jo.id))).toBe(0);

    // Its collection, then the release with the balance invoice: the booklet shows the sale less the downpayment.
    const preset = collectionPreset(st, true);
    expect(preset.cents).toBe(300_000);
    await collect(s, preset.cents, '0801');
    const { rel, preview } = await releaseAll(s, '0702');
    expect(preview.booklet).toMatchObject({ downpaymentsInvoicedCents: 300_000, grossCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143, depositVatMode: 'C' });
    expect(preview.release.issues).toEqual([]);
    const out = await s.api.joRelease({ release: rel.release, invoice: rel.invoice }, preview.release.totalCents, key());
    expect(out.invoiceRecord!.number).toBe('IR-000002');
    // The invoice record's stored figures give the same booklet.
    const stored = await s.api.get('jo.invoice_record', out.invoiceRecord!.id);
    expect(invoiceBooklet(stored.doc as never)).toMatchObject({ downpaymentsInvoicedCents: 300_000, grossCents: 300_000, vatableSalesCents: 267_857, vatCents: 32_143 });
    // The rest paid: balance due zero.
    await collect(s, 300_000, '0802');
    expect((await s.api.joStatus(s.jo.id)).money).toMatchObject({ balanceDueCents: 0, receivableCents: 0, depositsHeldCents: 0 });
  });

  it('money already held is applied to the downpayment invoice, and only the rest is left to collect', async () => {
    const s = await shop();
    await collect(s, 100_000, '0801'); // taken in mode A before the setting changed... the job order is then locked to A
    expect((await s.api.joDpInfo(s.jo.id)).refusal).toContain('took its first downpayment on COL-000001 in mode A (deposit only)');
    const fresh = await shop('C');
    await collect(fresh, 100_000, '0801'); // mode C: money received before the invoice is held for the job order
    const info = await fresh.api.joDpInfo(fresh.jo.id);
    expect(info).toMatchObject({ refusal: null, depositsHeldCents: 100_000 });
    const pre = await fresh.api.preview('jo.dp_invoice', dpInvoiceInput({ jobOrderId: fresh.jo.id, invoiceNumber: '0701', amount: '3,000.00', note: '' }).input);
    expect(pre.doc).toMatchObject({ depositAppliedCents: 100_000 });
    expect(dpSplit(300_000, (pre.doc as { depositAppliedCents: number }).depositAppliedCents)).toEqual({ appliedCents: 100_000, leftToCollectCents: 200_000 });
    expect(pre.issues).toEqual([]);
  });

  it('a job order that keeps mode B says which document fixed it; the release and invoice record show the VAT already booked on the deposits', async () => {
    const s = await shop('B');
    const first = await collect(s, 300_000, '0801');
    s.setting('C'); // the setting moves on the same day; the job order keeps the mode of its first downpayment
    const st = await s.api.joStatus(s.jo.id);
    expect(st.depositVat).toMatchObject({ mode: 'B', setting: 'C', lockedBy: first.number });
    expect(st.depositVat.kept).toBe(`JO-000001 took its first downpayment on ${first.number} in mode B (VAT on deposit), so it stays in mode B although mode C (invoice on downpayment) is in force now. A job order never mixes the two.`);
    expect((await s.api.joDpInfo(s.jo.id)).refusal).toBe(`JO-000001 took its first downpayment on ${first.number} in mode B (VAT on deposit), and a job order never mixes modes: its downpayments are not invoiced. Record the collection only.`);
    expect(joActions(st, can).some((a) => a.to.includes('jo.dp_invoice'))).toBe(false); // no downpayment invoice on a job order that keeps mode B
    const { rel, preview } = await releaseAll(s, null);
    expect(preview.booklet).toMatchObject({ depositVatMode: 'B', depositVatCents: 32_143, downpaymentsInvoicedCents: 0, grossCents: 600_000 });
    expect(renderToStaticMarkup(createElement(Booklet, { b: preview.booklet, depositAppliedCents: preview.depositAppliedCents }))).toContain('₱321.43 of this VAT was already booked as output VAT on the deposits.');
    const out = await s.api.joRelease({ release: rel.release, invoice: null }, preview.release.totalCents, key());
    const info = await s.api.joReleaseInfo(out.release.id);
    expect(info.booklet).toMatchObject({ depositVatMode: 'B', depositVatCents: 32_143 });
    const ip = await s.api.preview('jo.invoice_record', { releaseId: out.release.id, invoiceNumber: '0901' });
    expect(invoiceBooklet(ip.doc as never)).toMatchObject({ depositVatMode: 'B', depositVatCents: 32_143, downpaymentsInvoicedCents: 0 });
  });
});

/** The text in the amount box when the job order is picked: the amount to start with. */
const formatStart = (info: Parameters<typeof dpStartCents>[0]) => (dpStartCents(info) / 100).toFixed(2);

describe('a job order from a quotation', () => {
  it('fills the customer, lines, quantities, prices and the quotation number; terms start at 50% downpayment and staff may change anything', async () => {
    const s = await shop();
    const { csrfToken } = await s.api.me();
    const send = async (url: string, body: unknown, ifMatch?: string) =>
      (await s.fetchIt(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...(ifMatch ? { 'if-match': ifMatch } : {}) }, body: JSON.stringify(body) })).json() as Promise<{ id: string }>;
    const item = await send('/api/cat/items', { code: 'JER-01', name: 'Team jersey set', class: 'made_to_order_garment', garmentType: 'jersey', unit: 'pc', setComponents: 1 });
    await send(`/api/cat/items/${item.id}/prices`, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 150_000 }, '1');
    const quoted = toInput({ ...blank(), customerId: s.c.school, notes: 'Rush for the regatta', lines: [{ ...blankLine(), itemId: item.id, description: 'Team jersey set', qty: 4 }] });
    const q = await s.api.post('quo.quotation', quoted, 600_000, key());
    const detail = await s.api.get('quo.quotation', q.id);

    const prefill = jobOrderPrefill(detail, { [item.id]: 'made_to_order_garment' })!;
    const values = valuesFromQuotation(prefill, (detail.doc as { customerName: string }).customerName);
    expect(values).toMatchObject({
      customer: { id: s.c.school, name: 'Moonlight Test School' }, paymentTerms: 'dp50', notes: `From quotation ${detail.header.number}. Rush for the regatta`,
      lines: [{ kind: 'made_to_order', description: 'Team jersey set', qty: '4', price: '1,500.00', discount: '' }],
    });
    // The payment terms start at 50% downpayment (the owner's request, Oct 2026); staff may change them.
    expect(joInput(values).errors).toEqual([]);
    // Staff change a price and add a line; the rest stays as quoted.
    const changed = { ...values, paymentTerms: 'dp50' as const, lines: [{ ...values.lines[0]!, price: '1,400.00' }, { ...values.lines[0]!, description: 'Carry bag', qty: '4', price: '250.00' }] };
    const typed = joInput(changed);
    expect(typed.errors).toEqual([]);
    expect(typed.input).toMatchObject({ customerId: s.c.school, notes: 'From quotation QUO-000001. Rush for the regatta', lines: [{ qty: 4, unitPriceCents: 140_000 }, { description: 'Carry bag', qty: 4, unitPriceCents: 25_000 }] });
    // As quoted, the job order comes to the quoted total.
    const asQuoted = joInput({ ...values, paymentTerms: 'dp50' });
    const pre = await s.api.preview('jo.job_order', asQuoted.input);
    expect([pre.totalCents, pre.issues]).toEqual([600_000, []]);
    const jo = await s.api.post('jo.job_order', asQuoted.input, pre.totalCents, key());
    expect((await s.api.get('jo.job_order', jo.id)).input).toMatchObject({ notes: 'From quotation QUO-000001. Rush for the regatta' });
  });
});
