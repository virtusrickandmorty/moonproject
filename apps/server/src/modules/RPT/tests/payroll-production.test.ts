import { afterEach, describe, expect, it } from 'vitest';
import type { TestEnv } from '../../../../test/helpers.ts';
import { runDoc } from '../../PAY/doctypes/run.ts';
import { world } from '../../PAY/tests/world.ts';

let env: TestEnv|undefined;
afterEach(async()=>{await env?.app.close();env=undefined;});

describe('payroll and production reports',()=>{
  it('register figures reconcile to the recorded payroll journal and export CSV',async()=>{
    const w=await world('2026-09-30');env=w.env;
    w.person('Mila Sample',{payType:'monthly',payGroup:'SEMI_MONTHLY',monthlyRateCents:1_500_000},{costCentre:'office'});
    const run=w.record(runDoc,{payGroup:'SEMI_MONTHLY',periodStart:'2026-09-16'});
    const owner=await env.as('owner');
    const response=await owner.get('/api/rpt/payroll-register?month=2026-09');
    expect(response.statusCode,response.body).toBe(200);
    const report=response.json();expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({documentId:run.id,grossCents:750000});
    const credit=report.totals.netCents+report.totals.employeeSharesCents+report.totals.employerSharesCents+
      report.totals.taxCents+report.totals.loanCents+report.totals.caCents+report.rows[0].accruedCents;
    const journalCredit=env.db.prepare(`SELECT SUM(l.credit_cents) FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.source_id=? AND j.posting_kind='original'`).pluck().get(run.id);
    expect(credit).toBe(journalCredit);
    const exported=await owner.get('/api/rpt/payroll-register?month=2026-09&format=csv');
    expect(exported.statusCode).toBe(200);expect(exported.headers['content-type']).toContain('text/csv');expect(exported.body).toContain(`/docs/pay.run/${run.id}`);
    const tv=await env.as('tv');expect((await tv.get('/api/rpt/payroll-register?month=2026-09')).statusCode).toBe(403);
  });

  it('all production reports export CSV and reject a role without production access',async()=>{
    const w=await world('2026-09-30');env=w.env;const owner=await env.as('owner'),tv=await env.as('tv');
    for(const route of ['production-board','production-activity?from=2026-09-01&to=2026-09-30','production-timing?asOf=2026-09-30']){
      const separator=route.includes('?')?'&':'?';const response=await owner.get(`/api/rpt/${route}${separator}format=csv`);
      expect(response.statusCode,response.body).toBe(200);expect(response.headers['content-type']).toContain('text/csv');
      expect((await tv.get(`/api/rpt/${route}`)).statusCode).toBe(403);
    }
  });
});
