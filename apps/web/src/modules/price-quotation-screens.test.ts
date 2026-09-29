/**
 * The Price list and Quotation screens: the menu and registration, and the calls each screen makes against the real
 * server (in memory), so what the screens send is what the routes and the strict quotation input take.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser, type TestEnv } from '../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../server/src/engine/security/sessions.ts';
import { jobOrderInput } from '../../../server/src/modules/JO/doctypes/job-order.ts';
import { createApi, newIdempotencyKey as key, type DocDetail, type DocTypeInfo, type Me } from '../api.ts';
import { DocList } from '../generic/DocList.tsx';
import { buildMenu } from '../shell/menu.ts';
import { FORMS, PAGES, VIEWS } from './screens.ts';
import { Catalog, ItemEditor } from './CAT/Catalog.tsx';
import { masterRequest } from './CUS/http.ts';
import { blankItem, catalogCalls, itemBody, moneyCents, typeLocked, valuesOf } from './CAT/catalog.ts';
import { QuotationForm } from './QUO/QuotationForm.tsx';
import { itemClasses, quotationView } from './QUO/QuotationView.tsx';
import { JOB_ORDER_LATER, blank, isExpired, isReady, jobOrderPrefill, jobOrderTarget, toInput, valuesOfInput, type Form } from './QUO/quotation.ts';

const jar = { cookie: '' };
const injectFetch = (app: FastifyInstance, cookies = jar) => async (url: string, init: RequestInit = {}) => {
  const res = await app.inject({ method: (init.method ?? 'GET') as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: cookies.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) cookies.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};
const html = <P extends object>(component: FunctionComponent<P>, props: P) => renderToStaticMarkup(createElement(component, props));
const menuOf = (permissions: string[], docTypes: DocTypeInfo[] = []) =>
  buildMenu(docTypes, new Set(permissions)).find((g) => g.group === 'Sales')?.items.map((i) => `${i.label} ${i.path}`) ?? [];
const quoType = { key: 'quo.quotation', module: 'QUO', title: 'Quotation', dating: 'system', canCreate: true, canPost: true, canCancel: true, inputJsonSchema: {} } as DocTypeInfo;

let env: TestEnv;
/** Signs in as a new user with these roles; the screens' own `fetch` (masterRequest, the item list) then goes to the same server as this user. */
async function signIn(name: string, roles: Parameters<typeof createUser>[2]) {
  createUser(env.db, name, roles);
  const cookies = { cookie: '' };
  const api = createApi(injectFetch(env.app, cookies));
  await api.login(name, PASSWORD);
  const me = await api.me();
  vi.stubGlobal('fetch', injectFetch(env.app, cookies));
  return { api, me };
}
beforeEach(async () => { env = await createTestEnv(); });
afterEach(async () => { vi.unstubAllGlobals(); await env.app.close(); env.db.close(); });

describe('menu and registration', () => {
  it('shows Price list under Sales only with cat.view, and the Quotations list from the document types', () => {
    expect(menuOf(['cat.view'])).toContain('Price list /cat');
    expect(menuOf([])).not.toContain('Price list /cat');
    expect(menuOf(['cat.manage', 'cat.price.manage'])).not.toContain('Price list /cat'); // seeing is cat.view
    expect(menuOf([], [quoType])).toContain('Quotations /docs/quo.quotation');
  });

  it('registers the price list page, the quotation form and the quotation view', () => {
    expect(PAGES['/cat']).toBe(Catalog);
    expect(FORMS['quo.quotation']).toBe(QuotationForm);
    expect(VIEWS['quo.quotation']).toBeDefined();
  });
});

