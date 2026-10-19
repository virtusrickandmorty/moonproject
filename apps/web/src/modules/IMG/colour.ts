/**
 * "Remove a colour" (the owner's request, Oct 2026): the pixels close to one colour become clear, in the browser, with
 * no AI: exact for a logo or design on a plain background. Edges a little further from the colour fade, so they are
 * not jagged.
 */
export type Rgb = [number, number, number];
export const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** The opacity a pixel keeps: clear within `tolerance` (0-100) of the colour, fading over the next few steps. */
export function alphaFor(pixel: Rgb, colour: Rgb, tolerance: number, alpha = 255): number {
  const d = Math.max(Math.abs(pixel[0] - colour[0]), Math.abs(pixel[1] - colour[1]), Math.abs(pixel[2] - colour[2]));
  const clear = tolerance * 1.5, soft = 14;
  if (d <= clear) return 0;
  if (d >= clear + soft) return alpha;
  return Math.round(alpha * ((d - clear) / soft));
}

export function clearPixels(data: Uint8ClampedArray, colour: Rgb, tolerance: number): void {
  for (let i = 0; i < data.length; i += 4) data[i + 3] = alphaFor([data[i]!, data[i + 1]!, data[i + 2]!], colour, tolerance, data[i + 3]!);
}

export async function removeColour(picture: Blob, colour: Rgb, tolerance: number): Promise<Blob> {
  const bmp = await createImageBitmap(picture);
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width: bmp.width, height: bmp.height });
  const g = canvas.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const pixels = g.getImageData(0, 0, bmp.width, bmp.height);
  clearPixels(pixels.data, colour, tolerance);
  g.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
}
