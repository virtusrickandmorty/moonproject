import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../../platform/db/driver.ts';
import { createTestEnv, type TestEnv, encoderOwnDefaults } from '../../../../test/helpers.ts';

let env: TestEnv | undefined;
afterEach(async () => { await env?.app.close(); env = undefined; });

function shop(db: Db, userId: string) {
  const at = '2026-09-28T10:00:00+08:00';
  const customer = (id: string, name: string, terms: number) => db.prepare(
    'INSERT INTO cus_customers (id, code, kind, display_name, credit_terms_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, id, 'organization', name, terms, at, at);
  customer('c-one', 'Example School', 15);
  customer('c-two', 'Sample Club', 30);
  const doc = (id: string, type: string, date: string, amount: number) => db.prepare(
    `INSERT INTO documents (id, doc_type, module, series_key, number, business_date, status, total_cents, summary, posted_at, posted_by)
      VALUES (?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)`,
  ).run(id, type, type.split('.')[0]!.toUpperCase(), type, id, date, amount, 'Made-up test document', at, userId);
  doc('jo-one', 'jo.job_order', '2026-07-20', 15000);
  doc('jo-two', 'jo.job_order', '2026-09-10', 3000);
  db.prepare(`INSERT INTO jo_orders (document_id, customer_id, customer_name, due_date, priority, payment_terms, required_dp_cents)
    VALUES (?, ?, ?, ?, 'normal', 'net15', 0)`).run('jo-one', 'c-one', 'Example School', '2026-08-01');
  db.prepare(`INSERT INTO jo_orders (document_id, customer_id, customer_name, due_date, priority, payment_terms, required_dp_cents)
    VALUES (?, ?, ?, ?, 'normal', 'net30', 0)`).run('jo-two', 'c-two', 'Sample Club', '2026-09-20');
  for (const [release, jo, date] of [['release-one', 'jo-one', '2026-08-01'], ['release-two', 'jo-two', '2026-09-20']] as const) {
    doc(release, 'jo.release', date, 0);
    db.prepare(`INSERT INTO jo_releases (document_id, job_order_id, claimed_by, id_seen, balance_due_cents)
      VALUES (?, ?, 'Test buyer', 'none', 0)`).run(release, jo);
  }
  const invoice = (id: string, release: string, jo: string, customerId: string, customerName: string, date: string, amount: number) => {
    doc(id, 'jo.invoice_record', date, amount);
    db.prepare(`INSERT INTO jo_invoice_records (document_id, release_id, job_order_id, customer_id, customer_name,
      invoice_number, vat_rate_bp, deposit_vat_mode, list_cents, discount_cents, gross_cents, vat_cents,
      discount_net_cents, sales_mto_cents, sales_rtw_cents, sales_service_cents, deposit_applied_cents)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'A', ?, 0, ?, 0, 0, ?, 0, 0, 0)`)
      .run(id, release, jo, customerId, customerName, id === 'invoice-one' ? '10001' : '10002', amount, amount, amount);
  };
  invoice('invoice-one', 'release-one', 'jo-one', 'c-one', 'Example School', '2026-08-01', 10000);
  invoice('invoice-two', 'release-two', 'jo-two', 'c-two', 'Sample Club', '2026-09-20', 3000);
  doc('collection-one', 'col.collection', '2026-09-15', 4000);
  doc('deposit-one', 'col.collection', '2026-09-18', 2000);
  const account = (role: string) => (db.prepare('SELECT id FROM accounts WHERE role_key = ?').get(role) as { id: number }).id;
  const ar = account('AR_TRADE'); const deposits = account('CUSTOMER_DEPOSITS');
  const cash = (db.prepare("SELECT id FROM accounts WHERE is_cash_place = 1 AND is_postable = 1 LIMIT 1").get() as { id: number }).id;
  const sales = (db.prepare("SELECT id FROM accounts WHERE type = 'revenue' AND is_postable = 1 LIMIT 1").get() as { id: number }).id;
  const journal = (id: string, date: string, customerId: string, jo: string, debit: [number, number], credit: [number, number]) => {
    const sourceId = ({ 'j-invoice-one': 'invoice-one', 'j-collection': 'collection-one',
      'j-deposit': 'deposit-one', 'j-invoice-two': 'invoice-two' } as Record<string, string>)[id]!;
    db.prepare(`INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, memo, created_at, created_by)
      VALUES (?, ?, ?, 'document', ?, 'original', 'Made-up shop', ?, ?)`).run(id, id, date, sourceId, at, userId);
    db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
      VALUES (?, 1, ?, 'customer', ?, ?, 0, ?)`).run(id, debit[0], customerId, debit[1], jo);
    db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
      VALUES (?, 2, ?, 'customer', ?, 0, ?, ?)`).run(id, credit[0], customerId, credit[1], jo);
    db.prepare('UPDATE journals SET sealed = 1 WHERE id = ?').run(id);
  };
  journal('j-invoice-one', '2026-08-01', 'c-one', 'jo-one', [ar, 10000], [sales, 10000]);
  journal('j-collection', '2026-09-15', 'c-one', 'jo-one', [cash, 4000], [ar, 4000]);
  journal('j-deposit', '2026-09-18', 'c-one', 'jo-one', [cash, 2000], [deposits, 2000]);
  journal('j-invoice-two', '2026-09-20', 'c-two', 'jo-two', [ar, 3000], [sales, 3000]);
  return { arCode: (db.prepare('SELECT code FROM accounts WHERE id = ?').get(ar) as { code: string }).code };
}

