import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, id, invalid } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { BulkStatementsTab, SettingsTab } from './Communications.tsx';
vi.mock('../RPT/Books.tsx', () => ({ useToday: () => '2026-10-05' }));
afterEach(() => vi.restoreAllMocks());
const settings = { version: 2, appPasswordSet: false, sendingOn: false, missing: [] };
it('email settings put an invalid sender address on its own box', () => {
  const f = form(() => SettingsTab(), [settings]); change(f.field('Sender address'), 'bad'); blur(f.field('Sender address')); invalid(f, 'Sender address');
});
it('email settings Save keeps the raw strings, numeric port, password omission and version', async () => {
  const save = vi.spyOn(api, 'comSaveSettings').mockResolvedValue(settings as never);
  const f = form(() => SettingsTab(), [settings]); change(f.field('Mail server'), ' smtp.example.test '); change(f.field('Port'), '465');
  change(f.field('User name'), ' non-email-user '); change(f.field('Sender name'), ' Sample shop '); change(f.field('Sender address'), ' sample@example.test ');
  await f.find('children', 'Save').props.onClick();
  expect(save).toHaveBeenLastCalledWith(2, { sendingOn: false, host: ' smtp.example.test ', port: 465, user: ' non-email-user ', senderName: ' Sample shop ', senderAddress: ' sample@example.test ' });
});
it('statement dates put nonexistent dates on Statement date', () => {
  const f = form(() => BulkStatementsTab()); change(f.field('Statement date'), '2026-02-30'); blur(f.field('Statement date')); invalid(f, 'Statement date');
});
it('statement Show keeps its date and Send keeps the selected customer order and refresh step', async () => {
  const data = { eligible: [], excluded: [] };
  const show = vi.spyOn(api, 'comBulkStatements').mockResolvedValue(data as never);
  const send = vi.spyOn(api, 'comSendBulkStatements').mockResolvedValue({ queued: 2 });
  const f = form(() => BulkStatementsTab(), ['2026-10-04']); await f.find('children', 'Show customers').props.onClick(); expect(show).toHaveBeenLastCalledWith('2026-10-04');
  const queue = form(() => BulkStatementsTab(), ['2026-10-04', data, new Set([id(2), id(1)])]); queue.find('children', 'Send 2 statements').props.onClick(); await Promise.resolve();
  expect(send).toHaveBeenLastCalledWith('2026-10-04', [id(2), id(1)]); expect(show.mock.invocationCallOrder.at(-1)).toBeGreaterThan(send.mock.invocationCallOrder.at(-1)!);
});
