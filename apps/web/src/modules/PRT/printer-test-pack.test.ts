import { describe, expect, it } from 'vitest';
import { printWhenReady } from '../../api.ts';
import { combineA4, printedAlone } from './PrinterTestPack.tsx';

describe('printer test pack screen', () => {
  it('combines only A4 samples in catalogue order', () => {
    const html = (name: string) => `<!doctype html><html><head><style>.${name}{}</style></head><body><div class="sheet"><h1>${name}</h1></div></body></html>`;
    const combined = combineA4([
      { id: 'one', label: 'One', paper: 'A4', html: html('ONE') },
      { id: 'thermal', label: 'Thermal', paper: '80 mm', html: html('THERMAL') },
      { id: 'two', label: 'Two', paper: 'A4 2-up', html: html('TWO') },
    ]);
    expect(combined).toContain('<style>.ONE{}</style>');
    expect(combined).toContain('<h1>ONE</h1>');
    expect(combined).toContain('<h1>TWO</h1>');
    expect(combined).not.toContain('THERMAL');
    expect(combined.indexOf('ONE')).toBeLessThan(combined.indexOf('TWO'));
  });

  it('names the A4 samples that have no sheet to join, so none goes missing unsaid', () => {
    const alone = printedAlone([
      { id: 'one', label: 'One', paper: 'A4 2-up', html: '<body><div class="sheet two-up"></div></body>' },
      { id: 'bir', label: 'BIR', paper: 'A4', html: '<body><article class="certificate"></article></body>' },
      { id: 'thermal', label: 'Thermal', paper: '80 mm', html: '<body><article></article></body>' },
    ]);
    expect(alone.map((p) => p.label)).toEqual(['BIR']);
  });
});

describe('printing a written window', () => {
  const page = (images: { decode: () => Promise<void> }[]) => {
    const calls: string[] = [];
    return { calls, window: { document: { images }, print: () => { calls.push('print'); } } as unknown as Pick<Window, 'document' | 'print'> };
  };

  it('prints a page without pictures, which has no load event left to wait for', async () => {
    const p = page([]);
    printWhenReady(p.window);
    await Promise.resolve(); await Promise.resolve();
    expect(p.calls).toEqual(['print']);
  });

  it('waits for the pictures, and prints even when one is broken', async () => {
    let done = () => {};
    const p = page([{ decode: () => new Promise<void>((resolve) => { done = resolve; }) }, { decode: () => Promise.reject(new Error('broken')) }]);
    printWhenReady(p.window);
    await new Promise((resolve) => setTimeout(resolve));
    expect(p.calls).toEqual([]);
    done();
    await new Promise((resolve) => setTimeout(resolve));
    expect(p.calls).toEqual(['print']);
  });
});
