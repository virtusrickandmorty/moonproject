import { afterEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env = undefined; });

function madeUpShop(userId: string) {
  const db = env!.db; const at = '2026-09-28T10:00:00+08:00';
  db.prepare(`INSERT INTO cus_customers (id, code, kind, display_name, credit_terms_days, created_at, updated_at)
    VALUES ('c-demo', 'DEMO', 'organization', 'Demo Tailoring Club', 15, ?, ?)`).run(at, at);
  const doc = (id: string, type: string, amount: number) => db.prepare(`INSERT INTO documents
    (id, doc_type, module, series_key, number, business_date, status, total_cents, summary, posted_at, posted_by)
    VALUES (?, ?, ?, ?, ?, '2026-09-28', 'posted', ?, 'Made-up shop', ?, ?)`).run(
      id, type, type.split('.')[0]!.toUpperCase(), type, id, amount, at, userId);
  doc('jo-demo', 'jo.job_order', 10000);
  db.prepare(`INSERT INTO jo_orders (document_id, customer_id, customer_name, due_date, priority, payment_terms, required_dp_cents)
    VALUES ('jo-demo', 'c-demo', 'Demo Tailoring Club', '2026-10-01', 'normal', 'net15', 0)`).run();
  db.prepare(`INSERT INTO jo_lines (document_id, line_no, kind, description, qty, unit_price_cents, discount_cents, line_total_cents)
    VALUES ('jo-demo', 1, 'made_to_order', 'Demo uniforms', 2, 5000, 0, 10000)`).run();
  db.prepare(`INSERT INTO jo_stage_events (document_id, seq, from_stage, to_stage, at, user_id)
    VALUES ('jo-demo', 1, 'open', 'released', ?, ?)`).run(at, userId);
  doc('release-demo', 'jo.release', 0);
  db.prepare(`INSERT INTO jo_releases (document_id, job_order_id, claimed_by, id_seen, balance_due_cents)
    VALUES ('release-demo', 'jo-demo', 'Buyer', 'none', 0)`).run();
  db.prepare(`INSERT INTO jo_release_lines (document_id, line_no, qty, list_cents, discount_cents, amount_cents)
    VALUES ('release-demo', 1, 2, 10000, 0, 10000)`).run();
  doc('jo-await', 'jo.job_order', 3000);
  db.prepare(`INSERT INTO jo_orders (document_id, customer_id, customer_name, due_date, priority, payment_terms, required_dp_cents)
    VALUES ('jo-await', 'c-demo', 'Demo Tailoring Club', '2026-10-05', 'normal', 'net15', 0)`).run();
  doc('release-await', 'jo.release', 0);
  db.prepare(`INSERT INTO jo_releases (document_id, job_order_id, claimed_by, id_seen, balance_due_cents)
    VALUES ('release-await', 'jo-await', 'Buyer', 'none', 0)`).run();
  db.prepare(`INSERT INTO jo_release_lines (document_id, line_no, qty, list_cents, discount_cents, amount_cents)
    VALUES ('release-await', 1, 1, 3000, 0, 3000)`).run();
  doc('invoice-demo', 'jo.invoice_record', 10000);
  db.prepare(`INSERT INTO jo_invoice_records (document_id, release_id, job_order_id, customer_id, customer_name,
    invoice_number, vat_rate_bp, deposit_vat_mode, list_cents, discount_cents, gross_cents, vat_cents,
    discount_net_cents, sales_mto_cents, sales_rtw_cents, sales_service_cents, deposit_applied_cents)
    VALUES ('invoice-demo', 'release-demo', 'jo-demo', 'c-demo', 'Demo Tailoring Club', '99901',
      0, 'A', 10000, 0, 10000, 0, 0, 10000, 0, 0, 0)`).run();
  doc('sale-demo', 'qs.sale', 5000);
  db.prepare(`INSERT INTO qs_sales (document_id, customer_id, customer_name, invoice_number, vat_rate_bp,
    list_cents, discount_cents, gross_cents, vat_cents, discount_net_cents, sales_mto_cents,
    sales_rtw_cents, sales_service_cents)
    VALUES ('sale-demo', 'c-demo', 'Demo Tailoring Club', '99902', 0, 5000, 0, 5000, 0, 0, 0, 5000, 0)`).run();
  db.prepare(`INSERT INTO qs_sale_lines (document_id, line_no, kind, description, qty, unit_price_cents, discount_cents, amount_cents)
    VALUES ('sale-demo', 1, 'ready_made', 'Demo cap', 1, 5000, 0, 5000)`).run();
  doc('collection-demo', 'col.collection', 2000);
  db.prepare(`INSERT INTO col_collections (document_id, customer_id, customer_name, cr_number, cwt_cents,
    unapplied_cents, short_over_cents, settle_small_difference)
    VALUES ('collection-demo', 'c-demo', 'Demo Tailoring Club', '99903', 0, 0, 0, 0)`).run();
  const account = (role: string) => (db.prepare('SELECT id FROM accounts WHERE role_key = ?').get(role) as { id: number }).id;
  const cash = (db.prepare('SELECT id FROM accounts WHERE is_cash_place = 1 AND is_postable = 1 LIMIT 1').get() as { id: number }).id;
  db.prepare(`INSERT INTO col_tenders (document_id, line_no, account_id, amount_cents)
    VALUES ('collection-demo', 1, ?, 2000)`).run(cash);
  db.prepare(`INSERT INTO col_applications (document_id, line_no, job_order_id, amount_cents, to_receivable_cents, to_deposit_cents)
    VALUES ('collection-demo', 1, 'jo-demo', 2000, 0, 2000)`).run();
  const journal = (id: string, sourceId: string, debitAccount: number, creditAccount: number, amount: number, ref: string | null) => {
    db.prepare(`INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, memo, created_at, created_by)
      VALUES (?, ?, '2026-09-28', 'document', ?, 'original', 'Made-up shop', ?, ?)`).run(id, id, sourceId, at, userId);
    db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
      VALUES (?, 1, ?, 'customer', 'c-demo', ?, 0, ?)`).run(id, debitAccount, amount, ref);
    db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
      VALUES (?, 2, ?, 'customer', 'c-demo', 0, ?, ?)`).run(id, creditAccount, amount, ref);
    db.prepare('UPDATE journals SET sealed = 1 WHERE id = ?').run(id);
  };
  journal('j-invoice', 'invoice-demo', account('AR_TRADE'), account('SALES_MTO'), 10000, 'jo-demo');
  journal('j-sale', 'sale-demo', cash, account('SALES_RTW'), 5000, 'sale-demo');
  journal('j-collection', 'collection-demo', cash, account('CUSTOMER_DEPOSITS'), 2000, 'jo-demo');
  return { depositCode: (db.prepare('SELECT code FROM accounts WHERE role_key = ?').get('CUSTOMER_DEPOSITS') as { code: string }).code,
    salesCodes: ['SALES_MTO', 'SALES_RTW'].map((r) => (db.prepare('SELECT code FROM accounts WHERE role_key = ?').get(r) as { code: string }).code) };
}

