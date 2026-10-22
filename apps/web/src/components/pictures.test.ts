import { describe, expect, it } from 'vitest';
import { fitEdge, fitPicture } from './pictures.ts';

describe('pictures made lighter before they are sent (the owner\'s request, Oct 2026)', () => {
  it('fits a phone photo within the side tried, keeping its shape, and never makes a small one bigger', () => {
    expect(fitEdge(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitEdge(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitEdge(800, 600, 2560)).toEqual({ width: 800, height: 600 });
  });
  it('sends a PDF, or a picture already within the limit, as it is', async () => {
    const pdf = new File([new Uint8Array(20)], 'bir-2307.pdf', { type: 'application/pdf' });
    const photo = new File([new Uint8Array(20)], 'design.jpg', { type: 'image/jpeg' });
    expect(await fitPicture(pdf, 10)).toBe(pdf);
    expect(await fitPicture(photo, 1000)).toBe(photo);
  });
});
