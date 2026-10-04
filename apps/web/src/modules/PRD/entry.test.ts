import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { change, form, type } from '../PAY/entry-test.ts';
import { api, type PrdJob, type Preview } from '../../api.ts';
import { EntryForm } from './EntryForm.tsx';
import { emptyRow } from './board.ts';

afterEach(() => vi.restoreAllMocks());
const mode = { kind: 'new' } as const;
const job = { jobOrder: { number: 'JO-1' }, lines: [{ lineNo: 1, description: 'Sample shirt', qty: 12, route: [{ id: 1, name: 'Sew', seq: 1, status: 'pending', pieces: 0, availablePieces: 12 }] }] } as PrdJob;
const preview = { totalCents: 12000, summary: 'Sample pieces', issues: [], doc: { rows: [{ rowNo: 1, rateCents: 4000, amountCents: 12000 }] } } as unknown as Preview;

it('production preview and Record preserve normal pieces, typed rework rate, trimmed reasons and over-cap input', async () => {
  const pre = vi.spyOn(api, 'preview').mockResolvedValue(preview);
  const post = vi.spyOn(api, 'post').mockResolvedValue({ id: 'prd1' } as never);
  const f = form(() => EntryForm({ type: type('prd.entry'), mode }), [[], [{ id: 'e1', name: 'Sample Tailor' }], 'jo1', job, 1,
    [{ ...emptyRow('1'), employeeId: 'e1', pieces: '2' }, { ...emptyRow('1'), employeeId: 'e1', pieces: '3', rework: true, rate: '40', rateReason: ' Repair seams ' }], ' Extra pieces ready ']);
  const details = f.render().filter((n) => n.props.title === 'Change rate or record rework');
  expect(details.map((n) => n.props.active)).toEqual([false, true]);
  change(f.find('aria-label', 'Row 1 pieces'), '4');
  f.find('children', 'Record').props.onClick();
  await Promise.resolve();
  const expected = { jobOrderId: 'jo1', stepId: 1, rows: [{ lineNo: 1, employeeId: 'e1', pieces: 4 }, { lineNo: 1, employeeId: 'e1', pieces: 3, rework: true, rateCents: 4000, rateReason: 'Repair seams' }], overCapReason: 'Extra pieces ready' };
  expect(pre).toHaveBeenLastCalledWith('prd.entry', expected);
  await f.render().find((n) => n.props.onRecord)!.props.onRecord('key');
  expect(post).toHaveBeenLastCalledWith('prd.entry', expected, 12000, 'key');
  expect(f.render().filter((n) => n.type === 'section')).toHaveLength(2);
  expect(f.render().some((n) => n.type === 'table')).toBe(false);
});

it('production retains required rework rate and reason checks', () => {
  const pre = vi.spyOn(api, 'preview');
  const f = form(() => EntryForm({ type: type('prd.entry'), mode }), [[], [], 'jo1', job, 1,
    [{ ...emptyRow('1'), employeeId: 'e1', pieces: '2', rework: true }]]);
  f.find('children', 'Record').props.onClick();
  expect(pre).not.toHaveBeenCalled();
  change(f.find('aria-label', 'Row 1 rate'), '40');
  f.find('children', 'Record').props.onClick();
  expect(pre).not.toHaveBeenCalled();
});

it('production keeps calculated rates and pay on the correct worker when a blank row is skipped', () => {
  const f = form(() => EntryForm({ type: type('prd.entry'), mode }), [[], [], 'jo1', job, 1,
    [emptyRow('1'), { ...emptyRow('1'), employeeId: 'e1', pieces: '3', rate: '40', rateReason: ' Repair seams ' }]], preview);
  expect(renderToStaticMarkup(f.find('aria-label', 'Worker entry 1'))).not.toContain('₱40.00');
  const worker = renderToStaticMarkup(f.find('aria-label', 'Worker entry 2'));
  expect(worker).toContain('₱40.00');
  expect(worker).toContain('₱120.00');
  expect(worker).toContain('A typed rate replaces the usual rate for these pieces only.');
});
