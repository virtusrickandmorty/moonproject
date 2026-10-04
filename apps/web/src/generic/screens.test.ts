import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, type DocHeader, type DocTypeInfo, type Preview } from '../api.ts';
import { choosePageRows } from '../components/ui.tsx';
import { DocList, ListMessage } from './DocList.tsx';
import { DocForm, RecordDialog } from './DocForm.tsx';
import { DocView } from './DocView.tsx';
import { Commit, DryRun } from '../modules/MIG/Finish.tsx';
import { FiledReturns } from '../modules/TAX/FiledReturns.tsx';
import { StatExposure } from '../modules/STAT/Exposure.tsx';
import { useRecord } from './record.tsx';
import { usePagedReport } from '../modules/RPT/Books.tsx';
import { useRangeReport } from '../modules/TAX/ReportParts.tsx';

/** Hook/event harness for asynchronous screen transitions, without running a browser on Windows. */
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (current: unknown) => { const i = hooks.cursor++; return hooks.values[i] ??= { current }; },
  useMemo: (run: () => unknown) => run(),
  useCallback: (fn: () => unknown, deps: unknown[]) => {
    const i = hooks.cursor++; const old = hooks.values[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) hooks.values[i] = { deps, fn };
    return hooks.values[i].fn;
  },
  useEffect: (run: () => (() => void) | void, deps: unknown[]) => {
    const i = hooks.cursor++; const old = hooks.values[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) {
      hooks.values[i] = { deps };
      hooks.effects.push(() => { old?.cleanup?.(); const cleanup = run(); hooks.values[i].cleanup = cleanup; if (cleanup) hooks.cleanups.push(cleanup); });
    }
  },
}));
vi.mock('../router.tsx', () => ({ navigate: vi.fn(), Link: ({ children }: { children: ReactNode }) => children }));

type Node = ReactElement<Record<string, any>>;
function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const n = root as Node; return [n, ...nodes(n.props.children)];
}
function harness<T>(run: () => T) {
  hooks.values = []; hooks.cursor = 0;
  return () => { hooks.cursor = 0; const result = run(); hooks.effects.splice(0).forEach((f) => f()); return result; };
}
const field = (tree: ReactNode, label: string) => nodes(nodes(tree).find((n) => n.props.label === label)!.props.children)[0]!;
const button = (tree: ReactNode, text: string) => nodes(tree).find((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children) === text)!;
const change = (n: Node, value: string) => n.props.onChange({ target: { value } });
const submit = (tree: ReactNode) => nodes(tree).find((n) => n.type === 'form')!.props.onSubmit({ preventDefault: () => undefined });
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const type: DocTypeInfo = { key: 'cash.transfer', title: 'Fund Transfer', module: 'CASH', canCreate: true, canPost: true, canCancel: true, dating: 'system', inputJsonSchema: { type: 'object', properties: {} } };
const row = (n = 1): DocHeader => ({ id: `doc${n}`, number: `TRF-${n}`, businessDate: '2026-09-30', status: 'posted', totalCents: 10000, summary: 'Sample supplier', postedAt: `2026-09-${String(31 - n).padStart(2, '0')}T12:00:00+08:00`, cancelledAt: null, cancelReason: null, replacesId: null, replacedById: null });
const preview: Preview = { totalCents: 10000, summary: 'This will move ₱100.00 from Sample bank to Sample wallet.', issues: [], journal: [{ accountCode: '1111', accountName: 'Sample bank', debitCents: 0, creditCents: 10000 }] };

afterEach(() => { hooks.cleanups.splice(0).reverse().forEach((f) => f()); hooks.effects = []; vi.restoreAllMocks(); choosePageRows(25, () => undefined); });

