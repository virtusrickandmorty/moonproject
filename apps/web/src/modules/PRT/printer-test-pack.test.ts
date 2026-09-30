import { describe, expect, it } from 'vitest';
import { combineA4 } from './PrinterTestPack.tsx';

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
});
