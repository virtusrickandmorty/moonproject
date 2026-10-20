/**
 * Photoshop files (PSD) of the image tools' results, made in the browser (ag-psd, MIT), the owner's request (Oct 2026):
 * - a picture: one layer, its transparency kept; flat art with its colours known: one layer per colour (each pixel goes
 *   to its nearest colour), so a designer can recolour or hide an ink;
 * - a vector: one layer per colour, each holding only the part of that colour that shows (what lies on top is left
 *   out), drawn 3000 px on the long side.
 * The layers are trimmed to what they hold; the merged picture is saved too, as Photoshop expects.
 */
import type { Layer, Psd } from 'ag-psd';

export const PSD_LONG_SIDE = 3000;

type Rgb = [number, number, number];
const fromHex = (hex: string): Rgb => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

const save = async (psd: Psd): Promise<Blob> => {
  const { writePsd } = await import('ag-psd');
  return new Blob([writePsd(psd, { trimImageData: true, noBackground: true })], { type: 'image/vnd.adobe.photoshop' });
};

const pixels = (source: CanvasImageSource, w: number, h: number): ImageData => {
  const c = document.createElement('canvas'); Object.assign(c, { width: w, height: h });
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(source, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
};

/** One colour's layer: its pixels where alpha[i] > 0, cut to the box that holds them (null when there are none). */
function layerOf(name: string, rgb: Rgb, alpha: (i: number) => number, w: number, h: number): Layer | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha(y * w + x) > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const lw = x1 - x0 + 1, lh = y1 - y0 + 1;
  const data = new Uint8ClampedArray(lw * lh * 4);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const a = alpha((y + y0) * w + x + x0), o = (y * lw + x) * 4;
    if (!a) continue;
    data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = a;
  }
  return { name, left: x0, top: y0, imageData: { data, width: lw, height: lh } };
}

/** A picture as a PSD: one layer, or one per colour when the colours are given (hex, largest first). */
export async function pictureToPsd(blob: Blob, colours?: string[]): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;
  const all = pixels(bmp, w, h);
  if (!colours?.length) return save({ width: w, height: h, imageData: all, children: [{ name: 'Artwork', imageData: all }] });
  const inks = colours.map(fromHex);
  const near = new Uint8Array(w * h); // each pixel's nearest colour
  const d = all.data;
  for (let i = 0; i < w * h; i++) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < inks.length; k++) {
      const [r, g, b] = inks[k]!;
      const dd = (d[i * 4]! - r) ** 2 + (d[i * 4 + 1]! - g) ** 2 + (d[i * 4 + 2]! - b) ** 2;
      if (dd < bestD) { bestD = dd; best = k; }
    }
    near[i] = best;
  }
  // Photoshop lists the first layer at the bottom: the largest colour (usually the ground) goes first.
  const children = colours.map((hex, k) => layerOf(`Colour ${k + 1} #${hex.toUpperCase()}`, inks[k]!, (i) => (near[i] === k ? d[i * 4 + 3]! : 0), w, h))
    .filter((l): l is Layer => !!l);
  return save({ width: w, height: h, imageData: all, children });
}

const SHAPES = 'path, polygon, polyline, rect, circle, ellipse';
const svgImage = async (doc: Document, w: number, h: number): Promise<HTMLImageElement> => {
  const root = doc.documentElement;
  root.setAttribute('width', String(w)); root.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
};

/** A vector (SVG text) as a PSD: one layer per colour, as much of it as shows. */
export async function vectorToPsd(svgText: string): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg') throw new Error('The vector could not be read.');
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const vw = vb[2] || parseFloat(root.getAttribute('width') ?? '') || 1000, vh = vb[3] || parseFloat(root.getAttribute('height') ?? '') || 1000;
  const k = PSD_LONG_SIDE / Math.max(vw, vh);
  const w = Math.round(vw * k), h = Math.round(vh * k);

  // Each shape's colour as the browser works it out (attributes, groups, styles): the SVG placed off screen to ask.
  const live = document.importNode(root, true) as unknown as SVGSVGElement;
  const holder = document.createElement('div');
  Object.assign(holder.style, { position: 'fixed', left: '-99999px', top: '0', width: '1px', height: '1px', overflow: 'hidden' });
  holder.appendChild(live); document.body.appendChild(holder);
  const fills: string[] = [];
  try { live.querySelectorAll(SHAPES).forEach((el) => fills.push(getComputedStyle(el).fill)); } finally { holder.remove(); }
  const order = [...new Set(fills.filter((f) => /^rgb/.test(f)))]; // first drawn first: the bottom layer

  const merged = pixels(await svgImage(doc.cloneNode(true) as Document, w, h), w, h);
  const children: Layer[] = [];
  for (const [n, colour] of order.entries()) {
    // White where this colour shows, black where another colour covers it or nothing is drawn.
    const one = doc.cloneNode(true) as Document;
    [...one.querySelectorAll(SHAPES)].forEach((el, i) => {
      const s = el as SVGElement;
      const mine = fills[i] === colour;
      s.setAttribute('fill', mine ? '#fff' : '#000'); s.style.fill = mine ? '#fff' : '#000';
      s.setAttribute('stroke', 'none'); s.style.stroke = 'none'; s.removeAttribute('opacity'); s.style.opacity = '1';
    });
    one.documentElement.style.background = '#000';
    const c = document.createElement('canvas'); Object.assign(c, { width: w, height: h });
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.drawImage(await svgImage(one, w, h), 0, 0, w, h);
    const m = g.getImageData(0, 0, w, h).data;
    const rgb = (colour.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number) as Rgb;
    const hex = rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const layer = layerOf(`Colour ${n + 1} #${hex}`, rgb, (i) => m[i * 4]!, w, h);
    if (layer) children.push(layer);
  }
  return save({ width: w, height: h, imageData: merged, children });
}
