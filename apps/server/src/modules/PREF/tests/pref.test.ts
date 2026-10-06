/** PREF: each person's own side-menu order, kept on the server; nobody else's is ever read or changed. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';

let env: TestEnv;
let owner: Client;
let encoder: Client;
beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  encoder = await env.as('encoder');
});

describe('menu order', () => {
  it('is the usual order until arranged, then each person gets back only their own', async () => {
    expect((await owner.get('/api/pref/menu')).json()).toEqual({ groups: [], items: {} });
    const mine = { groups: ['Sales', 'Overview'], items: { Sales: ['/pos', '/cus', '/docs/jo.job_order'] } };
    expect((await owner.put('/api/pref/menu', mine)).statusCode).toBe(200);
    expect((await owner.get('/api/pref/menu')).json()).toEqual(mine);
    expect((await encoder.get('/api/pref/menu')).json()).toEqual({ groups: [], items: {} });
    // Saving again replaces it; empty lists are "reset to default".
    await owner.put('/api/pref/menu', { groups: [], items: {} });
    expect((await owner.get('/api/pref/menu')).json()).toEqual({ groups: [], items: {} });
  });

  it('takes only group names and screen addresses, and needs a signed-in person', async () => {
    expect((await owner.put('/api/pref/menu', { groups: ['Sales'], items: { Sales: ['javascript:alert(1)'] } })).statusCode).toBe(400);
    expect((await owner.put('/api/pref/menu', { groups: ['Sales'], items: {}, userId: 'someone-else' })).statusCode).toBe(400);
    expect((await env.app.inject({ method: 'GET', url: '/api/pref/menu' })).statusCode).toBe(401);
  });
});
