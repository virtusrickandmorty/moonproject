/**
 * Website product photos are made lighter before they go up (the owner's request, Oct 2026): at most 1600 pixels on the
 * long side, which is sharp on the product page even on a phone's fine screen, and saved as WebP at high quality, so a
 * 5 MB phone photo comes out a few hundred KB with no detail lost to the eye. A photo already smaller stays as it is.
 */
export const PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.86;
/** The most a picked photo may be before it is made lighter (what goes up is still at most 4 MB). */
export const MAX_PICKED_BYTES = 25 * 1024 * 1024;

/** The size that fits within `edge` on the long side, keeping the shape; never larger than it was. */
export function fitWithin(width: number, height: number, edge = PHOTO_EDGE): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The photo made lighter, or the one picked when that is already smaller (or the browser cannot draw it). */
export async function lighterPhoto(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  Object.assign(canvas, size);
  const g = canvas.getContext('2d');
  if (!g) return file;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', PHOTO_QUALITY));
  // A browser without WebP gives PNG instead, usually heavier: keep the picked photo then.
  if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
}
