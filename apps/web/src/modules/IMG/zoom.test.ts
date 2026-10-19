import { describe, expect, it } from 'vitest';
import { FIT, MAX_ZOOM, limit, zoomAt } from './zoom.ts';

describe('zooming a picture (the owner\'s request, Oct 2026)', () => {
  it('keeps the spot under the mouse still', () => {
    const v = zoomAt(FIT, 2, 100, 50, 400, 200);
    expect(v).toEqual({ z: 2, x: -100, y: -50 });
    // The frame point (100, 50) shows the same picture point before and after: (p - offset) / zoom.
    expect([(100 - v.x) / v.z, (50 - v.y) / v.z]).toEqual([100, 50]);
  });

  it('never zooms out past the whole picture or in past the most, and never leaves a gap at an edge', () => {
    expect(zoomAt(FIT, 0.5, 10, 10, 400, 200)).toEqual(FIT);
    expect(zoomAt({ z: 10, x: 0, y: 0 }, 4, 0, 0, 400, 200).z).toBe(MAX_ZOOM);
    expect(limit({ z: 2, x: 50, y: -999 }, 400, 200)).toEqual({ z: 2, x: 0, y: -200 });
  });
});
