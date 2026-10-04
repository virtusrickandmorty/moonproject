/**
 * A form the server refuses says which boxes were wrong, so the screen can mark each one red: the same details a document's
 * own check gives, for the forms that are not documents (customers here).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from './helpers.ts';

let env: TestEnv;
let owner: Client;

beforeAll(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
});

afterAll(async () => {
  await env.app.close();
});

describe('refused input', () => {
  it('names each refused box and why', async () => {
    const res = await owner.post('/api/cus/customers', { kind: 'organization', displayName: '', email: 'not an email' });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string; message: string; details: { field: string; message: string }[] };
    expect(body).toMatchObject({ code: 'INVALID_INPUT', message: 'Some fields are missing or not allowed.' });
    expect(body.details.map((d) => d.field).sort()).toEqual(['displayName', 'email']);
    expect(body.details.every((d) => d.message.length > 0)).toBe(true);
  });

  it('records nothing when it refuses', async () => {
    const before = env.db.prepare('SELECT COUNT(*) FROM cus_customers').pluck().get();
    await owner.post('/api/cus/customers', { kind: 'nobody', displayName: 'Maria' });
    expect(env.db.prepare('SELECT COUNT(*) FROM cus_customers').pluck().get()).toBe(before);
  });
});
