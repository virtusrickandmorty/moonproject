import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { PART_K_DECISIONS } from '../go-live-decisions.ts';

let env: TestEnv, accountant: Client, owner: Client, encoder: Client, production: Client;
beforeEach(async () => { env = await createTestEnv(); [accountant, owner, encoder, production] = await Promise.all([env.as('accountant'), env.as('owner'), env.as('encoder'), env.as('production')]); });
const get = (c = accountant) => c.get('/api/acc/go-live-decisions');
const answer = (c: Client, decisionId: string, value: string) => c.post('/api/acc/go-live-decisions/answers', { decisionId, answer: value, decidedBy: 'Sample Accountant', decidedOn: '2026-09-28', note: 'Confirmed for the test shop' });

describe('go-live decision register', () => {
  it('has every Part K ID and each B4 go-live requirement', async () => {
    const plan = readFileSync(new URL('../../../../../../docs/PLAN.md', import.meta.url), 'utf8');
    const partK = plan.slice(plan.indexOf('# K. Decision register'), plan.indexOf('\n---\n\n# L.'));
    const ids = [...partK.matchAll(/^\| ((?:ACC|OWN|CO)-\d+b?) \|/gm)].map((m) => m[1]);
    expect(PART_K_DECISIONS.map((d) => d.id)).toEqual(ids);
    const body = (await get()).json();
    expect(body.rows.filter((r: { id: string }) => r.id.startsWith('LIVE-')).map((r: { question: string }) => r.question)).toEqual(expect.arrayContaining([
      expect.stringContaining('Must-tier'), expect.stringContaining('blind recompute'), expect.stringContaining('import rehearsal'), expect.stringContaining('restore drill'), expect.stringContaining('test-printed'), expect.stringContaining('opening trial balance'),
    ]));
    expect(body.open).toBe(ids.length + 6);
  });
  it('keeps history while the newest answer supersedes, and audits both', async () => {
    expect((await answer(accountant, 'ACC-01', 'B')).statusCode).toBe(200);
    const second = await answer(owner, 'ACC-01', 'A, after accountant review');
    expect(second.statusCode, second.body).toBe(200);
    const row = second.json().rows.find((r: { id: string }) => r.id === 'ACC-01');
    expect(row.history.map((h: { answer: string }) => h.answer)).toEqual(['A, after accountant review', 'B']);
    expect(second.json().open).toBe(PART_K_DECISIONS.length + 5);
    expect(env.db.prepare("SELECT COUNT(*) FROM audit_log WHERE action='acc.golive.answer'").pluck().get()).toBe(2);
    expect(() => env.db.prepare("UPDATE acc_go_live_answers SET answer='changed'").run()).toThrow(/IMMUTABLE/);
    expect(() => env.db.prepare('DELETE FROM acc_go_live_answers').run()).toThrow();
  });
  it('warns when ACC-02 differs from its effective setting', async () => {
    expect((await answer(accountant, 'ACC-02', 'B')).statusCode).toBe(200);
    const row = (await get()).json().rows.find((r: { id: string }) => r.id === 'ACC-02');
    expect(row.setting).toMatchObject({ key: 'sales.deposit_vat_mode', value: 'A', words: 'A', matches: false });
  });
  it('allows only owner and accountant roles', async () => {
    for (const c of [encoder, production]) { expect((await get(c)).statusCode).toBe(403); expect((await answer(c, 'CO-01', 'Done')).statusCode).toBe(403); }
    expect((await get(owner)).statusCode).toBe(200);
  });
});
