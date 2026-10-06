/**
 * "Reason to go ahead anyway" on the bill and voucher forms: shown after the server answers DUPLICATE_INVOICE, only to a user who
 * may go ahead (acc.backdate), 10 to 200 characters, sent as duplicateReason. The forms are driven without a browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { change, form, type } from '../JO/entry-test.ts';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { api, createApi, newIdempotencyKey as key, type Me, type Preview } from '../../api.ts';
import { VoucherForm } from '../EXP/VoucherForm.tsx';
import { BillForm } from './BillForm.tsx';
import { DuplicateReasonBox, MoneyForm } from './parts.tsx';
import { DUPLICATE_REASON_MAX, duplicateReasonBox } from './payables.ts';

afterEach(() => vi.restoreAllMocks());

const me = (permissions: string[]) => ({ userId: 'u1', username: 'sample', displayName: 'Sample', roles: [], permissions, mustChangePassword: false, csrfToken: 'x' }) as Me;
const refusal = { totalCents: 100_000, summary: 'Bill', doc: {}, issues: [{ field: 'supplierInvoiceNo', code: 'DUPLICATE_INVOICE', level: 'error', message: 'Invoice no. SI-0042 of this supplier is already on BILL-000001. To record it again anyway, type why.' }] } as Preview;
const REASON = 'The supplier sent a corrected copy of the same invoice';

describe('the reason box rule', () => {
  const dup = [{ code: 'DUPLICATE_INVOICE' }];
  it('shows only after DUPLICATE_INVOICE, only to a user who may go ahead, and sends only a reason of 10 to 200 characters', () => {
    expect(duplicateReasonBox([], true, REASON)).toEqual({ show: false });
    expect(duplicateReasonBox([{ code: 'STOCK' }], true, REASON)).toEqual({ show: false });
    expect(duplicateReasonBox(dup, false, REASON)).toEqual({ show: false });
    expect(duplicateReasonBox(dup, true, '')).toEqual({ show: true });
    expect(duplicateReasonBox(dup, true, '  too short ')).toMatchObject({ show: true, problem: 'The reason needs 10 to 200 characters (now 9).' });
    expect(duplicateReasonBox(dup, true, `  ${REASON}  `)).toEqual({ show: true, reason: REASON });
    expect(duplicateReasonBox(dup, true, 'x'.repeat(DUPLICATE_REASON_MAX)).reason).toHaveLength(200);
    expect(duplicateReasonBox(dup, true, 'x'.repeat(DUPLICATE_REASON_MAX + 1))).toMatchObject({ show: true, problem: expect.stringContaining('(now 201)') });
  });

  it('reads "Reason to go ahead anyway" with its limits', () => {
    const html = renderToStaticMarkup(createElement(DuplicateReasonBox, { value: '', onChange: () => undefined }));
    expect(html).toContain('Reason to go ahead anyway');
    expect(html).toContain('10 to 200 characters');
  });
});

/** The frame a form renders, run with its own props: the form's input and what it says about who may go ahead. */
const frame = (render: () => ReactElement) => form(() => { const el = render(); return MoneyForm(el.props as never); });
const hasBox = (f: ReturnType<typeof frame>) => f.render().some((n) => n.type === DuplicateReasonBox);

async function recordOnce(f: ReturnType<typeof frame>) {
  await f.find('children', 'Record').props.onClick();
}

const billFrame = (permissions: string[]) => {
  const f = frame(() => BillForm({ type: type('ap.bill'), mode: { kind: 'new' }, me: me(permissions) }) as ReactElement);
  f.render().find((n) => n.props.onChange && n.props.suppliers)!.props.onChange('s1');
  change(f.field('Invoice no. (on the supplier’s invoice)'), 'SI-0042');
  change(f.field('Invoice date'), '2026-09-25');
  change(f.render().find((n) => n.props['aria-label'] === 'Line 1: for')!, 'subcontract');
  change(f.render().find((n) => n.props['aria-label'] === 'Line 1: amount')!, '1,000.00');
  return f;
};
const voucherFrame = (permissions: string[]) => {
  const f = frame(() => VoucherForm({ type: type('exp.voucher'), mode: { kind: 'new' }, me: me(permissions) }) as ReactElement);
  change(f.field('Expense'), '5');
  change(f.field('Description'), 'Thread and needles');
  change(f.field('Name'), 'Sample Notions');
  change(f.field('Amount (VAT included)'), '500.00');
  change(f.field('Receipt no.'), 'OR-0042');
  f.find('question', 'Where did the money come from?').props.onChange([{ cashPlaceId: '1', amount: '500.00', reference: '' }]);
  return f;
};