it('shows readable choices on the form and recorded view while keeping their original values', async () => {
  const wordsType = { ...type, inputJsonSchema: { properties: { paymentTerms: { enum: ['full', 'dp50'] }, priority: { enum: ['normal', 'rush'] } } } };
  const renderForm = harness(() => DocForm({ type: wordsType, mode: { kind: 'new' } }));
  const html = renderToStaticMarkup(renderForm());
  expect(html).toContain('value="full">Full payment</option>');
  expect(html).toContain('value="normal">Normal</option>');
  vi.spyOn(api, 'get').mockResolvedValue({ header: row(), input: { paymentTerms: 'full', priority: 'normal' }, doc: {} } as never);
  vi.spyOn(api, 'printableTypes').mockResolvedValue([]);
  const renderView = harness(() => DocView({ type: wordsType, id: 'doc1', recorded: false }));
  renderView(); await flush();
  const view = renderToStaticMarkup(renderView());
  expect(view).toContain('<dd>Full payment</dd>');
  expect(view).toContain('<dd>Normal</dd>');
});

it('names the import checks and approval action in shop words', () => {
  const counts = { listed: 0, needsReview: 0, accepted: 0, excluded: 0, merged: 0 };
  const check = harness(() => renderToStaticMarkup(createElement(DryRun, { uploadId: 'copy1', counts, dry: null, onDry: () => undefined })));
  expect(check()).toContain('Check the import');
  const approve = harness(() => renderToStaticMarkup(createElement(Commit, { uploadId: 'copy1', counts, dry: null, mayCommit: true, onCommitted: () => undefined })));
  expect(approve()).toContain('Import these approved rows');
});

it('offers Record a filing and keeps the BIR form number in its entry panel', async () => {
  vi.spyOn(api, 'filedReturns').mockResolvedValue({ today: '2026-10-04', forms: ['2550Q'], rows: [] } as never);
  const render = harness(() => FiledReturns({ me: { permissions: ['tax.registers.view', 'acc.settings.manage'] } as never }));
  render(); await flush();
  button(render(), 'Record a filing').props.onClick();
  const html = renderToStaticMarkup(render());
  expect(html).toContain('Record a filing');
  expect(html).toContain('2550Q');
  expect(html).not.toContain('Add a row');
});

it('explains missing past contributions and keeps the accountant’s policy reference in optional detail', async () => {
  vi.spyOn(api, 'statExposure').mockResolvedValue({ asOf: '2026-10-04', cutoverDate: null, from: null, to: null, totals: [], lines: [], rates: [], notes: ['Catch-up decision (ACC-05).'] } as never);
  const render = harness(() => StatExposure());
  render(); await flush();
  const html = renderToStaticMarkup(render());
  expect(html).toContain('Missing past government contributions');
  expect(html).toContain('Government contributions that may be missing for past months');
  expect(html).toContain('Set the cut-over date first');
  expect(html.indexOf('ACC-05')).toBeGreaterThan(html.indexOf('<details'));
});

it('shows Loading, empty, filtered empty and failure separately, each with a next step', () => {
  const state = { key: '', rows: [], busy: false, error: '', more: false };
  const render = (part: object, filtered = false, canCreate = true) => renderToStaticMarkup(createElement(ListMessage, { state: { ...state, ...part }, filtered, canCreate, onClear: () => undefined, onRetry: () => undefined, onNew: () => undefined }));
  expect(render({ busy: true })).toContain('Loading… Please wait'); expect(render({ busy: true })).not.toContain('Nothing here yet.');
  expect(render({})).toContain('Create a record'); expect(render({}, false, false)).toContain('Ask the owner');
  expect(render({}, true)).toContain('Clear filters'); expect(render({}, true)).toContain('No records match');
  expect(render({ error: 'Offline' })).toContain('Retry list'); expect(render({ error: 'Offline' })).not.toContain('Nothing here yet.');
});

