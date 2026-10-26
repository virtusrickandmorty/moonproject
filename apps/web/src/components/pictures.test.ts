import { describe, expect, it } from 'vitest';
import { PICTURE_ACCEPT, endsCleanly, fitEdge, fitPicture, pictureType } from './pictures.ts';

/** A stand-in JPEG: the start and end markers around some bytes (the server's own check is tested on the server). */
const jpegBytes = (more: number[] = []) => new Uint8Array([0xff, 0xd8, 0xff, ...new Array(16).fill(1), 0xff, 0xd9, ...more]);

describe('pictures made lighter before they are sent (the owner\'s request, Oct 2026)', () => {
  it('fits a phone photo within the side tried, keeping its shape, and never makes a small one bigger', () => {
    expect(fitEdge(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitEdge(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitEdge(800, 600, 2560)).toEqual({ width: 800, height: 600 });
  });
  it('sends a PDF, or a picture already within the limit, as it is', async () => {
    const pdf = new File([new Uint8Array(20)], 'bir-2307.pdf', { type: 'application/pdf' });
    const photo = new File([jpegBytes()], 'design.jpg', { type: 'image/jpeg' });
    expect(await fitPicture(pdf, 10)).toBe(pdf);
    expect(await fitPicture(photo, 1000)).toBe(photo);
  });
});

describe('a .jpg is taken like a .jpeg (the owner\'s report, 26 Oct 2026)', () => {
  it('knows a picture by its name when the computer reports an old type or none', () => {
    expect(pictureType({ name: 'slip.jpg', type: 'image/pjpeg' })).toBe('image/jpeg');
    expect(pictureType({ name: 'slip.JPG', type: '' })).toBe('image/jpeg');
    expect(pictureType({ name: 'slip.jfif', type: '' })).toBe('image/jpeg');
    expect(pictureType({ name: 'slip.jpeg', type: 'image/jpeg' })).toBe('image/jpeg');
    expect(pictureType({ name: 'qr.png', type: '' })).toBe('image/png');
    expect(pictureType({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
    expect(PICTURE_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.jpg', '.jpeg', 'image/jpeg', 'image/pjpeg']));
  });
  it('sends such a .jpg with the type the server knows', async () => {
    const old = new File([jpegBytes()], 'bank slip.jpg', { type: 'image/pjpeg' });
    const sent = await fitPicture(old, 1000);
    expect(sent.type).toBe('image/jpeg');
    expect(sent.name).toBe('bank slip.jpg');
    expect(sent.size).toBe(old.size);
  });
  it('a phone JPEG with more after its end is drawn again, not sent as it is', async () => {
    expect(await endsCleanly(new Blob([jpegBytes()]))).toBe(true);
    expect(await endsCleanly(new Blob([jpegBytes([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])]))).toBe(false); // a motion photo's video after it
    const motion = new File([jpegBytes([1, 2, 3])], 'PXL_20261026.MP.jpg', { type: 'image/jpeg' });
    // No browser to draw it here: it is not sent as it is.
    await expect(fitPicture(motion, 1000)).rejects.toThrow(/could not be opened/);
  });
});