describe('sales and collections reports', () => {
  it('lists only deposits crossing the chosen VAT quarter in every deposit VAT mode', async () => {
    env = await createTestEnv(); const owner = await env.as('owner'); const db = env.db;
    const at = '2026-09-28T10:00:00+08:00';
    db.prepare(`INSERT INTO cus_customers (id, code, kind, display_name, credit_terms_days, created_at, updated_at)
      VALUES ('c-cross', 'CROSS', 'organization', 'Quarter Crossing Club', 15, ?, ?)`).run(at, at);
    const depositAccount = (db.prepare(`SELECT id FROM accounts WHERE role_key = 'CUSTOMER_DEPOSITS'`).pluck().get() as number);
    const arAccount = (db.prepare(`SELECT id FROM accounts WHERE role_key = 'AR_TRADE'`).pluck().get() as number);
    let sequence = 0;
    const document = (id: string, type: string, date: string, total: number) => db.prepare(`INSERT INTO documents
      (id, doc_type, module, series_key, number, business_date, status, total_cents, summary, posted_at, posted_by)
      VALUES (?, ?, 'COL', ?, ?, ?, 'posted', ?, 'Made-up quarter deposit', ?, ?)`).run(id, type, type, id.toUpperCase(), date, total, at, owner.userId);
    const order = (id: string) => {
      document(id, 'jo.job_order', '2026-04-01', 50000);
      db.prepare(`INSERT INTO jo_orders (document_id, customer_id, customer_name, due_date, priority, payment_terms, required_dp_cents)
        VALUES (?, 'c-cross', 'Quarter Crossing Club', '2026-12-01', 'normal', 'net15', 0)`).run(id);
    };
    const movement = (id: string, jo: string, date: string, mode: 'A' | 'B' | 'C', deposit: number, vat = 0, dp = 0, dpVat = 0) => {
      document(id, mode === 'C' && dp > 0 ? 'jo.dp_invoice' : 'col.collection', date, Math.max(Math.abs(deposit), Math.abs(dp)));
      db.prepare(`INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, memo, created_at, created_by)
        VALUES (?, ?, ?, 'document', ?, 'original', 'Made-up deposit', ?, ?)`).run(`j-${id}`, `J-${++sequence}`, date, id, at, owner.userId);
      const credit = Math.max(0, mode === 'C' ? dp - dpVat : deposit); const debit = Math.max(0, -(mode === 'C' ? dp - dpVat : deposit));
      db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
        VALUES (?, 1, ?, 'customer', 'c-cross', ?, ?, ?)`).run(`j-${id}`, depositAccount, debit, credit, jo);
      db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
        VALUES (?, 2, ?, 'customer', 'c-cross', ?, ?, ?)`).run(`j-${id}`, arAccount, credit, debit, jo);
      db.prepare('UPDATE journals SET sealed = 1 WHERE id = ?').run(`j-${id}`);
      db.prepare(`INSERT INTO col_deposit_vat (document_id, posting, line_no, job_order_id, customer_id, mode,
        deposit_cents, deposit_vat_cents, deposit_base_cents, dp_invoiced_cents, dp_vat_cents, register_base_cents)
        VALUES (?, 'original', 1, ?, 'c-cross', ?, ?, ?, 0, ?, ?, 0)`).run(id, jo, mode, deposit, vat, dp, dpVat);
    };
    for (const id of ['jo-a', 'jo-b', 'jo-c', 'jo-same']) order(id);
    movement('dep-a', 'jo-a', '2026-06-20', 'A', 10000);
    movement('dep-b', 'jo-b', '2026-08-10', 'B', 11200, 1200);
    movement('dep-c', 'jo-c', '2026-09-10', 'C', 0, 0, 11200, 1200);
    movement('dep-same', 'jo-same', '2026-07-10', 'A', 5000);
    movement('apply-same', 'jo-same', '2026-09-15', 'A', -5000);
    movement('apply-a', 'jo-a', '2026-10-10', 'A', -10000);

    const report = await owner.get('/api/rpt/deposits-crossing-quarter?quarter=2026-Q3');
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().rows.map((r: { mode: string; amountCents: number; heldAtQuarterEndCents: number; outputVatCents: number; quarterApplied: string | null }) =>
      [r.mode, r.amountCents, r.heldAtQuarterEndCents, r.outputVatCents, r.quarterApplied])).toEqual([
      ['A', 10000, 10000, 0, '2026-Q4'], ['B', 11200, 11200, 1200, null], ['C', 11200, 10000, 1200, null],
    ]);
    expect(report.json().totals.heldAtQuarterEndCents).toBe(31200);
    expect(report.json().totals.heldAtQuarterEndCents).toBe((await owner.get('/api/rpt/deposits-held?asOf=2026-09-30')).json().totalCents);
    const csv = await owner.get('/api/rpt/deposits-crossing-quarter?quarter=2026-Q3&format=csv');
    expect(csv.statusCode, csv.body).toBe(200); expect(csv.body).toContain('112.00,100.00,,C,12.00');
    expect((await (await env.as('encoder')).get('/api/rpt/deposits-crossing-quarter?quarter=2026-Q3')).statusCode).toBe(403);
  });

  it('shows deposits, collections, sales, and job follow-up tied to the trial balance', async () => {
    env = await createTestEnv(); const owner = await env.as('owner'); const codes = madeUpShop(owner.userId);
    const get = (name: string) => owner.get(`/api/rpt/${name}`);
    const deposits = await get('deposits-held?asOf=2026-09-28');
    const collections = await get('collections-register?from=2026-09-28&to=2026-09-28');
    const sales = await get('sales-by-period?from=2026-09-28&to=2026-09-28');
    const jobs = await get('job-order-follow-up');
    for (const result of [deposits, collections, sales, jobs]) expect(result.statusCode, result.body).toBe(200);
    expect(deposits.json().rows[0]).toMatchObject({ jobOrderId: 'jo-demo', heldCents: 2000 });
    expect(collections.json().byRecorder[0]).toMatchObject({ tenderCents: 2000 });
    expect(collections.json().byCashPlace[0]).toMatchObject({ tenderCents: 2000 });
    expect(sales.json().byItem.map((r: { salesCents: number }) => r.salesCents).sort((a: number, b: number) => a - b)).toEqual([5000, 10000]);
    expect(sales.json().byGarmentType).toHaveLength(2);
    expect(jobs.json().releasedWithBalance[0].balanceDueCents).toBe(8000);
    expect(jobs.json().awaitingInvoice).toMatchObject([{ id: 'release-await', releasedCents: 3000 }]);
    const tb = (await get('trial-balance?asOf=2026-09-28')).json().rows as {
      code: string; debitCents: number; creditCents: number }[];
    const net = (code: string) => { const row = tb.find((r) => r.code === code)!; return row.creditCents - row.debitCents; };
    expect(deposits.json().totalCents).toBe(net(codes.depositCode));
    expect(sales.json().totalCents).toBe(codes.salesCodes.reduce((n, code) => n + net(code), 0));
  });

  it('exports every report as CSV and denies both formats without permission', async () => {
    env = await createTestEnv(); const owner = await env.as('owner'); madeUpShop(owner.userId);
    const encoder = await env.as('encoder');
    for (const name of ['deposits-held?asOf=2026-09-28',
      'collections-register?from=2026-09-28&to=2026-09-28',
      'sales-by-period?from=2026-09-28&to=2026-09-28', 'job-order-follow-up']) {
      const separator = name.includes('?') ? '&' : '?';
      const csv = await owner.get(`/api/rpt/${name}${separator}format=csv`);
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.body).toContain('/docs/');
      expect((await encoder.get(`/api/rpt/${name}`)).statusCode).toBe(403);
      expect((await encoder.get(`/api/rpt/${name}${separator}format=csv`)).statusCode).toBe(403);
    }
  });
});