describe('Price list against the routes', () => {
  it('refuses a user without cat.view, in words', () => {
    const me = { userId: 'u', username: 'u', displayName: 'U', roles: [], permissions: [], mustChangePassword: false, csrfToken: '' } satisfies Me;
    expect(html(Catalog, { me })).toContain('do not have permission to see the price list');
  });

  it('creates, finds, prices, edits and deactivates an item; every refusal is the server\'s own plain message', async () => {
    const { me } = await signIn('owner-1', ['owner']);
    const calls = catalogCalls(me);
    const values = { ...blankItem(), code: 'FAKE-POLO', name: 'Sample polo shirt', garmentType: 'Polo' };
    expect(itemBody(values)).toEqual({ code: 'FAKE-POLO', name: 'Sample polo shirt', class: 'made_to_order_garment', garmentType: 'Polo', unit: 'pc', setComponents: 1 });
    const item = await calls.create(values);
    expect(item).toMatchObject({ code: 'FAKE-POLO', version: 1, is_active: 1 });
    await expect(calls.create(values)).rejects.toThrow('This catalog code is already in use.');
    expect((await calls.list('polo', 0)).map((r) => r.name)).toEqual(['Sample polo shirt']);
    expect(await calls.list('nothing like it', 0)).toEqual([]);

    // A price starts today or later, from the item's current version; the page shows the newest first.
    await calls.addPrice(item, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: moneyCents('450')! });
    const priced = await calls.open(item.id);
    expect(priced.prices).toMatchObject([{ effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 45_000 }]);
    expect(priced.version).toBe(2);
    await expect(calls.addPrice(priced, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 50_000 })).rejects.toThrow('A price already exists for that date and quantity tier.');
    await expect(calls.addPrice(priced, { effectiveFrom: '2026-09-01', minQty: 5, unitPriceCents: 40_000 })).rejects.toThrow('Choose today or a future date for a new price.');
    await expect(calls.addPrice(item, { effectiveFrom: '2026-10-01', minQty: 5, unitPriceCents: 40_000 })).rejects.toThrow('Someone changed this catalog item.'); // the old version
    await calls.addPrice(priced, { effectiveFrom: '2026-09-28', minQty: 10, unitPriceCents: 40_000 });
    const tiered = await calls.open(item.id);
    expect(tiered.prices.map((p) => [p.minQty, p.unitPriceCents])).toEqual([[10, 40_000], [1, 45_000]]);

    // Once it has prices the type cannot change; the editor says so and locks those boxes, and a rename still works.
    expect(typeLocked(tiered)).toBe(true);
    expect(typeLocked({ prices: [] })).toBe(false);
    await expect(calls.update(tiered, { ...valuesOf(tiered), unit: 'set', setComponents: 2 })).rejects.toThrow('Deactivate this item and create a new one');
    const renamed = await calls.update(tiered, { ...valuesOf(tiered), name: 'Sample polo shirt (short sleeve)' });
    expect(renamed).toMatchObject({ name: 'Sample polo shirt (short sleeve)', version: 4 });
    const editor = html(ItemEditor, { me, row: await calls.open(item.id), onClose: () => undefined, onSaved: async () => undefined });
    expect(editor).toContain('This item has prices, so its class, garment type and unit cannot change');
    expect(editor.match(/<select disabled=""/g)?.length).toBe(2); // class and unit

    await calls.deactivate(renamed);
    expect((await calls.open(item.id)).is_active).toBe(0);
    expect((await calls.list('polo', 0))[0]!.is_active).toBe(0);
    const off = await calls.open(item.id);
    await expect(calls.deactivate(off)).rejects.toThrow('This catalog item is inactive.');
    await expect(calls.addPrice(off, { effectiveFrom: '2026-10-01', minQty: 1, unitPriceCents: 1 })).rejects.toThrow('This catalog item is inactive.');
  });

  it('sends a service without a garment type and a piece with one component; checks prices in centavos', () => {
    expect(itemBody({ ...blankItem(), code: ' S-1 ', name: ' Embroidery ', class: 'service', garmentType: 'left over' })).toMatchObject({ code: 'S-1', name: 'Embroidery', garmentType: null, setComponents: 1 });
    expect(itemBody({ ...blankItem(), unit: 'set', setComponents: 2, garmentType: ' Coat ' })).toMatchObject({ garmentType: 'Coat', unit: 'set', setComponents: 2 });
    expect([moneyCents('1,250.50'), moneyCents('12.345'), moneyCents('abc'), moneyCents('-5')]).toEqual([125_050, null, null, null]);
  });

  it('lets an encoder edit items but not set prices; the server decides', async () => {
    const owner = await signIn('owner-2', ['owner']);
    const item = await catalogCalls(owner.me).create({ ...blankItem(), code: 'FAKE-1', name: 'Sample', class: 'service', garmentType: '' });
    const encoder = await signIn('encoder-1', ['encoder']);
    const calls = catalogCalls(encoder.me);
    expect((await calls.list('', 0)).length).toBe(1);
    await expect(calls.addPrice(item, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 100 })).rejects.toThrow(/permission/i);
    expect(html(Catalog, { me: encoder.me })).not.toContain('New effective-dated price');
    expect(html(Catalog, { me: encoder.me })).toContain('+ New item');
  });
});

