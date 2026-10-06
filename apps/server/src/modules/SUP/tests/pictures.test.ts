import { describe, expect, it } from 'vitest';
import { sniffType } from '../../../engine/attachments.ts';
import { smallJpeg, smallPng, smallWebp, smallLosslessWebp, smallAnimatedWebp, smallProgressiveJpeg } from '../../../../test/pictures.ts';

const formats = [
  ['JPEG', smallJpeg, 'image/jpeg'], ['progressive JPEG', smallProgressiveJpeg, 'image/jpeg'],
  ['PNG', smallPng, 'image/png'], ['WebP', smallWebp, 'image/webp'],
  ['lossless WebP', smallLosslessWebp, 'image/webp'], ['animated WebP', smallAnimatedWebp, 'image/webp'],
] as const;
describe('shared picture check used by support', () => {
  it.each(formats)('accepts a complete small %s and refuses its missing ending or extra bytes', (_name, picture, type) => {
    const bytes = picture();
    expect(sniffType(bytes)).toBe(type);
    expect(sniffType(bytes.subarray(0, -2))).toBeNull();
    expect(sniffType(Buffer.concat([bytes, Buffer.from([0])]))).toBeNull();
    // Byte offsets must not affect the size or dimension checks.
    const padded = Buffer.concat([Buffer.alloc(5), bytes, Buffer.alloc(5)]);
    expect(sniffType(padded.subarray(5, -5))).toBe(type);
  });
  it('requires readable positive dimensions and accepts the exact dimension limits', () => {
    for (const [w, h, accepted] of [[0, 1, false], [1, 0, false], [6000, 4000, true], [6000, 4001, false], [6001, 1, false]]) {
      const png = smallPng(); png.writeUInt32BE(w as number, 16); png.writeUInt32BE(h as number, 20);
      expect(sniffType(png)).toBe(accepted ? 'image/png' : null);
    }
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(sniffType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
  });
});