describe('customer receivables reports', () => {
  it('ages invoice records, keeps uninvoiced orders as memo, and ties to the trial balance', async () => {
    env = await createTestEnv(); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    expect((await owner.get('/api/doc-types')).json().some((type: { key: string }) => type.key === 'jo.invoice_record')).toBe(true);
    const { arCode } = shop(env.db, owner.userId);
    const aging = await owner.get('/api/rpt/ar-aging?asOf=2026-09-28');
    expect(aging.statusCode).toBe(200);
    expect(aging.json().rows).toHaveLength(2);
    expect(aging.json().buckets.days31to60).toBe(6000);
    expect(aging.json().buckets.current).toBe(3000);
    expect(aging.json().memoTotalCents).toBe(5000);
    const beforeCollection = await owner.get('/api/rpt/ar-aging?asOf=2026-08-31');
    expect(beforeCollection.json().totalCents).toBe(10000);
    const trial = await owner.get('/api/rpt/trial-balance?asOf=2026-09-28');
    expect(trial.statusCode).toBe(200);
    const ar = trial.json().rows.find((row: { code: string }) => row.code === arCode);
    expect(aging.json().totalCents).toBe(ar.debitCents - ar.creditCents);
  });

  it("ages an old job order's receivable opened at the cut-over from its due date", async () => {
    env = await createTestEnv(); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    shop(env.db, owner.userId);
    const db = env.db;
    const at = '2026-09-28T10:00:00+08:00';
    db.prepare(`INSERT INTO documents (id, doc_type, module, series_key, number, business_date, status, total_cents, summary, posted_at, posted_by)
      VALUES ('jo-old', 'jo.opening', 'JO', 'OBJO', 'OBJO-000001', '2026-09-01', 'posted', 7000, 'Made-up opening', ?, ?)`).run(at, owner.userId);
    db.prepare(`INSERT INTO jo_orders (document_id, customer_id, customer_name, due_date, priority, payment_terms, required_dp_cents)
      VALUES ('jo-old', 'c-two', 'Sample Club', '2026-07-15', 'normal', 'net15', 0)`).run();
    const role = (r: string) => (db.prepare('SELECT id FROM accounts WHERE role_key = ?').get(r) as { id: number }).id;
    db.prepare(`INSERT INTO journals (id, number, business_date, source_type, source_id, posting_kind, memo, created_at, created_by)
      VALUES ('j-old', 'j-old', '2026-09-01', 'document', 'jo-old', 'original', 'Made-up opening', ?, ?)`).run(at, owner.userId);
    db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, party_type, party_id, debit_cents, credit_cents, ref_doc_id)
      VALUES ('j-old', 1, ?, 'customer', 'c-two', 7000, 0, 'jo-old')`).run(role('AR_TRADE'));
    db.prepare(`INSERT INTO journal_lines (journal_id, line_no, account_id, debit_cents, credit_cents) VALUES ('j-old', 2, ?, 0, 7000)`).run(role('OPENING_EQUITY'));
    db.prepare("UPDATE journals SET sealed = 1 WHERE id = 'j-old'").run();
    const aging = (await owner.get('/api/rpt/ar-aging?asOf=2026-09-28')).json();
    const old = aging.rows.find((r: { documentNumber: string }) => r.documentNumber === 'OBJO-000001');
    expect(old).toMatchObject({ dueDate: '2026-07-15', totalCents: 7000, buckets: { days61to90: 7000, current: 0 } });
    expect(aging.buckets.current).toBe(3000);
  });

  it('shows opening, document movements, running balance and held deposits; exports CSV', async () => {
    env = await createTestEnv(); encoderOwnDefaults(env);
    const owner = await env.as('owner');
    shop(env.db, owner.userId);
    const url = '/api/rpt/customer-statement?customerId=c-one&from=2026-09-01&to=2026-09-28';
    const result = await owner.get(url);
    expect(result.statusCode).toBe(200);
    expect(result.json().openingBalanceCents).toBe(10000);
    expect(result.json().closingBalanceCents).toBe(6000);
    expect(result.json().depositsHeldCents).toBe(2000);
    expect(result.json().depositLines[0].runningHeldCents).toBe(2000);
    expect(result.json().lines[0].runningBalanceCents).toBe(6000);
    expect(result.json().lines[0].documentType).toBe('col.collection');
    const statementCsv = await owner.get(`${url}&format=csv`);
    expect(statementCsv.headers['content-type']).toContain('text/csv');
    expect(statementCsv.body).toContain('Opening balance');
    expect(statementCsv.body).toContain('Deposits held');
    const agingCsv = await owner.get('/api/rpt/ar-aging?asOf=2026-09-28&format=csv');
    expect(agingCsv.body).toContain('Uninvoiced job orders');
    expect(agingCsv.body).toContain('60.00');
  });

  it('denies both reports and CSV to a role without book permission', async () => {
    env = await createTestEnv(); encoderOwnDefaults(env);
    const encoder = await env.as('encoder');
    for (const url of ['/api/rpt/ar-aging?asOf=2026-09-28', '/api/rpt/ar-aging?asOf=2026-09-28&format=csv',
      '/api/rpt/customer-statement?customerId=c-one&from=2026-09-01&to=2026-09-28',
      '/api/rpt/customer-statement?customerId=c-one&from=2026-09-01&to=2026-09-28&format=csv']) {
      expect((await encoder.get(url)).statusCode).toBe(403);
    }
  });
});
