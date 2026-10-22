/** The job ticket shows a measured wearer's measurements (the owner's request, Oct 2026): the ones the job order was made with. */
import { beforeEach, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../../../../test/helpers.ts';
import { renderPrint, type Profile } from '../print.ts';

let env: TestEnv;
const profile: Profile = { registered_name: 'Example Garments Corp.', trade_name: 'Example Garments', tin: '000-111-222',
  registered_address: '1 Sample Street, Manila', is_vat_registered: 1, version: 1 };
beforeEach(async () => { env = await createTestEnv(); });

it('prints each measured wearer\'s measurements under the wearers, from the chart the job order recorded', async () => {
  const encoder = await env.as('encoder');
  const customer = (await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Sample School' })).json();
  const person = (await encoder.post(`/api/cus/customers/${customer.id}/people`, { fullName: 'Ana Reyes' })).json();
  const first = (await encoder.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'measured', values: { shoulder: 15.5, chest: 34.25, sleeveLength: 22 }, remarks: 'Long torso' })).json();
  // Measured again after the job order: the ticket keeps the first chart.
  const again = await encoder.post(`/api/cus/people/${person.id}/measurements`, { sizeMode: 'measured', values: { shoulder: 16, chest: 35 }, reason: 'Rechecked at fitting' });
  expect(again.statusCode, again.body).toBe(200);

  const roster = [
    { wearerName: 'Ana Reyes', sizeMode: 'measured', chartId: first.id, jerseyName: 'REYES', jerseyNumber: '7', qty: 1, garmentType: null },
    { wearerName: 'Ben Cruz', sizeMode: 'preset', size: 'M', chartId: null, jerseyName: 'CRUZ', jerseyNumber: '9', qty: 1, garmentType: null },
  ];
  const ticket = renderPrint(env.db, { id: 'no-such-order', number: 'JO-000001', business_date: '2026-09-28', doc_type: 'jo.job_order', status: 'posted' },
    { customerName: 'Sample School', dueDate: '2026-10-13', priority: 'normal', lines: [{ lineNo: 1, description: 'Uniform blouse', qty: 2, roster }] },
    profile, 'job_ticket', 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
  expect(ticket).toContain('Measured (below)');
  expect(ticket).toContain('<h3>Measurements</h3>');
  expect(ticket).toContain('<b>Ana Reyes</b> <span class="unit">(inches)</span>: Shoulder <b>15.5</b> · Chest <b>34.25</b> · Sleeve length <b>22</b> <i>Remarks: Long torso</i>');
  expect(ticket).not.toContain('Shoulder <b>16</b>');
  expect(ticket.match(/<b>Ben Cruz<\/b>/g)).toBeNull(); // a wearer with a size has no measurements block
});

it('prints no measurements block when nobody on the line is measured', async () => {
  const ticket = renderPrint(env.db, { id: 'no-such-order', number: 'JO-000002', business_date: '2026-09-28', doc_type: 'jo.job_order', status: 'posted' },
    { customerName: 'Sample School', dueDate: '2026-10-13', priority: 'normal', lines: [{ lineNo: 1, description: 'Team shirt', qty: 1,
      roster: [{ wearerName: 'Ben Cruz', sizeMode: 'preset', size: 'M', chartId: null, qty: 1 }] }] },
    profile, 'job_ticket', 'Example Owner', '2026-09-28T10:00:00+08:00', 1);
  expect(ticket).not.toContain('<h3>Measurements</h3>');
});
