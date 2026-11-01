/** A worker's own floor app sign-in (the owner's request, Nov 2026): a Production worker account linked to one employee. */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, encoderOwnDefaults, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { employeeOfUser } from '../public.ts';

let env: TestEnv;
let owner: Client;
let ana: string;
let ben: string;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await env.as('owner');
  const add = async (fullName: string) => (await owner.post('/api/emp/employees', { fullName, costCentre: 'production', hireDate: '2025-01-06' })).json().id as string;
  ana = await add('Ana Tahi');
  ben = await add('Ben Uy');
});

describe('floor app sign-ins', () => {
  it('links a Production worker account to one employee, unlinks it, and keeps the history', async () => {
    const sewer = createUser(env.db, 'ana.sewer', ['worker']);
    createUser(env.db, 'clerk', ['encoder']);
    const accounts = (await owner.get('/api/emp/floor-accounts')).json();
    expect(accounts.map((a: { username: string }) => a.username)).toEqual(['ana.sewer']); // workers only

    const res = await owner.put(`/api/emp/employees/${ana}/floor-user`, { userId: sewer });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().floorUser).toMatchObject({ userId: sewer, username: 'ana.sewer' });
    expect(employeeOfUser(env.db, sewer)).toMatchObject({ id: ana, name: 'Ana Tahi' });
    expect((await owner.get(`/api/emp/employees/${ana}`)).json().floorUser.username).toBe('ana.sewer');

    // One account, one employee at a time.
    expect((await owner.put(`/api/emp/employees/${ben}/floor-user`, { userId: sewer })).json().code).toBe('IN_USE');
    expect((await owner.put(`/api/emp/employees/${ana}/floor-user`, { userId: null })).json().floorUser).toBeNull();
    expect(employeeOfUser(env.db, sewer)).toBeNull();
    expect((await owner.put(`/api/emp/employees/${ben}/floor-user`, { userId: sewer })).statusCode).toBe(200);
    expect(env.db.prepare('SELECT COUNT(*) FROM emp_floor_users').pluck().get()).toBe(3);
  });

  it('refuses an account without the Production worker role, and someone without emp.manage', async () => {
    const clerk = createUser(env.db, 'clerk', ['encoder']);
    expect((await owner.put(`/api/emp/employees/${ana}/floor-user`, { userId: clerk })).json().code).toBe('NOT_A_WORKER');
    encoderOwnDefaults(env); // the encoder's own permissions, without the accountant's
    const encoder = await env.as('encoder');
    expect((await encoder.put(`/api/emp/employees/${ana}/floor-user`, { userId: null })).statusCode).toBe(403);
  });
});