describe('both forms after a duplicate refusal', () => {
  it('the bill form: no box at first, the box after the refusal, and the reason goes with the next check and the record', async () => {
    const preview = vi.spyOn(api, 'preview').mockResolvedValue(refusal);
    const f = billFrame(['acc.backdate']);
    expect(hasBox(f)).toBe(false);

    await recordOnce(f);
    expect(preview).toHaveBeenLastCalledWith('ap.bill', expect.not.objectContaining({ duplicateReason: expect.anything() }), undefined);
    expect(hasBox(f)).toBe(true);

    f.render().find((n) => n.type === DuplicateReasonBox)!.props.onChange(` ${REASON} `);
    await recordOnce(f);
    expect(preview).toHaveBeenLastCalledWith('ap.bill', expect.objectContaining({ supplierId: 's1', supplierInvoiceNo: 'SI-0042', duplicateReason: REASON }), undefined);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'b1' } as never);
    await f.render().find((n) => n.props.onRecord)!.props.onRecord('k1');
    expect(post).toHaveBeenLastCalledWith('ap.bill', expect.objectContaining({ duplicateReason: REASON }), 100_000, 'k1', undefined);
  });

  it('the voucher form: the same', async () => {
    const preview = vi.spyOn(api, 'preview').mockResolvedValue(refusal);
    const f = voucherFrame(['acc.backdate']);
    expect(hasBox(f)).toBe(false);

    await recordOnce(f);
    expect(preview).toHaveBeenLastCalledWith('exp.voucher', expect.not.objectContaining({ duplicateReason: expect.anything() }), undefined);
    expect(hasBox(f)).toBe(true);
    f.render().find((n) => n.type === DuplicateReasonBox)!.props.onChange(REASON);
    await recordOnce(f);
    expect(preview).toHaveBeenLastCalledWith('exp.voucher', expect.objectContaining({ supplierInvoiceNo: 'OR-0042', duplicateReason: REASON }), undefined);
  });

  it('a user who may not go ahead never sees the box, on either form', async () => {
    const preview = vi.spyOn(api, 'preview').mockResolvedValue(refusal);
    for (const make of [billFrame, voucherFrame]) {
      const f = make(['ap.bill.ewt']);
      await recordOnce(f);
      expect(preview).toHaveBeenCalled();
      expect(hasBox(f)).toBe(false);
    }
  });
});

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('the web client against the server', () => {
  it('a duplicate is refused without a reason and goes ahead with one, for a user who may', async () => {
    const env = await createTestEnv();
    createUser(env.db, 'acct1', ['accountant']);
    const accountant = createApi(injectFetch(env.app));
    await accountant.login('acct1', PASSWORD);
    const server = await env.as('accountant');
    const supplierId = (await server.post('/api/pur/suppliers', { name: 'Sample Fabric Trading', registeredName: 'Sample Fabric Trading Inc.', tin: '111-222-333-000', isVatRegistered: false })).json().id as string;
    const input = { supplierId, supplierInvoiceNo: 'SI-0042', supplierInvoiceDate: '2026-09-25', lines: [{ purchase: 'subcontract', amountCents: 100_000 }] };
    const first = await accountant.preview('ap.bill', input);
    expect(first.issues.filter((i) => i.level === 'error')).toEqual([]);
    await accountant.post('ap.bill', input, first.totalCents, key());

    const refused = await accountant.preview('ap.bill', input);
    expect(refused.issues).toEqual([expect.objectContaining({ code: 'DUPLICATE_INVOICE', level: 'error' })]);
    const allowed = await accountant.preview('ap.bill', { ...input, duplicateReason: REASON });
    expect(allowed.issues).toEqual([expect.objectContaining({ code: 'DUPLICATE_INVOICE', level: 'warning' })]);
    expect((await accountant.post('ap.bill', { ...input, duplicateReason: REASON }, allowed.totalCents, key())).number).toBe('BILL-000002');
  });
});
