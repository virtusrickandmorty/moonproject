import { describe, expect, it } from 'vitest';
import { PHOTO_EDGE, fitWithin } from './photo.ts';

describe('website product photos made lighter (the owner\'s request, Oct 2026)', () => {
  it('fits a big photo within 1600 pixels on the long side, keeping its shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: PHOTO_EDGE, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: PHOTO_EDGE });
  });
  it('never makes a small photo bigger', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
