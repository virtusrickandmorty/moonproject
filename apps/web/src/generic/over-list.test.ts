import { describe, expect, it } from 'vitest';
import { openedFrom, openedPath, overList } from './DocList.tsx';
import { longDate, manilaTime, showDate } from '../components/ui.tsx';

describe('dates on screen', () => {
  it('shows every date as "July 9, 2026", from the Manila date as given', () => {
    expect(showDate('2026-07-09')).toBe('July 9, 2026');
    expect(showDate('2026-12-31')).toBe('December 31, 2026');
    expect(longDate('2026-09-27')).toBe('Sunday, September 27, 2026');
    expect(manilaTime('2026-07-09T14:05:00.000+08:00')).toBe('July 9, 2026, 2:05 PM');
    expect(manilaTime('2026-07-09T00:30:00.000+08:00')).toBe('July 9, 2026, 12:30 AM');
    expect(manilaTime('2026-07-09')).toBe('July 9, 2026');
  });
  it('leaves anything that is not a date as it is', () => {
    for (const text of ['', 'Walk-in', '2026-09']) expect(showDate(text)).toBe(text);
    expect(showDate(null)).toBe('');
  });
});

describe('dialogs over a list', () => {
  const base = '/docs/col.collection';
  it('reads and writes what the address opens over the list', () => {
    for (const o of [
      { kind: 'view', id: 'a1', recorded: false, cancel: false },
      { kind: 'view', id: 'a1', recorded: true, cancel: false },
      { kind: 'view', id: 'a1', recorded: false, cancel: true },
      { kind: 'new', draftId: undefined },
      { kind: 'new', draftId: 'd9' },
      { kind: 'edit', id: 'a1' },
    ] as const) expect(openedFrom(openedPath(base, o).split('?')[1]!)).toEqual(o);
    expect(openedFrom('')).toBeUndefined();
    expect(openedFrom('from-quotation=q1')).toBeUndefined();
  });

  it("takes over its own document pages, in a recorded form's place, and leaves every other address alone", () => {
    expect(overList(base, `${base}/a1?recorded=1`)).toEqual({ to: `${base}?view=a1&recorded=1`, replace: true });
    expect(overList(base, `${base}/a1/edit`)).toEqual({ to: `${base}?edit=a1` });
    expect(overList(base, `${base}/a1`)).toEqual({ to: `${base}?view=a1` });
    expect(overList(base, `${base}/new`)).toEqual({ to: `${base}?new` });
    expect(overList(base, `${base}/new?draft=d9`)).toEqual({ to: `${base}?new&draft=d9` });
    for (const other of [base, `${base}?view=a1`, `${base}/new?jo=j1&for=downpayment`, `${base}/a1?x=1`, '/docs/jo.job_order/a1', '/docs/col.collections/a1', '/'])
      expect(overList(base, other)).toBeNull();
  });

  it("opens another type's New form (with its prefill) and the document it recorded over the list", () => {
    const jo = '/docs/jo.job_order';
    const others = ['col.collection', 'jo.release'];
    expect(overList(jo, '/docs/col.collection/new?jo=j1&for=downpayment', others)).toEqual({ to: `${jo}?with=col.collection&jo=j1&for=downpayment` });
    expect(overList(jo, '/docs/jo.release/new?jo=j1', others)).toEqual({ to: `${jo}?with=jo.release&jo=j1` });
    expect(overList(jo, '/docs/col.collection/c9?recorded=1', others)).toEqual({ to: `${jo}?with=col.collection&doc=c9&recorded=1`, replace: true });
    expect(overList(jo, '/docs/col.collection/c9', others)).toEqual({ to: `${jo}?with=col.collection&doc=c9` });
    expect(overList(jo, '/docs/col.collection/c9/edit', others)).toBeNull(); // an edit opens its own page
    expect(overList(jo, '/docs/ap.bill/new', others)).toBeNull(); // not one of the list's
    expect(openedFrom('with=col.collection&jo=j1&for=downpayment')).toEqual({ kind: 'other', typeKey: 'col.collection', recorded: false, params: 'jo=j1&for=downpayment' });
    expect(openedFrom('with=col.collection&doc=c9&recorded=1')).toEqual({ kind: 'other', typeKey: 'col.collection', docId: 'c9', recorded: true, params: '' });
  });
});
