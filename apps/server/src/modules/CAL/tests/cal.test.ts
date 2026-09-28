import { describe, expect, it } from 'vitest';
import { createTestEnv, idem } from '../../../../test/helpers.ts';
import { seedCustomers } from '../../JO/tests/cus-fixture.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';
import { taxDeadlines } from '../../TAX/public.ts';
import type { CalItem } from '../calendar.ts';

const range = '/api/cal?from=2026-09-28&to=2026-10-31';

describe('CAL calendar', () => {
  it('puts every kind on its date, with source links and rush order marking', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const accountant = await env.as('accountant');
    const owner = await env.as('owner');
    const customer = seedCustomers(env.db, encoder.userId);
    env.db.prepare("UPDATE cus_people SET birthday = '2001-10-05' WHERE id = ?").run(customer.ari);
    const employeeId = addEmployee(env.db, 'Taylor Example');
    env.db.prepare("UPDATE emp_employees SET birthday = '1990-10-09' WHERE id = ?").run(employeeId);
    const holiday = await accountant.post('/api/emp/holidays', { date: '2026-10-06', name: 'Test Shop Holiday', kind: 'special', source: 'Made-up proclamation for this test' });
    expect(holiday.statusCode, holiday.body).toBe(200);
    const order = await encoder.post('/api/docs/jo.job_order/post', { input: {
      customerId: customer.school, dueInDays: 15, priority: 'rush', paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Made-up fitting shirts', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }],
    }, expectedTotalCents: 100_000 }, idem());
    expect(order.statusCode, order.body).toBe(200);
    const joId = order.json().id as string;
    for (const [from, to] of [['open', 'in_production'], ['in_production', 'ready']]) {
      expect((await encoder.post(`/api/jo/orders/${joId}/stage`, { from, to })).statusCode).toBe(200);
    }
    const release = await accountant.post('/api/jo/releases', { release: {
      jobOrderId: joId, lines: [{ lineNo: 1, qty: 1 }], claimedBy: 'Made-up claimant', idSeen: 'school_id',
      creditNote: 'Test balance paid next week', creditDueInDays: 7,
    }, invoice: null, expectedTotalCents: 100_000 }, idem());
    expect(release.statusCode, release.body).toBe(200);
    const event = await encoder.post('/api/cal/events', { title: 'Uniform fitting', date: '2026-10-07', time: '14:30', customerId: customer.school, jobOrderId: joId, notes: 'Bring sample sizes' });
    expect(event.statusCode, event.body).toBe(200);
    const res = await owner.get(range);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json() as CalItem[];
    const of = (kind: CalItem['kind']) => items.filter((i) => i.kind === kind);
    expect(of('event')).toContainEqual(expect.objectContaining({ date: '2026-10-07', title: 'Uniform fitting', href: `/docs/jo.job_order/${joId}`, time: '14:30' }));
    expect(of('job_due')).toHaveLength(0); // fully released orders are no longer open
    expect(of('release')).toContainEqual(expect.objectContaining({ date: '2026-09-28', href: expect.stringMatching(/^\/docs\/jo.release\//) }));
    expect(of('holiday')).toContainEqual(expect.objectContaining({ date: '2026-10-06', title: 'Test Shop Holiday' }));
    expect(of('customer_birthday')).toContainEqual(expect.objectContaining({ date: '2026-10-05', href: `/cus?customer=${customer.school}` }));
    expect(of('employee_birthday')).toContainEqual(expect.objectContaining({ date: '2026-10-09', href: `/emp/employees/${employeeId}` }));
    const deadline = taxDeadlines(env.db, '2026-09-28', '2026-10-31')[0]!;
    expect(of('tax')).toContainEqual(expect.objectContaining({ date: deadline.dueDate, href: '/tax/calendar' }));
    // Another open rush order keeps its due-date marker.
    const open = await encoder.post('/api/docs/jo.job_order/post', { input: {
      customerId: customer.school, dueInDays: 15, priority: 'rush', paymentTerms: 'dp50',
      lines: [{ kind: 'made_to_order', description: 'Made-up spare shirts', qty: 1, unitPriceCents: 100_000, discountCents: 0, roster: [] }],
    }, expectedTotalCents: 100_000 }, idem());
    expect(open.statusCode, open.body).toBe(200);
    expect((await owner.get(range)).json()).toContainEqual(expect.objectContaining({ kind: 'job_due', date: '2026-10-13', rush: true, href: `/docs/jo.job_order/${open.json().id}` }));
    env.db.close();
  });

  it('filters source kinds by exact view permissions', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const production = await env.as('production');
    const owner = await env.as('owner');
    const made = await encoder.post('/api/cal/events', { title: 'Sample fitting', date: '2026-10-07' });
    expect(made.statusCode, made.body).toBe(200);
    const productionItems = (await production.get(range)).json() as CalItem[];
    expect(productionItems.map((i) => i.kind)).toEqual(['event']);
    expect((await production.post('/api/cal/events', { title: 'No grant', date: '2026-10-08' })).statusCode).toBe(403);
    env.db.prepare("UPDATE role_permissions SET granted = 0 WHERE role_key = 'owner' AND permission_key = 'tax.calendar.view'").run();
    expect(((await owner.get(range)).json() as CalItem[]).some((i) => i.kind === 'tax')).toBe(false);
    env.db.close();
  });

  it('moves and cancels by adding rows, preserving the old versions', async () => {
    const env = await createTestEnv();
    const encoder = await env.as('encoder');
    const created = await encoder.post('/api/cal/events', { title: 'First fitting', date: '2026-10-07', time: '10:00' });
    expect(created.statusCode, created.body).toBe(200);
    const id = created.json().eventId as string;
    const moved = await encoder.post(`/api/cal/events/${id}/move`, { date: '2026-10-08', time: '13:00' });
    expect(moved.statusCode, moved.body).toBe(200);
    const afterMove = (await encoder.get(range)).json() as CalItem[];
    expect(afterMove.filter((i) => i.kind === 'event')).toEqual([expect.objectContaining({ date: '2026-10-08', time: '13:00' })]);
    const cancelled = await encoder.post(`/api/cal/events/${id}/cancel`, { reason: 'Customer asked to postpone indefinitely' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(((await encoder.get(range)).json() as CalItem[]).some((i) => i.kind === 'event')).toBe(false);
    const history = (await encoder.get(`/api/cal/events/${id}/history`)).json() as { action: string; date: string }[];
    expect(history.map((row) => [row.action, row.date])).toEqual([['create', '2026-10-07'], ['move', '2026-10-08'], ['cancel', '2026-10-08']]);
    expect((env.db.prepare('SELECT COUNT(*) FROM cal_events WHERE event_id = ?').pluck().get(id) as number)).toBe(3);
    expect((await encoder.post(`/api/cal/events/${id}/move`, { date: '2026-10-09' })).statusCode).toBe(409);
    env.db.close();
  });

  it('accepts 62 days and rejects 63 days or reversed dates', async () => {
    const env = await createTestEnv();
    const owner = await env.as('owner');
    expect((await owner.get('/api/cal?from=2026-10-01&to=2026-12-01')).statusCode).toBe(200);
    expect((await owner.get('/api/cal?from=2026-10-01&to=2026-12-02')).statusCode).toBe(400);
    expect((await owner.get('/api/cal?from=2026-10-02&to=2026-10-01')).statusCode).toBe(400);
    env.db.close();
  });
});
