/**
 * Pictures made lighter before they are sent (the owner's request, Oct 2026: a photo taken on a phone could not be
 * attached, "the file is too large"). A picture over the limit is drawn again smaller and saved as WebP (JPEG on a
 * browser that cannot write WebP), step by step until it fits; one under the limit is sent as it is. A picture the
 * server does not take as it is (an iPhone's HEIC, say) is converted the same way when the browser can open it.
 * A .jpg the server would refuse as it is (the owner's report, 26 Oct 2026: ".jpg is not accepted, only .jpeg") is drawn
 * again too: a phone photo with more after the picture's end (a motion photo's video, the maker's data), or one larger
 * than the server takes (6000 px on a side, 24 million pixels). A picture is known by its name as well as by the type the
 * computer reports, as some Windows PCs report a .jpg as "image/pjpeg" or report nothing.
 */
type PictureType = 'image/jpeg' | 'image/png' | 'image/webp';
/** The longest side tried first, then smaller ones: a phone photo is usually 4000 px or more. */
const EDGES = [3200, 2560, 2048, 1600, 1280, 1024];
/** What the server takes as it is (engine/attachments.ts sniffType). */
const SERVER_EDGE = 6000;
const SERVER_PIXELS = 24_000_000;

/** What a file picker offers for a picture: by type and by name, so a .jpg shows whatever type the computer gives it. */
export const PICTURE_ACCEPT = 'image/jpeg,image/pjpeg,image/png,image/webp,.jpg,.jpeg,.jpe,.jfif,.png,.webp';

const BY_NAME: [RegExp, PictureType][] = [[/\.(jpe?g|jpe|jfif)$/i, 'image/jpeg'], [/\.png$/i, 'image/png'], [/\.webp$/i, 'image/webp']];
const BY_TYPE: Record<string, PictureType> = { 'image/jpeg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/x-png': 'image/png', 'image/webp': 'image/webp' };

/** A JPEG, PNG or WebP picture the server takes, by the type reported or else by the name; null for anything else. */
export function pictureType(f: { name: string; type: string }): PictureType | null {
  return BY_TYPE[f.type.toLowerCase()] ?? BY_NAME.find(([re]) => re.test(f.name))?.[1] ?? null;
}

/** The size a picture takes to fit `edge` on its longest side, never larger than it was. */
export function fitEdge(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const isPicture = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|jpe|jfif|png|webp|heic|heif)$/i.test(f.name);

/** A JPEG ends at its end marker (FF D9); some phone cameras add more after it, which the server does not take. */
export async function endsCleanly(f: Blob): Promise<boolean> {
  const tail = new Uint8Array(await f.slice(Math.max(0, f.size - 2)).arrayBuffer());
  return tail.length === 2 && tail[0] === 0xff && tail[1] === 0xd9;
}

/** The same file, with the type the server knows it by (a .jpg reported as "image/pjpeg" or as nothing). */
const labelled = (f: File, type: PictureType) => (f.type === type ? f : new File([f], f.name, { type, lastModified: f.lastModified }));

/**
 * The file to send: as it is when it is not a picture, or a picture the server takes as it is and within `maxBytes`;
 * otherwise drawn again, smaller when needed, until it is within `maxBytes` and the server's size. Throws when the
 * picture cannot be opened or made light enough.
 */
export async function fitPicture(file: File, maxBytes: number): Promise<File> {
  if (!isPicture(file)) return file;
  const kind = pictureType(file);
  const asIs = !!kind && file.size <= maxBytes && (kind !== 'image/jpeg' || await endsCleanly(file));
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    if (asIs) return labelled(file, kind!); // its size is the server's to check
    throw new Error(`${file.name} could not be opened to make it lighter. Use a JPEG, PNG or WebP picture.`);
  }
  const { width, height } = bitmap;
  if (asIs && Math.max(width, height) <= SERVER_EDGE && width * height <= SERVER_PIXELS) { bitmap.close(); return labelled(file, kind!); }
  try {
    // The first side tried keeps the picture as large as the server takes it.
    const largest = Math.min(Math.max(width, height), SERVER_EDGE, Math.floor(Math.max(width, height) * Math.sqrt(SERVER_PIXELS / (width * height))));
    const edges = [largest, ...EDGES].filter((e, i, all) => e <= all[0]! && all.indexOf(e) === i);
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