it('searches every page with q/from/to, shows global status counts, appends 25 older rows and resets on a filter change', async () => {
  const list = vi.spyOn(api, 'list').mockResolvedValue(Array.from({ length: 25 }, (_, n) => row(n + 1)));
  const counts = vi.spyOn(api, 'docCounts').mockResolvedValue({ all: 40, posted: 35, cancelled: 5 });
  vi.spyOn(api, 'drafts').mockResolvedValue([]);
  const render = harness(() => DocList({ type })); render(); await flush();
  let tree = render();
  expect(button(tree, 'All (40)')).toBeDefined();
  change(field(tree, 'Search records'), ' Sample supplier '); tree = render();
  change(field(tree, 'From date'), '2026-09-01'); tree = render();
  change(field(tree, 'To date'), '2026-09-30'); submit(render()); render(); await flush(); tree = render();
  const filters = { q: 'Sample supplier', from: '2026-09-01', to: '2026-09-30' };
  expect(list).toHaveBeenLastCalledWith(type.key, { ...filters, status: '', before: undefined, limit: 25 });
  expect(counts).toHaveBeenLastCalledWith(type.key, filters);
  list.mockResolvedValue([row(26)]); button(tree, 'Show older').props.onClick(); await flush(); tree = render();
  expect(list).toHaveBeenLastCalledWith(type.key, { ...filters, status: '', before: row(25).postedAt, limit: 25 });
  expect(nodes(tree).filter((n) => n.type === 'tr')).toHaveLength(27);
  button(tree, 'Cancelled (5)').props.onClick(); render(); await flush(); tree = render();
  expect(list).toHaveBeenLastCalledWith(type.key, { ...filters, status: 'cancelled', before: undefined, limit: 25 });
  expect(nodes(tree).filter((n) => n.type === 'tr')).toHaveLength(2);
  button(tree, 'Clear filters').props.onClick(); render(); await flush();
  expect(list).toHaveBeenLastCalledWith(type.key, { q: '', from: '', to: '', status: '', before: undefined, limit: 25 });
});

it.each(['success', 'failure'])('ignores a stale list %s, retains older rows on failure and retries the same cursor', async (outcome) => {
  let resolve!: (v: DocHeader[]) => void; let reject!: (e: Error) => void;
  const old = new Promise<DocHeader[]>((yes, no) => { resolve = yes; reject = no; });
  const list = vi.spyOn(api, 'list').mockReturnValueOnce(old).mockResolvedValue(Array.from({ length: 25 }, (_, n) => row(n + 1)));
  vi.spyOn(api, 'docCounts').mockResolvedValue({ all: 30, posted: 30, cancelled: 0 }); vi.spyOn(api, 'drafts').mockResolvedValue([]);
  const render = harness(() => DocList({ type })); render();
  change(field(render(), 'Search records'), 'new'); submit(render()); render(); await flush();
  if (outcome === 'success') resolve([]); else reject(new Error('Old failure')); await flush();
  let tree = render(); expect(nodes(tree).find((n) => n.type === ListMessage)!.props.state.rows).toHaveLength(25);
  list.mockRejectedValueOnce(new Error('Offline')); button(tree, 'Show older').props.onClick(); await flush(); tree = render();
  const message = nodes(tree).find((n) => n.type === ListMessage)!;
  expect(message.props.state.rows).toHaveLength(25); expect(message.props.state.error).toBe('Offline');
  list.mockResolvedValueOnce([row(26)]); await message.props.onRetry(); await flush(); tree = render();
  expect(list).toHaveBeenLastCalledWith(type.key, expect.objectContaining({ before: row(25).postedAt, q: 'new' }));
  expect(nodes(tree).find((n) => n.type === ListMessage)!.props.state.rows).toHaveLength(26);
});

it('retries a failed initial request with Search', async () => {
  const list = vi.spyOn(api, 'list').mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([row()]);
  vi.spyOn(api, 'docCounts').mockResolvedValue({ all: 1, posted: 1, cancelled: 0 }); vi.spyOn(api, 'drafts').mockResolvedValue([]);
  const render = harness(() => DocList({ type })); render(); await flush(); submit(render()); await flush();
  expect(list).toHaveBeenCalledTimes(2); expect(nodes(render()).find((n) => n.type === ListMessage)!.props.state.rows).toHaveLength(1);
});

it('ignores a pending response after the list unmounts', async () => {
  let resolve!: (v: DocHeader[]) => void;
  vi.spyOn(api, 'list').mockReturnValue(new Promise((yes) => { resolve = yes; }));
  vi.spyOn(api, 'docCounts').mockResolvedValue({ all: 1, posted: 1, cancelled: 0 }); vi.spyOn(api, 'drafts').mockResolvedValue([]);
  const render = harness(() => DocList({ type })); render();
  hooks.cleanups.splice(0).forEach((f) => f()); resolve([row()]); await flush();
  expect(nodes(render()).find((n) => n.type === ListMessage)!.props.state.rows).toHaveLength(0);
});

