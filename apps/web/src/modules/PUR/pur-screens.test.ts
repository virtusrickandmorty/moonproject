/** The supplier, supplies, purchase order and receiving screens' rules, the menu, and the web client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { createApi, newIdempotencyKey, type PoStatus, type SupplierRecord, type SupplyRecord } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import {
  contactToInput, emptyContactForm, emptyPoRow, emptySupplierForm, filterSupplies, filterSuppliers, overReceived, poRowTotal, poToInput, qtyWords, receiveAllLeft, rrRows,
  rrToInput, supplierToForm, supplierToInput, supplyToInput, wholeQty,
} from './purchasing.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

const supplier = (over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id: 's1', name: 'Tela Trading', registered_name: 'Tela Trading Inc.', tin: '123-456-789-000', is_vat_registered: 1, ewt_class: 'goods_1', payment_terms_days: 30,
  sworn_declaration_until: null, legacy_id: null, is_active: 1, version: 1, ...over,
});

describe('supplier form rules', () => {
  it('needs a name and registered name; the TIN, terms and dates are checked; blanks go to the server as null', () => {
    expect(supplierToInput(emptySupplierForm()).errors).toEqual(['Type the supplier’s name.', 'Type the name the supplier is registered under (as on its receipts).']);
    const ok = { ...emptySupplierForm(), name: ' Hilo ', registeredName: 'Hilo Co.', paymentTermsDays: '15', ewtClass: 'rent_5' };
    expect(supplierToInput(ok)).toEqual({
      errors: [],
      input: { name: 'Hilo', registeredName: 'Hilo Co.', tin: null, isVatRegistered: false, ewtClass: 'rent_5', swornDeclarationUntil: null, paymentTermsDays: 15, legacyId: null },
    });
    expect(supplierToInput({ ...ok, tin: '123-456-789' }).errors).toEqual(['The TIN looks like 123-456-789-000 (with 2 more digits for a branch).']);
    expect(supplierToInput({ ...ok, tin: '123-456-789-00012' }).errors).toEqual([]);
    expect(supplierToInput({ ...ok, paymentTermsDays: '1.5' }).errors).toEqual(['Payment terms are a whole number of days, like 30.']);
    expect(supplierToInput({ ...ok, swornDeclarationUntil: '2026-02-30' }).errors).toEqual(['Pick a real date for the sworn declaration.']);
    expect(supplierToInput({ ...ok, ewtClass: 'prof_ind_5' }).errors).toEqual(['The 5% professional rate needs the date the sworn declaration is valid until.']);
  });

  it('a record round-trips through the form; search finds a name, registered name or TIN in any case', () => {
    const s = supplier({ payment_terms_days: null, ewt_class: null, is_vat_registered: 0 });
    expect(supplierToForm(s)).toMatchObject({ name: 'Tela Trading', isVatRegistered: false, ewtClass: '', paymentTermsDays: '' });
    const { input, errors } = supplierToInput(supplierToForm(supplier()));
    expect([errors, input.ewtClass, input.paymentTermsDays, input.tin]).toEqual([[], 'goods_1', 30, '123-456-789-000']);
    const rows = [supplier(), supplier({ id: 's2', name: 'Hilo Supply', registered_name: 'Hilo Supply Co.', tin: null })];
    expect(filterSuppliers(rows, 'HILO').map((r) => r.id)).toEqual(['s2']);
    expect(filterSuppliers(rows, 'inc.').map((r) => r.id)).toEqual(['s1']);
    expect(filterSuppliers(rows, '456-789').map((r) => r.id)).toEqual(['s1']);
    expect(filterSuppliers(rows, '  ').length).toBe(2);
    expect(filterSupplies([{ name: 'Cotton twill' }, { name: 'Poly thread' }] as SupplyRecord[], 'THREAD').map((r) => r.name)).toEqual(['Poly thread']);
  });

  it('a contact needs a name and a sensible email; the phone is left to the server, which normalizes it', () => {
    expect(contactToInput(emptyContactForm()).errors).toEqual(['Type the contact’s name.']);
    expect(contactToInput({ name: 'Ana', role: '', phone: '0917 123 4567', email: 'ana@' }).errors).toEqual(['That email address does not look right.']);
    expect(contactToInput({ name: ' Ana ', role: 'Sales', phone: '0917 123 4567', email: '' })).toEqual({
      errors: [], input: { name: 'Ana', role: 'Sales', phone: '0917 123 4567', email: null },
    });
    expect(supplyToInput({ name: ' ', unit: 'yard', category: 'materials' }).errors).toEqual(['Type the supply’s name.']);
  });
});

describe('purchase order rules', () => {
  it('whole quantities only; lines are read to centavos; blank lines are skipped', () => {
    expect(['12', ' 7 ', '0', '1.5', '', '-2', '1000001'].map(wholeQty)).toEqual([12, 7, undefined, undefined, undefined, undefined, undefined]);
    expect(poRowTotal({ supplyId: 'a', qty: '12', unitCost: '150.50' })).toBe(180_600);
    expect(poRowTotal({ supplyId: 'a', qty: 'x', unitCost: '150' })).toBeUndefined();
    const rows = [{ supplyId: 'a', qty: '12', unitCost: '150.50' }, emptyPoRow(), { supplyId: 'b', qty: '3', unitCost: '' }];
    expect(poToInput('s1', '2026-10-15', rows)).toEqual({
      errors: [], input: { supplierId: 's1', expectedDate: '2026-10-15', lines: [{ supplyId: 'a', qty: 12, unitCostCents: 15_050 }, { supplyId: 'b', qty: 3, unitCostCents: 0 }] },
    });
    expect(poToInput('s1', '', [emptyPoRow()]).errors).toEqual(['Add at least one supply to the order.']);
    expect(poToInput('', '2026-13-01', [{ supplyId: '', qty: '1.5', unitCost: '1,2x' }]).errors).toEqual([
      'Pick the supplier.', 'Pick a real expected date, or leave it empty.', 'Line 1: pick the supply.', 'Line 1: type the quantity as a whole number, like 12.',
      'Line 1: type the cost of one unit like 150.00 (or leave it empty for zero).',
    ]);
    expect('expectedDate' in poToInput('s1', '  ', [{ supplyId: 'a', qty: '1', unitCost: '1' }]).input).toBe(false);
  });
});

describe('receiving rules', () => {
  const po = {
    lines: [
      { lineNo: 1, supplyId: 'a', supplyName: 'Cotton twill', unit: 'yard', orderedQty: 10, receivedQty: 6, remainingQty: 4, unitCostCents: 15_000 },
      { lineNo: 2, supplyId: 'b', supplyName: 'Poly thread', unit: 'roll', orderedQty: 4, receivedQty: 4, remainingQty: 0, unitCostCents: 2_500 },
    ],
  } as PoStatus;

  it('shows what is still to receive per line, and receives the rest in one click', () => {
    const rows = rrRows(po);
    expect(rows.map((r) => [r.supplyName, r.ordered, r.received, r.remaining, r.qty])).toEqual([['Cotton twill', 10, 6, 4, ''], ['Poly thread', 4, 4, 0, '']]);
    expect(receiveAllLeft(rows).map((r) => r.qty)).toEqual(['4', '']);
    expect([qtyWords(1, 'yard'), qtyWords(4, 'yard'), qtyWords(2, 'kg'), qtyWords(1, 'pc'), qtyWords(3, 'pc'), qtyWords(2, 'roll')]).toEqual(['1 yard', '4 yards', '2 kg', '1 piece', '3 pieces', '2 rolls']);
  });

  it('on an edit the report being replaced no longer counts as received, and its quantity is typed again', () => {
    const rows = rrRows(po, { 1: 2 });
    expect(rows[0]).toMatchObject({ received: 4, remaining: 6, qty: '2' });
    expect(rows[1]).toMatchObject({ received: 4, remaining: 0, qty: '' });
  });

  it('only typed lines are sent; a warning when more than ordered would come; blank is not an error until all are blank', () => {
    const rows = rrRows(po);
    expect(rrToInput('p1', rows).errors).toEqual(['Type the quantity received on at least one line.']);
    const typed = [{ ...rows[0]!, qty: '5' }, { ...rows[1]! }];
    expect(rrToInput('p1', typed)).toEqual({ errors: [], input: { poDocumentId: 'p1', lines: [{ poLineNo: 1, qty: 5 }] } });
    expect(typed.map(overReceived)).toEqual([1, 0]);
    expect(rrToInput('p1', [{ ...rows[0]!, qty: '2.5' }]).errors).toEqual(['Cotton twill: type the quantity received as a whole number, like 5.']);
    expect(rrToInput('', typed).errors).toEqual(['Pick the purchase order the goods came for.']);
  });
});

describe('the menu', () => {
  it('shows Suppliers and Supplies under Purchases & Expenses, each only with the permission its route checks', () => {
    const labels = (perms: string[]) => buildMenu([], new Set(perms)).find((g) => g.group === 'Purchases & Expenses')?.items.map((i) => `${i.label} ${i.path}`);
    expect(labels([])).toBeUndefined();
    expect(labels(['pur.supplier.view'])).toEqual(['Suppliers /pur/suppliers']);
    expect(labels(['pur.supply.view'])).toEqual(['Supplies /pur/supplies']);
    expect(labels(['pur.supplier.view', 'pur.supply.view'])).toEqual(['Suppliers /pur/suppliers', 'Supplies /pur/supplies']);
  });
});

describe('web client for suppliers, supplies, purchase orders and receiving', () => {
  it('adds, changes with If-Match, deactivates and lists; contacts; the order and receiving flow by name', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    createUser(env.db, 'enc1', ['encoder']);
    createUser(env.db, 'prod1', ['production']);
    const acct = createApi(injectFetch(env.app));
    await acct.login('acct1', PASSWORD);

    const added = await acct.addSupplier(supplierToInput({ ...emptySupplierForm(), name: 'Tela Trading', registeredName: 'Tela Trading Inc.', tin: '123-456-789-000', ewtClass: 'goods_1', paymentTermsDays: '30' }).input);
    const other = await acct.addSupplier(supplierToInput({ ...emptySupplierForm(), name: 'Hilo Supply', registeredName: 'Hilo Supply Co.' }).input);
    let s = await acct.supplier(added.id);
    expect(supplierToForm(s)).toMatchObject({ name: 'Tela Trading', tin: '123-456-789-000', ewtClass: 'goods_1', paymentTermsDays: '30' });
    const edit = supplierToInput({ ...supplierToForm(s), paymentTermsDays: '45', isVatRegistered: true }).input;
    expect(await acct.updateSupplier(s.id, s.version, edit)).toEqual({ success: true, version: 2 });
    await expect(acct.updateSupplier(s.id, 1, edit)).rejects.toMatchObject({ status: 409 });
    s = await acct.supplier(added.id);
    expect([s.payment_terms_days, s.is_vat_registered, s.version]).toEqual([45, 1, 2]);

    const contact = await acct.addSupplierContact(s.id, contactToInput({ name: 'Ana Reyes', role: 'Sales', phone: '0917 123 4567', email: 'ana@example.test' }).input);
    expect((await acct.supplierContacts(s.id)).map((c) => [c.name, c.phone])).toEqual([['Ana Reyes', '+639171234567']]);
    await acct.deactivateSupplierContact(s.id, contact.id);
    expect(await acct.supplierContacts(s.id)).toEqual([]);

    const supplyBody = supplyToInput({ name: 'Cotton twill', unit: 'yard', category: 'materials' }).input;
    const cotton = await acct.addSupply(supplyBody);
    const thread = await acct.addSupply({ name: 'Poly thread', unit: 'roll', category: 'materials' });
    const cottonRow = (await acct.supplyList('active')).find((x) => x.id === cotton.id)!;
    await acct.updateSupply(cotton.id, cottonRow.version, { ...supplyBody, name: 'Cotton twill (white)' });
    expect((await acct.supplyList('all')).map((x) => x.name)).toEqual(['Cotton twill (white)', 'Poly thread']);

    // The order is typed by name in the form; the client sends ids the form picked.
    const enc = createApi(injectFetch(env.app));
    await enc.login('enc1', PASSWORD);
    const { input: poInput, errors } = poToInput(s.id, '2026-10-15', [{ supplyId: cotton.id, qty: '10', unitCost: '150' }, { supplyId: thread.id, qty: '4', unitCost: '25' }]);
    expect(errors).toEqual([]);
    const preview = await enc.preview('pur.po', poInput);
    expect(preview).toMatchObject({ totalCents: 160_000 });
    const po = await enc.post('pur.po', poInput, preview.totalCents, newIdempotencyKey());

    let open = await enc.openPurchaseOrders();
    expect(open.map((p) => [p.number, p.supplierName])).toEqual([[po.number, 'Tela Trading']]);
    const first = rrToInput(po.id, receiveAllLeft(rrRows(open[0]!)).map((r, i) => (i === 0 ? { ...r, qty: '6' } : { ...r, qty: '' })));
    expect(first.errors).toEqual([]);
    const rr = await enc.post('pur.rr', first.input, 0, newIdempotencyKey());
    open = await enc.openPurchaseOrders();
    expect(rrRows(open[0]!).map((r) => [r.supplyName, r.received, r.remaining])).toEqual([['Cotton twill (white)', 6, 4], ['Poly thread', 0, 4]]);
    expect((await enc.receivingReport(rr.id)).lines.map((l) => [l.supplyName, l.qty])).toEqual([['Cotton twill (white)', 6]]);
    expect((await enc.supplierPurchaseOrders(s.id)).map((p) => [p.number, p.fullyReceived])).toEqual([[po.number, false]]);
    expect((await enc.supplierReceivingReports(s.id)).map((r) => r.number)).toEqual([rr.number]);
    expect(await enc.supplierPurchaseOrders(other.id)).toEqual([]);

    // Edit of the receiving report: the order shows its own quantity as still to receive again.
    const back = await enc.purchaseOrder(po.id);
    expect(rrRows(back, { 1: 6 })[0]).toMatchObject({ received: 0, remaining: 10, qty: '6' });

    // An owner may deactivate; the pickers stop offering it, the inactive filter finds it, and its orders stay.
    await acct.deactivateSupplier(other.id, 1);
    expect((await acct.supplierList('active')).map((x) => x.name)).toEqual(['Tela Trading']);
    expect((await acct.supplierList('inactive')).map((x) => x.name)).toEqual(['Hilo Supply']);
    await expect(acct.updateSupplier(other.id, 2, edit)).rejects.toMatchObject({ status: 400 });

    // An encoder reads suppliers but cannot change them; production sees supplies only.
    await expect(enc.addSupplier(edit)).rejects.toMatchObject({ status: 403 });
    await expect(enc.addSupply(supplyBody)).rejects.toMatchObject({ status: 403 });
    const prod = createApi(injectFetch(env.app));
    await prod.login('prod1', PASSWORD);
    expect((await prod.supplyList('active')).length).toBe(2);
    await expect(prod.supplierList('active')).rejects.toMatchObject({ status: 403 });
    await expect(prod.openPurchaseOrders()).rejects.toMatchObject({ status: 403 });
    await env.app.close();
  });
});
