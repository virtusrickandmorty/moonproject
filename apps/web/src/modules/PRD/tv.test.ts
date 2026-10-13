import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardCard, PrdStep } from '../../api.ts';
import { columns, filterCards, pollBoard, RETRY_MS, tvPages, updateWords } from './board.ts';
import { initials, TvBoard, TvCard, TvPage } from './TvBoard.tsx';
import { ProductionBoard } from './Board.tsx';

const snapshot = vi.hoisted(() => vi.fn());
vi.mock('./board.ts', async (original) => ({ ...await original<object>(), useBoardRefresh: snapshot }));
const card = (n: number, extra: Partial<BoardCard> = {}): BoardCard => ({ jobOrderId: `job-${n}`, number: `JO-${String(n).padStart(6, '0')}`, customerName: 'Ada Maria Santos', dueDate: '2026-10-03', priority: 'normal', stage: 'open', lineNo: 1, description: 'Team shirt', qty: 10, releasedQty: 2, garmentType: null, complexity: null, templateId: null, currentStepId: null, ready: false, steps: null, ...extra });
const step = (id: number): PrdStep => ({ id, code: `S${id}`, name: `Step ${id}`, seq: id, payBasis: 'daily', isActive: true, version: 1 });
afterEach(() => { vi.useRealTimers(); snapshot.mockReset(); });

describe('TV board on the display', () => {
  it('shows initials, quantities and text markers without customer names or prices', () => {
    const html = renderToStaticMarkup(createElement(TvCard, { card: card(1, { priority: 'rush' }), today: '2026-10-04' }));
    expect(initials('  Ada Maria Santos  ')).toBe('AMS');
    for (const label of ['JO-000001', 'AMS', '8 pcs', 'Due October 3, 2026', 'OVERDUE', 'RUSH']) expect(html).toContain(label);
    for (const hidden of ['Ada', 'Maria', 'Santos', '₱', 'price', 'Cents']) expect(html).not.toContain(hidden);
    const dueToday = renderToStaticMarkup(createElement(TvCard, { card: card(2, { dueDate: '2026-10-04' }), today: '2026-10-04' }));
    expect(dueToday).not.toContain('OVERDUE');
  });

  it('pages wide and tall boards without losing or repeating a card', () => {
    const cards = Array.from({ length: 45 }, (_, n) => card(n, { steps: [], currentStepId: n % 9 + 1 }));
    const cols = columns(Array.from({ length: 9 }, (_, n) => step(n + 1)), cards);
    for (const [width, height, across, down] of [[960, 720, 2, 2], [1888, 880, 5, 3], [320, 320, 1, 1]]) {
      const pages = tvPages(cols, width!, height!);
      expect(pages.length).toBeGreaterThan(1);
      expect(pages.every((page) => page.length <= across! && page.every((col) => col.cards.length <= down!))).toBe(true);
      const shown = pages.flatMap((page) => page.flatMap((col) => col.cards.map((c) => c.jobOrderId)));
      expect(shown.sort()).toEqual(cards.map((c) => c.jobOrderId).sort());
      const html = renderToStaticMarkup(createElement(TvPage, { cols: pages[0]!, today: '2026-10-04' }));
      expect(html).not.toContain('overflow-x-auto');
      expect(html).toContain('minmax(0, 1fr)');
    }
    expect(tvPages([], 960, 720)).toEqual([]);
  });

  it('distinguishes an empty successful board from waiting for data', () => {
    snapshot.mockReturnValue({ data: { cards: [], steps: [], today: '2026-10-04' }, error: '', words: 'Updated just now', stale: false });
    const empty = renderToStaticMarkup(createElement(TvBoard));
    expect(empty).toContain('No job order is in production.');
    expect(empty).toContain('Page 1 of 1');
    expect(empty).toContain('Server date: 2026-10-04');
    expect(empty).not.toContain('<nav');
    snapshot.mockReturnValue({ data: null, error: '', words: 'Waiting for the first update…', stale: false });
    expect(renderToStaticMarkup(createElement(TvBoard))).not.toContain('No job order');
  });
});

describe('production board search and freshness', () => {
  it('searches all loaded cards by number or customer and combines the existing filters', () => {
    const cards = [card(123, { priority: 'rush' }), card(456, { customerName: 'Sample School', dueDate: '2026-10-08' })];
    const find = (search: string, rushOnly = false) => filterCards(cards, { due: 'all', rushOnly, search }, '2026-10-04');
    expect(find(' JO 000123 ')).toEqual([cards[0]]);
    expect(find('sAmPlE')).toEqual([cards[1]]);
    expect(find('Sample', true)).toEqual([]);
    expect(find('   ')).toEqual(cards);
    expect(find('missing')).toEqual([]);
    expect(filterCards(cards, { due: 'overdue', rushOnly: true, search: 'Ada' }, '2026-10-04')).toEqual([cards[0]]);
    expect(filterCards(cards, { due: 'overdue', rushOnly: false }, '')).toEqual([]);
  });

  it('says live with the last load, or since when loads are failing', () => {
    const at = Date.parse('2026-10-04T01:02:03+08:00');
    expect(updateWords(null, '')).toContain('Waiting');
    expect(updateWords(null, 'Offline')).toContain('Not updated yet');
    expect(updateWords(at, '')).toMatch(/^Live · updated /);
    expect(updateWords(at, 'Offline')).toMatch(/^Not updated since .*Trying again/);
  });

  it('renders search, reset and a stale warning while retaining cards', () => {
    const cards = [card(123)];
    snapshot.mockReturnValue({ data: { cards, cat: { steps: [], templates: [], garmentTypes: [], complexities: [] }, today: '2026-10-04' }, error: 'Offline', words: 'Not updated since yesterday.', stale: true, refresh: vi.fn() });
    const html = renderToStaticMarkup(createElement(ProductionBoard, { me: { permissions: [] } as never, docTypes: [] }));
    for (const label of ['Search job number or customer', 'Reset filters', 'Not updated since yesterday.', 'JO-000123', 'Offline']) expect(html).toContain(label);
    expect(html).not.toContain('Refreshes every 30 seconds'); // live: no timed refresh (the owner's request, Oct 2026)
  });

  it('loads once, again only when told; a failed load is retried until one works; stops on leaving the screen', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<number>>().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(2);
    const good = vi.fn(); const failed = vi.fn();
    const poll = pollBoard(read, good, failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(good).toHaveBeenLastCalledWith(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(read).toHaveBeenCalledTimes(1); // no timed refresh
    await poll.refresh(); // a change on another computer
    expect(failed.mock.calls[0]![0].message).toBe('Offline');
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(good).toHaveBeenLastCalledWith(2);
    poll.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('does not overlap slow reads or accept an answer after leaving', async () => {
    vi.useFakeTimers();
    let finish!: (n: number) => void;
    const read = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
    const good = vi.fn();
    const poll = pollBoard(read, good, vi.fn());
    void poll.refresh(); void poll.refresh(); // two changes while the first read is still out
    expect(read).toHaveBeenCalledTimes(1);
    poll.stop(); finish(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(good).not.toHaveBeenCalled();
  });
});