it('Record puts the server summary and amount before a folded journal, preserves warnings, and hides absent journals', () => {
  const props = { type, preview, reason: '', onRecord: async () => undefined, onClose: () => undefined };
  const html = renderToStaticMarkup(createElement(RecordDialog, props));
  expect(html.indexOf(preview.summary)).toBeLessThan(html.indexOf('Behind the scenes'));
  expect(html.indexOf('₱100.00', html.indexOf('Total:'))).toBeLessThan(html.indexOf('Behind the scenes'));
  expect(html).toContain('<details'); expect(html).not.toContain('<details open'); expect(html).not.toContain('autofocus');
  expect(renderToStaticMarkup(createElement(RecordDialog, { ...props, preview: { ...preview, journal: undefined } }))).not.toContain('Behind the scenes');
  const blocked = renderToStaticMarkup(createElement(RecordDialog, { ...props, preview: { ...preview, issues: [{ code: 'CHECK', level: 'error', message: 'Check amount' }] }, original: row(), reason: 'Correct the amount' }));
  expect(blocked).toContain('Check amount'); expect(blocked).toContain('disabled'); expect(blocked).toContain('Correct the amount');
});

it('the generic So far panel is compact, before the single Record action, with a phone total', () => {
  const render = harness(() => DocForm({ type, mode: { kind: 'new' } })); const tree = render();
  const all = nodes(tree);
  expect(all[0]!.props.className).not.toContain('grid-cols');
  expect(all.findIndex((n) => n.props.title === 'So far')).toBeLessThan(all.findIndex((n) => n.props.children === 'Record'));
  expect(all.filter((n) => n.props.children === 'Record')).toHaveLength(1);
  expect(all.find((n) => n.props.className?.includes('fixed inset-x-0 bottom-0'))).toBeDefined();
});

it('shared useRecord keeps final confirmation, the exact input/date and re-preview when totals change', async () => {
  vi.spyOn(api, 'preview').mockResolvedValue(preview);
  const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError('TOTALS_CHANGED', 'Review the total again.', 409));
  const render = harness(() => useRecord(type, { kind: 'new' }, () => undefined));
  const input = { amountSentCents: 10000 }; render().ask(input, [], '2026-09-30'); await flush();
  const dialog = render().dialog!;
  expect(dialog.type).toBe(RecordDialog); expect(dialog.props.preview).toBe(preview);
  await expect(dialog.props.onRecord('retry-key')).rejects.toMatchObject({ code: 'TOTALS_CHANGED' });
  expect(post).toHaveBeenLastCalledWith(type.key, input, preview.totalCents, 'retry-key', '2026-09-30');
  expect(api.preview).toHaveBeenCalledTimes(2); expect(render().dialog!.props.preview).toBe(preview);
});

it('a report row choice actually reloads the existing report caller at the new limit and first offset', async () => {
  const report = vi.spyOn(api, 'report').mockResolvedValue({ page: { limit: 25, offset: 0, total: 120 } });
  const render = harness(() => usePagedReport('general-journal?from=2026-09-01&to=2026-09-30')); render(); await flush();
  choosePageRows(50, render().pager.props.onOffset); render(); await flush();
  expect(report).toHaveBeenLastCalledWith('general-journal?from=2026-09-01&to=2026-09-30&limit=50&offset=0');
});

it('tax register callers also request the chosen report size without changing the applied dates', async () => {
  vi.spyOn(api, 'health').mockResolvedValue({ serverTime: '2026-09-30T12:00:00+08:00' } as never);
  const load = vi.fn(async () => ({ page: { limit: 25, offset: 0, total: 120 } }));
  const render = harness(() => useRangeReport(true, () => ({ from: '2026-09-01', to: '2026-09-30' }), load)); render(); await flush();
  choosePageRows(100, render().goto); await flush();
  expect(load).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30', { limit: 100, offset: 0 });
});
