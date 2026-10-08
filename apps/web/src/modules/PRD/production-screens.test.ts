/** The production screens' rules (board columns and filters, entry rows), and their web client calls against the real server. */
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PASSWORD, createTestEnv, createUser } from '../../../../server/test/helpers.ts';
import { SESSION_COOKIE } from '../../../../server/src/engine/security/sessions.ts';
import { seedCustomers } from '../../../../server/src/modules/JO/tests/cus-fixture.ts';
import { seedEmployees } from '../../../../server/src/modules/PRD/tests/emp-fixture.ts';
import { createApi, newIdempotencyKey as key, type BoardCard, type PrdStep } from '../../api.ts';
import { buildMenu } from '../../shell/menu.ts';
import { columns, emptyRow, filterCards, rowsToInput } from './board.ts';

const injectFetch = (app: FastifyInstance, jar = { cookie: '' }) => async (url: string, init: RequestInit) => {
  const res = await app.inject({ method: init.method as 'GET', url, payload: init.body as string, headers: { ...(init.headers as object), cookie: jar.cookie } });
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (set) jar.cookie = set.value ? `${set.name}=${set.value}` : '';
  return new Response(res.body || null, { status: res.statusCode });
};

describe('production screen rules', () => {
  const step = (id: number, name: string, isActive = true) => ({ id, code: name.toUpperCase(), name, seq: id * 10, payBasis: 'daily', isActive, version: 1 }) as PrdStep;
  const card = (n: string, extra: Partial<BoardCard>) => ({ jobOrderId: n, number: n, customerName: 'C', dueDate: '2026-10-01', priority: 'normal', stage: 'open', lineNo: 1, description: 'Shirt', qty: 10, releasedQty: 0, garmentType: null, complexity: null, templateId: null, currentStepId: null, ready: false, steps: null, ...extra }) as BoardCard;

  it('columns: needs a route, the steps cards are at in canonical order, ready; empty ones left out', () => {
    const cards = [card('A', {}), card('B', { currentStepId: 4, steps: [] }), card('C', { currentStepId: 3, steps: [] }), card('D', { ready: true, steps: [] })];
    const steps = [step(1, 'Cutting'), step(2, 'Sewing'), step(3, 'QC', false), step(4, 'Packing')];
    expect(columns(steps, cards).map((c) => [c.title, c.cards.map((x) => x.number).join('')])).toEqual([['Choose production steps', 'A'], ['QC', 'C'], ['Packing', 'B'], ['Ready', 'D']]);
    expect(columns(steps, [])).toEqual([]);
  });

  it('filters: overdue, due within 7 days, rush only', () => {
    const cards = [card('late', { dueDate: '2026-09-27' }), card('soon', { dueDate: '2026-10-05', priority: 'rush' }), card('later', { dueDate: '2026-10-06' })];
    const n = (f: Parameters<typeof filterCards>[1]) => filterCards(cards, f, '2026-09-28').map((c) => c.number);
    expect(n({ due: 'overdue', rushOnly: false })).toEqual(['late']);
    expect(n({ due: 'week', rushOnly: false })).toEqual(['late', 'soon']);
    expect(n({ due: 'all', rushOnly: true })).toEqual(['soon']);
  });

  it('entry rows: blank rows left out; whole pieces; a typed rate goes with its reason; rework takes the price list rate', () => {
    expect(rowsToInput([{ lineNo: '1', employeeId: 'e1', pieces: '12', rework: false, rate: '', rateReason: '' }, emptyRow('1'), { lineNo: '1', employeeId: 'e2', pieces: '3', rework: true, rate: '20', rateReason: ' Pasubra ' }])).toEqual({
      rows: [{ lineNo: 1, employeeId: 'e1', pieces: 12 }, { lineNo: 1, employeeId: 'e2', pieces: 3, rework: true, rateCents: 2_000, rateReason: 'Pasubra' }],
      errors: [],
    });
    expect(rowsToInput([{ lineNo: '', employeeId: '', pieces: '2.5', rework: true, rate: '', rateReason: '' }, { lineNo: '1', employeeId: 'e', pieces: '1', rework: false, rate: 'x', rateReason: '' }]).errors).toEqual([
      'Row 1: pick the line.', 'Row 1: pick the worker.', 'Row 1: type the pieces as a whole number like 12.',
      'Row 2: type the rate like 45.00', 'Row 2: say why this rate is typed.',
    ]);
    expect(rowsToInput([emptyRow()]).errors).toEqual(['Add a worker and the pieces done.']);
  });

  it('the menu shows the board and piece rates under Production, by permission', () => {
    const labels = (perms: string[]) => buildMenu([], new Set(perms)).map((g) => `${g.group}: ${g.items.map((i) => i.label).join(', ')}`);
    expect(labels(['prd.view', 'rate.view'])).toEqual(['Overview: Home', 'Production: Production board',
      'Accounting & Tax: Settings', 'Reports: Production status counts, Production throughput, Job order lead time, Late job orders, Worker output',
      'Admin: Shop certificate, Practice shop']);
    expect(labels(['rate.view'])).toEqual(['Overview: Home', 'Accounting & Tax: Settings', 'Admin: Shop certificate, Practice shop']); // piece rates are on the price list now
    const entries = buildMenu([{ key: 'prd.entry', module: 'PRD', title: 'Production Entry' } as never], new Set());
    expect(entries.find((g) => g.group === 'Production')!.items.map((i) => i.label)).toEqual(['Production Entries']);
  });
});

