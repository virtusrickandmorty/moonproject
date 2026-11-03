/**
 * Employees' birthdays in the owner's bell (the owner's request, Nov 2026): three days ahead, then on the day, from each
 * employee record; active employees only, made-up people.
 */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type Client, type TestEnv } from '../../../../test/helpers.ts';
import { addEmployee } from '../../EMP/tests/fixture.ts';

let env: TestEnv;
let owner: Client;
beforeEach(async () => {
  env = await createTestEnv('2026-09-28T02:00:00Z'); // Monday 28 September 2026, 10 AM in Manila
  owner = await env.as('owner');
});

const born = (name: string, birthday: string | null, o: { separatedOn?: string } = {}) => {
  const id = addEmployee(env.db, name, o);
  env.db.prepare('UPDATE emp_employees SET birthday = ? WHERE id = ?').run(birthday, id);
  return id;
};
/** A day later the sign-in has timed out (60 minutes idle): sign in again. */
const dayOf = async (iso: string) => { env.clock.set(iso); owner = await env.as('owner'); };
const birthdays = async (who: Client) => ((await who.get('/api/dash/notifications')).json() as { kind: string; id: string; label: string; href?: string; detail?: string }[])
  .filter((n) => n.kind.startsWith('emp-birthday'));

it("tells the owner about each employee's birthday three days ahead and on the day, and nobody else", async () => {
  const ben = born('Ben Uy', '1985-09-28');
  const ana = born('Ana Tahi', '1990-09-30');
  born('Cara Lim', '2000-10-15'); // too far ahead
  born('Dan Cruz', '1980-09-28', { separatedOn: '2026-06-30' }); // no longer with the shop
  born('Eve Sy', null); // no birthday on the record

  expect(await birthdays(owner)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'emp-birthday', id: `emp-birthday:${ben}:2026-09-28`, label: "Today is Ben Uy's birthday", href: `/emp/employees/${ben}`, detail: 'Turns 41' }),
    expect.objectContaining({ kind: 'emp-birthday-soon', id: `emp-birthday-soon:${ana}:2026-09-30`, label: "Ana Tahi's birthday is on Wednesday, September 30", detail: 'Wednesday, September 30 · Turns 36' }),
  ]));
  expect(await birthdays(owner)).toHaveLength(2);
  // The encoder and the accountant see employees, but the birthday notices are the owner's.
  for (const role of ['encoder', 'accountant'] as const) expect(await birthdays(await env.as(role))).toEqual([]);

  // A day later: Ana's is tomorrow and Ben's has gone; on the day itself, Ana's own notice.
  await dayOf('2026-09-29T02:00:00Z');
  expect((await birthdays(owner)).map((n) => n.label)).toEqual(["Ana Tahi's birthday is tomorrow"]);
  await dayOf('2026-09-30T02:00:00Z');
  expect((await birthdays(owner)).map((n) => n.label)).toEqual(["Today is Ana Tahi's birthday"]);
});

it('counts across the new year, and keeps a 29 February birthday on the 28th in other years', async () => {
  const leap = born('Lea Ramos', '2000-02-29');
  const january = born('Jun Reyes', '1999-01-01');
  await dayOf('2026-12-30T02:00:00Z');
  expect(await birthdays(owner)).toEqual([expect.objectContaining({ id: `emp-birthday-soon:${january}:2027-01-01`, label: "Jun Reyes's birthday is on Friday, January 1", detail: 'Friday, January 1 · Turns 28' })]);
  await dayOf('2027-02-28T02:00:00Z');
  expect(await birthdays(owner)).toEqual([expect.objectContaining({ id: `emp-birthday:${leap}:2027-02-28`, label: "Today is Lea Ramos's birthday", detail: 'Turns 27' })]);
});
