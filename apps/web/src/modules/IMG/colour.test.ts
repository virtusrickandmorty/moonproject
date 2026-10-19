import { describe, expect, it } from 'vitest';
import { alphaFor, clearPixels, toHex } from './colour.ts';

describe('remove a colour (the owner\'s request, Oct 2026)', () => {
  it('makes the colour clear, fades the edge, and leaves other colours alone', () => {
    expect(alphaFor([255, 255, 255], [255, 255, 255], 20)).toBe(0);
    expect(alphaFor([250, 252, 247], [255, 255, 255], 20)).toBe(0); // close enough
    expect(alphaFor([10, 40, 200], [255, 255, 255], 20)).toBe(255); // the design stays
    const edge = alphaFor([255 - 37, 255, 255], [255, 255, 255], 20); // 7 steps into the fade
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(alphaFor([10, 40, 200], [255, 255, 255], 20, 128)).toBe(128); // an already see-through pixel keeps its opacity
  });

  it('clears pixels in place and names a colour', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    clearPixels(data, [255, 255, 255], 10);
    expect([...data]).toEqual([255, 255, 255, 0, 0, 0, 0, 255]);
    expect(toHex([255, 128, 0])).toBe('#ff8000');
  });
});