describe('web client for production and piece rates', () => {
  it('route setup, board, pieces recorded, step completed; rates listed and a new rate set', async () => {
    const env = await createTestEnv();
    const c = seedCustomers(env.db, createUser(env.db, 'owner1', ['owner']));
    const w = seedEmployees(env.db);
    const api = createApi(injectFetch(env.app));
    await api.login('owner1', PASSWORD);
    const jo = await api.post('jo.job_order', { customerId: c.school, dueInDays: 10, priority: 'rush', paymentTerms: 'full', lines: [{ kind: 'made_to_order', description: 'Team shirt', qty: 30, unitPriceCents: 30_000, discountCents: 0, roster: [] }] }, 900_000, key());

    const cat = await api.prdCatalogue();
    const t1 = cat.templates.find((t) => t.code === 'T1')!;
    await api.prdSetup(jo.id, 1, { templateId: t1.id, stepIds: t1.stepIds, garmentType: 'T-shirt', complexity: 'standard' });
    const [first] = await api.prdBoard();
    expect(first).toMatchObject({ number: 'JO-000001', priority: 'rush', currentStepId: t1.stepIds[0], ready: false });

    const input = { jobOrderId: jo.id, stepId: t1.stepIds[0], rows: rowsToInput([{ lineNo: '1', employeeId: w.cutter, pieces: '30', rework: false, rate: '', rateReason: '' }]).rows };
    const pre = await api.preview('prd.entry', input);
    expect([pre.totalCents, pre.issues]).toEqual([24_000, []]); // T-shirt cutting ₱8.00 × 30
    expect((await api.post('prd.entry', input, pre.totalCents, key())).number).toBe('PE-000001');
    await api.prdStep(jo.id, 1, t1.stepIds[0]!, 'complete');
    const job = await api.prdJob(jo.id);
    expect(job.jobOrder.stage).toBe('in_production');
    expect(job.lines[0]!.route!.map((s) => [s.code, s.status, s.availablePieces])).toEqual([['CUTTING', 'completed', 30], ['SEWING', 'pending', 30], ['PACKING', 'pending', 0]]);
    expect((await api.prdWorkers()).map((x) => x.name)).toContain('Dana Cutter');

    const rates = await api.rates();
    expect(rates.current.find((r) => r.garmentType === 'T-shirt' && r.stepCode === 'CUTTING')?.rateCents).toBe(800);
    const set = await api.addRate({ garmentType: 'T-shirt', stepCode: 'CUTTING', complexity: 'standard', rateCents: 900, effectiveFrom: rates.asOf, reason: 'Owner raised the cutting rate' });
    expect(set).toMatchObject({ rateCents: 900, effectiveFrom: '2026-09-28' });
    expect((await api.rates()).current.find((r) => r.garmentType === 'T-shirt' && r.stepCode === 'CUTTING')?.rateCents).toBe(900);
  });
});
