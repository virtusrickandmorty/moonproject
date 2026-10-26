/**
 * The live stream comes back after the server restarts (the owner's report, 26 Oct 2026): a browser gives up on a stream
 * that got an error answer (Cloudflare's 502 while the server restarts), so the app opens a new one itself, waiting a
 * little longer each time, and every screen reloads once it is back. Signing out stops it for good.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RETRY_FIRST_MS, RETRY_MOST_MS, isAppUpdated, onLiveChange, startLive, stopLive } from './live.ts';

class FakeSource {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  static made: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  closed = false;
  private handlers = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(public url: string) { FakeSource.made.push(this); }
  addEventListener(type: string, h: (e: { data?: string }) => void) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]); }
  emit(type: string, data?: string) { for (const h of this.handlers.get(type) ?? []) h({ data }); }
  hello() { this.readyState = FakeSource.OPEN; this.emit('hello', '{}'); }
  /** The answer was an error: the browser closes it and does not retry. */
  refused() { this.readyState = FakeSource.CLOSED; this.emit('error'); }
  close() { this.closed = true; this.readyState = FakeSource.CLOSED; }
}

beforeEach(() => { vi.useFakeTimers(); FakeSource.made = []; vi.stubGlobal('EventSource', FakeSource); });
afterEach(() => { stopLive(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('opens a new stream after the server refused one, longer waits each time, and reloads every screen when back', () => {
  const heard: string[][] = [];
  const off = onLiveChange((t) => heard.push(t));
  startLive();
  expect(FakeSource.made).toHaveLength(1);
  FakeSource.made[0]!.hello();
  FakeSource.made[0]!.emit('change', JSON.stringify({ types: ['quo.quotation'] }));
  expect(heard).toEqual([['quo.quotation']]);

  // The server restarts: Cloudflare answers 502, twice.
  FakeSource.made[0]!.refused();
  vi.advanceTimersByTime(RETRY_FIRST_MS - 1);
  expect(FakeSource.made).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(FakeSource.made).toHaveLength(2);
  FakeSource.made[1]!.refused();
  vi.advanceTimersByTime(RETRY_FIRST_MS * 2);
  expect(FakeSource.made).toHaveLength(3);

  // Back: every screen reloads once, then hears changes again; the wait starts over.
  FakeSource.made[2]!.hello();
  expect(heard.at(-1)).toEqual(['*']);
  FakeSource.made[2]!.refused();
  vi.advanceTimersByTime(RETRY_FIRST_MS);
  expect(FakeSource.made).toHaveLength(4);
  off();
});

it('never waits more than the most, and a dropped stream the browser retries itself is left alone', () => {
  startLive();
  for (let i = 0; i < 8; i++) { FakeSource.made.at(-1)!.refused(); vi.advanceTimersByTime(RETRY_MOST_MS); }
  expect(FakeSource.made).toHaveLength(9);
  const s = FakeSource.made.at(-1)!;
  s.readyState = FakeSource.CONNECTING; // a dropped connection: the browser reconnects on its own
  s.emit('error');
  vi.advanceTimersByTime(RETRY_MOST_MS * 2);
  expect(FakeSource.made).toHaveLength(9);
});

it('signing out closes the stream and stops opening new ones', () => {
  startLive();
  FakeSource.made[0]!.refused();
  stopLive();
  vi.advanceTimersByTime(RETRY_MOST_MS * 2);
  expect(FakeSource.made).toHaveLength(1);
  startLive();
  expect(FakeSource.made).toHaveLength(2);
  stopLive();
  expect(FakeSource.made[1]!.closed).toBe(true);
});

it('knows when the server serves a newer app than this page runs (a phone left open over an update)', () => {
  vi.stubGlobal('document', { querySelector: () => ({ src: 'https://www.example.test/assets/index-OLDBUILD.js' }) });
  startLive();
  FakeSource.made[0]!.emit('hello', JSON.stringify({ seq: 1, build: 'assets/index-OLDBUILD.js' }));
  expect(isAppUpdated()).toBe(false);
  FakeSource.made[0]!.refused();
  vi.advanceTimersByTime(RETRY_FIRST_MS);
  FakeSource.made[1]!.emit('hello', JSON.stringify({ seq: 9, build: 'assets/index-NEWBUILD.js' }));
  expect(isAppUpdated()).toBe(true);
});