describe('Quotation screens against the doc type', () => {
  /** A price list with a service (a tier at 10) and a garment, a customer, and an encoder signed in (the user the quotation screens are for). */
  async function shop() {
    const owner = await signIn('owner-3', ['owner']);
    const calls = catalogCalls(owner.me);
    const svc = await calls.create({ ...blankItem(), code: 'FAKE-PATCH', name: 'Sample patch', class: 'service', garmentType: '' });
    await calls.addPrice(svc, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 12_000 });
    await calls.addPrice(await calls.open(svc.id), { effectiveFrom: '2026-09-28', minQty: 10, unitPriceCents: 10_000 });
    const garment = await calls.create({ ...blankItem(), code: 'FAKE-TEE', name: 'Sample tee', garmentType: 'T-shirt' });
    await calls.addPrice(garment, { effectiveFrom: '2026-09-28', minQty: 1, unitPriceCents: 25_000 });
    const encoder = await signIn('encoder-2', ['encoder']);
    const customer = await masterRequest<{ id: string }>(encoder.me, '/api/cus/customers', 'POST', { kind: 'organization', displayName: 'Fictional Academy' });
    return { encoder, svcId: svc.id, garmentId: garment.id, customerId: customer.id };
  }
  const line = (itemId: string, qty: number, over: Partial<Form['lines'][number]> = {}) => ({ itemId, description: 'Sample', qty, unit: 'pc' as const, discountCents: 0, ...over });

  it('is not ready until it has a customer or a prospect (not both) and a complete line', () => {
    const v = blank();
    expect(isReady(v)).toBe(false);
    v.prospectName = 'Fictional Club';
    v.lines = [line('i1', 2)];
    expect(isReady(v)).toBe(true);
    expect(isReady({ ...v, customerId: 'c1' })).toBe(false);
    expect(isReady({ ...v, prospectName: ' ', customerId: 'c1' })).toBe(true);
    expect(isReady({ ...v, lines: [line('i1', 0)] })).toBe(false);
    expect(isReady({ ...v, lines: [line('', 1)] })).toBe(false);
  });

  it('builds the strict input the server takes; the server prices, totals and dates it', async () => {
    const { encoder, svcId } = await shop();
    const v: Form = { ...blank(), prospectName: ' Fictional Club ', contact: '0917 000 0000', termsText: 'Sample terms', documentDiscountCents: 1_000,
      lines: [line(svcId, 1), line(svcId, 10)] };
    const input = toInput(v);
    expect(Object.keys(input).sort()).toEqual(['contact', 'documentDiscountCents', 'lines', 'prospectName', 'termsText', 'validForDays']);
    const preview = await encoder.api.preview('quo.quotation', input);
    expect(preview).toMatchObject({ totalCents: 111_000, issues: [] });
    expect((preview.doc as { validUntil: string }).validUntil).toBe('2026-10-13');
    const done = await encoder.api.post('quo.quotation', input, 111_000, key());
    expect(done).toMatchObject({ number: 'QUO-000001', totalCents: 111_000 });
    const detail = await encoder.api.get('quo.quotation', done.id);

    // Editing puts the stored input back in the form, and the same input comes out; recording it cancels and reissues.
    expect(toInput(valuesOfInput(detail.input))).toEqual(detail.input);
    const again = await encoder.api.reissue('quo.quotation', done.id, toInput({ ...valuesOfInput(detail.input), validForDays: 30 }), 111_000, 'Customer asked for a longer validity', key());
    expect(again.number).toBe('QUO-000002');
  });

  it('sends an override reason only with an override price; the server accepts an override from a user who may', async () => {
    const { encoder, svcId } = await shop();
    const stray = toInput({ ...blank(), prospectName: 'Fictional Club', lines: [line(svcId, 1, { overrideReason: 'left over from an earlier try' })] });
    expect(stray.lines[0]).not.toHaveProperty('overrideReason');
    expect((await encoder.api.preview('quo.quotation', stray)).issues).toEqual([]);
    const priced = toInput({ ...blank(), prospectName: 'Fictional Club', lines: [line(svcId, 1, { overrideUnitPriceCents: 9_000, overrideReason: 'Regular customer' })] });
    expect(priced.lines[0]).toMatchObject({ overrideUnitPriceCents: 9_000, overrideReason: 'Regular customer' });
    expect(await encoder.api.preview('quo.quotation', priced)).toMatchObject({ totalCents: 9_000, issues: [] });
    const noReason = toInput({ ...blank(), prospectName: 'Fictional Club', lines: [line(svcId, 1, { overrideUnitPriceCents: 9_000 })] });
    expect((await encoder.api.preview('quo.quotation', noReason)).issues).toMatchObject([{ code: 'OVERRIDE_REASON' }]);
  });

  it('saves an inquiry as a draft with no number, and opens it again unchanged', async () => {
    const { encoder } = await shop();
    const inquiry: Form = { ...blank(), prospectName: 'Fictional Club', lines: [line('', 5)] }; // no item chosen yet
    const saved = await encoder.api.createDraft('quo.quotation', { values: inquiry as unknown as Record<string, string> });
    const drafts = await encoder.api.drafts('quo.quotation');
    expect(drafts.map((d) => d.id)).toEqual([saved.id]);
    expect(drafts[0]!.payload.values).toEqual(inquiry);
    expect(env.db.prepare("SELECT count(*) AS n FROM documents WHERE module = 'QUO'").get()).toEqual({ n: 0 });
  });

  it('makes the Job Order form\'s starting values from a customer quotation, at the same total; a prospect gets none', async () => {
    const { encoder, svcId, garmentId, customerId } = await shop();
    const quoted = toInput({ ...blank(), customerId, notes: 'Sample notes', documentDiscountCents: 1_001,
      lines: [line(svcId, 10, { description: 'Sample patches' }), line(garmentId, 3, { description: 'Sample tees', discountCents: 500 })] });
    const total = 10 * 10_000 + 3 * 25_000 - 500 - 1_001;
    const { id } = await encoder.api.post('quo.quotation', quoted, total, key());
    const detail = await encoder.api.get('quo.quotation', id);
    const classes = await itemClasses(detail.input.lines instanceof Array ? (detail.input.lines as { itemId: string }[]).map((l) => l.itemId) : []);
    expect(classes).toEqual({ [svcId]: 'service', [garmentId]: 'made_to_order_garment' });

    const prefill = jobOrderPrefill(detail, classes)!;
    expect(prefill).toMatchObject({ customerId, notes: 'From quotation QUO-000001. Sample notes' });
    expect(prefill.lines.map((l) => [l.kind, l.description, l.qty, l.unitPriceCents])).toEqual([['service', 'Sample patches', 10, 10_000], ['made_to_order', 'Sample tees', 3, 25_000]]);
    // Staff choose the due date, priority and payment terms; with them the input is one the Job Order accepts, at the quoted total.
    const jobOrder = jobOrderInput.parse({ ...prefill, dueInDays: 15, priority: 'normal', paymentTerms: 'dp50' });
    const preview = await encoder.api.preview('jo.job_order', jobOrder);
    expect(preview.totalCents).toBe(total);
    expect(preview.issues.filter((i) => i.level === 'error')).toEqual([]);

    const prospect = await encoder.api.post('quo.quotation', toInput({ ...blank(), prospectName: 'Fictional Club', lines: [line(svcId, 1)] }), 12_000, key());
    expect(jobOrderPrefill(await encoder.api.get('quo.quotation', prospect.id), classes)).toBeNull();
  });

  it('shows the quotation with its lines and "Make a job order"; a prospect is told to become a customer first', async () => {
    const { encoder, svcId, customerId } = await shop();
    const record = async (extra: object) => {
      const input = toInput({ ...blank(), ...extra, lines: [line(svcId, 1, { description: 'Sample patch, embroidered' })] });
      return encoder.api.get('quo.quotation', (await encoder.api.post('quo.quotation', input, 12_000, key())).id);
    };
    const render = (detail: DocDetail) => renderToStaticMarkup(quotationView(() => false).extra!(detail) as never);
    const forCustomer = render(await record({ customerId }));
    for (const text of ['For Fictional Academy', 'valid until 2026-10-13', 'Sample patch, embroidered', '₱120.00', 'Make a job order']) expect(forCustomer).toContain(text);
    expect(forCustomer).not.toContain('is for a prospect');
    expect(render(await record({ prospectName: 'Fictional Club' }))).toContain('This quotation is for a prospect');
    expect(render(await record({ prospectName: 'Fictional Club' }))).toMatch(/<button[^>]*disabled=""[^>]*>Make a job order/);
    expect(VIEWS['quo.quotation']!.extra).toBeTypeOf('function');
  });

  it('opens the Job Order form when it is registered, and otherwise the job order list with a notice; expiry only warns', () => {
    expect(jobOrderTarget(true, 'abc-1', 'QUO-000001')).toBe('/docs/jo.job_order/new?fromQuotation=abc-1');
    expect(jobOrderTarget(false, 'abc-1', 'QUO-000001')).toBe('/docs/jo.job_order?from-quotation=QUO-000001');
    expect('jo.job_order' in FORMS).toBe(false); // when the job order screens register their form, this flips and the button follows
    expect(JOB_ORDER_LATER('QUO-000001')).toBe('QUO-000001 is ready to become a job order, but the job order form comes with the job order screens. Nothing was changed on the quotation.');
    const jo = { ...quoType, key: 'jo.job_order', title: 'Job Order' };
    expect(html(DocList, { type: jo, notice: JOB_ORDER_LATER('QUO-000001') })).toContain('comes with the job order screens');
    expect(html(DocList, { type: jo })).not.toContain('comes with the job order screens');
    expect([isExpired('2026-10-13', '2026-10-13'), isExpired('2026-10-13', '2026-10-14')]).toEqual([false, true]);
  });
});
