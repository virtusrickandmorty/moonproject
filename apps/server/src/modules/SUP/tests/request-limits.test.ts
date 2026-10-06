import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
beforeEach(async () => { env = await createTestEnv(); });
afterEach(async () => { await env.app.close(); env.db.close(); });

describe('public support request limits', () => {
  it('counts refused forms before parsing, separates addresses, and leaves the staff inbox available', async () => {
    const staff = await env.as('owner');
    const send = (address = '127.0.0.1') => env.app.inject({ method: 'POST', url: '/api/sup/messages', remoteAddress: address,
      headers: { 'content-type': 'application/json' }, payload: '{' });
    for (let i = 0; i < 30; i++) expect((await send()).statusCode).toBe(400);
    expect((await send()).json()).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Try again in a few minutes.' });
    expect((await send()).statusCode).toBe(429);
    expect((await send('10.20.0.2')).statusCode).toBe(400);
    const limit = Math.ceil(4 * 1024 * 1024 / 3) * 4 * 5 + 64 * 1024;
    const oversized = await env.app.inject({ method: 'POST', url: '/api/sup/messages', remoteAddress: '10.20.0.2',
      headers: { 'content-type': 'application/json', 'content-length': String(limit + 1) }, payload: '{' });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().code).toBe('FST_ERR_CTP_BODY_TOO_LARGE');
    for (let i = 0; i < 31; i++) expect((await staff.get('/api/sup/messages')).statusCode).toBe(200);
    env.clock.advance(5 * 60_000);
    expect((await send()).statusCode).toBe(400);
  });
});
