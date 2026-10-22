/**
 * Pictures made lighter before they are sent (the owner's request, Oct 2026: a photo taken on a phone could not be
 * attached, "the file is too large"). A picture over the limit is drawn again smaller and saved as WebP (JPEG on a
 * browser that cannot write WebP), step by step until it fits; one under the limit is sent as it is. A picture the
 * server does not take as it is (an iPhone's HEIC, say) is converted the same way when the browser can open it.
 */
const SENDABLE = ['image/jpeg', 'image/png', 'image/webp'];
/** The longest side tried first, then smaller ones: a phone photo is usually 4000 px or more. */
const EDGES = [3200, 2560, 2048, 1600, 1280, 1024];

/** The size a picture takes to fit `edge` on its longest side, never larger than it was. */
export function fitEdge(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const isPicture = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

/**
 * The file to send: as it is when it is not a picture, or a picture the server takes and within `maxBytes`; otherwise
 * made lighter until it is within `maxBytes`. Throws when the picture cannot be opened or made light enough.
 */
export async function fitPicture(file: File, maxBytes: number): Promise<File> {
  if (!isPicture(file) || (SENDABLE.includes(file.type) && file.size <= maxBytes)) return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    throw new Error(`${file.name} could not be opened to make it lighter. Use a JPEG, PNG or WebP picture.`);
  }
  try {
    const edges = [Math.max(bitmap.width, bitmap.height), ...EDGES].filter((e, i, all) => e <= all[0]! && all.indexOf(e) === i);
    for (const edge of edges) {
      for (const quality of [0.86, 0.72]) {
        const blob = await draw(bitmap, fitEdge(bitmap.width, bitmap.height, edge), quality);
        if (blob && blob.size <= maxBytes) {
          const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${ext}`, { type: blob.type });
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`${file.name} is too big even after making it lighter. Use a smaller picture.`);
}

async function draw(bitmap: ImageBitmap, size: { width: number; height: number }, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, size);
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, size.width, size.height);
  const webp = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', quality));
  if (webp?.type === 'image/webp') return webp;
  // No WebP writer (older iPhones): JPEG, on white, as JPEG has no see-through parts.
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size.width, size.height);
  return new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality));
}
