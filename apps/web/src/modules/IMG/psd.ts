/**
 * Photoshop files (PSD) of the image tools' results, made in the browser (ag-psd, MIT), the owner's request (Oct 2026):
 * - a picture: one layer, its transparency kept; flat art with its colours known: one layer per colour (each pixel goes
 *   to its nearest colour), so a designer can recolour or hide an ink;
 * - a vector, pixel layers: one layer per colour, each holding only the part of that colour that shows (what lies on
 *   top is left out), drawn 3000 px on the long side;
 * - a vector, shape layers: each colour a Photoshop shape (a fill colour and a vector outline), sharp at any size and
 *   recoloured with a double-click. A few inks drawn one after another (screen printing) keep the SVG's own curves;
 *   when colours are drawn over each other many times (full colour, the online AI), each colour's visible part is
 *   traced into an outline instead, so every layer stays one shape and the layers still add up to the design.
 * The layers are trimmed to what they hold; the merged picture is saved too, as Photoshop expects.
 */
import type { BezierKnot, BezierPath, Layer, Psd } from 'ag-psd';

export const PSD_LONG_SIDE = 3000;

type Rgb = [number, number, number];
const fromHex = (hex: string): Rgb => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
const toHex = (rgb: Rgb) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

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

/**
 * One layer: alpha[i] > 0 where it has pixels, in one colour or each pixel's colour from a picture, cut to the box
 * that holds them (null when there are none).
 */
function layerOf(name: string, colour: Rgb | Uint8ClampedArray, alpha: (i: number) => number, w: number, h: number): Layer | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha(y * w + x) > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const lw = x1 - x0 + 1, lh = y1 - y0 + 1;
  const data = new Uint8ClampedArray(lw * lh * 4);
  const flat = !(colour instanceof Uint8ClampedArray);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const i = (y + y0) * w + x + x0, a = alpha(i), o = (y * lw + x) * 4;
    if (!a) continue;
    data[o] = flat ? colour[0] : colour[i * 4]!; data[o + 1] = flat ? colour[1] : colour[i * 4 + 1]!; data[o + 2] = flat ? colour[2] : colour[i * 4 + 2]!; data[o + 3] = a;
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

// ---------------------------------------------------------------------------------------------------------------------
// Vectors

const SHAPES = 'path, polygon, polyline, rect, circle, ellipse';
/** The SVG read once: its size in the PSD, and each shape's colour (or gradient), fill rule and place, in drawing order. */
type Svg = { doc: Document; w: number; h: number; keys: string[]; shapes: { key: string; rule: string; m: DOMMatrix }[] };

function readSvg(svgText: string): Svg {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg') throw new Error('The vector could not be read.');
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const aw = parseFloat(root.getAttribute('width') ?? ''), ah = parseFloat(root.getAttribute('height') ?? '');
  const vx = vb[0] || 0, vy = vb[1] || 0, vw = vb[2] || aw || 1000, vh = vb[3] || ah || 1000;
  // The picture's own proportions: its width and height when it gives them (the online AI's SVG is stretched to them).
  const [pw, ph] = aw > 0 && ah > 0 ? [aw, ah] : [vw, vh];
  const k = PSD_LONG_SIDE / Math.max(pw, ph);
  const w = Math.round(pw * k), h = Math.round(ph * k);
  const toPsd = new DOMMatrix().scale(w / vw, h / vh).translate(-vx, -vy);

  // Each shape's colour, fill rule and transform as the browser works them out: the SVG placed off screen to ask.
  const live = document.importNode(root, true) as unknown as SVGSVGElement;
  const holder = document.createElement('div');
  Object.assign(holder.style, { position: 'fixed', left: '-99999px', top: '0', width: '1px', height: '1px', overflow: 'hidden' });
  holder.appendChild(live); document.body.appendChild(holder);
  const shapes: Svg['shapes'] = [];
  try {
    live.querySelectorAll(SHAPES).forEach((el) => {
      const st = getComputedStyle(el);
      let m = new DOMMatrix();
      for (let n: Element | null = el; n && n !== live; n = n.parentElement) {
        const t = (n as SVGGraphicsElement).transform?.baseVal.consolidate();
        if (t) m = new DOMMatrix([t.matrix.a, t.matrix.b, t.matrix.c, t.matrix.d, t.matrix.e, t.matrix.f]).multiply(m);
      }
      shapes.push({ key: st.fill && st.fill !== 'none' ? st.fill : '', rule: st.fillRule, m: toPsd.multiply(m) });
    });
  } finally { holder.remove(); }
  const keys = [...new Set(shapes.map((s) => s.key).filter(Boolean))]; // first drawn first: the bottom layer
  return { doc, w, h, keys, shapes };
}

const svgImage = async (doc: Document, w: number, h: number): Promise<HTMLImageElement> => {
  const root = doc.documentElement;
  root.setAttribute('width', String(w)); root.setAttribute('height', String(h)); root.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
};

/**
 * The coverage (0-255) of the shapes of one colour: only where it shows (others drawn over it in black), or all of
 * its shapes (others left out).
 */
async function coverage(svg: Svg, key: string, visible: boolean): Promise<Uint8ClampedArray> {
  const one = svg.doc.cloneNode(true) as Document;
  [...one.querySelectorAll(SHAPES)].forEach((el, i) => {
    const s = el as SVGElement, mine = svg.shapes[i]!.key === key;
    if (!mine && !visible) { s.setAttribute('display', 'none'); return; }
    s.setAttribute('fill', mine ? '#fff' : '#000'); s.style.fill = mine ? '#fff' : '#000';
    s.setAttribute('stroke', 'none'); s.style.stroke = 'none'; s.removeAttribute('opacity'); s.style.opacity = '1';
    s.removeAttribute('fill-opacity'); s.style.fillOpacity = '1';
  });
  const c = document.createElement('canvas'); Object.assign(c, { width: svg.w, height: svg.h });
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000'; g.fillRect(0, 0, svg.w, svg.h);
  g.drawImage(await svgImage(one, svg.w, svg.h), 0, 0, svg.w, svg.h);
  const px = g.getImageData(0, 0, svg.w, svg.h).data;
  const out = new Uint8ClampedArray(svg.w * svg.h);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4]!;
  return out;
}

/** The largest value within a pixel each way (3 x 3). */
function grow(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(src.length), b = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; a[i] = Math.max(src[i]!, x ? src[i - 1]! : 0, x < w - 1 ? src[i + 1]! : 0); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; b[i] = Math.max(a[i]!, y ? a[i - w]! : 0, y < h - 1 ? a[i + w]! : 0); }
  return b;
}

/**
 * Each colour's visible part, taken from the top layer down, reaching a pixel under the colours drawn over it: where
 * two colours meet, the lower one runs on under the upper one, so no hairline of what is behind shows between them
 * (trapping, as printers do). The layers stacked still give the design. Bottom layer first.
 */
async function visibleParts(svg: Svg): Promise<{ key: string; n: number; cover: Uint8ClampedArray }[]> {
  const above = new Uint8ClampedArray(svg.w * svg.h);
  const parts: { key: string; n: number; cover: Uint8ClampedArray }[] = [];
  for (let n = svg.keys.length - 1; n >= 0; n--) {
    const key = svg.keys[n]!;
    const cover = await coverage(svg, key, true);
    const wide = grow(cover, svg.w, svg.h), out = new Uint8ClampedArray(cover.length);
    for (let i = 0; i < cover.length; i++) { out[i] = Math.max(cover[i]!, Math.min(wide[i]!, above[i]!)); above[i] = above[i]! + cover[i]!; }
    parts.push({ key, n, cover: out });
  }
  return parts.reverse();
}

const rgbOf = (key: string): Rgb | null => (/^rgb/.test(key) ? (key.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Math.round(Number(v))) as Rgb : null);
/** A gradient's colour for a shape layer: the average of what it shows in the merged picture. */
function averageColour(merged: Uint8ClampedArray, cover: Uint8ClampedArray): Rgb {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < cover.length; i++) { const a = cover[i]!; if (a < 128) continue; r += merged[i * 4]! * a; g += merged[i * 4 + 1]! * a; b += merged[i * 4 + 2]! * a; n += a; }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

/** A vector (SVG text) as a PSD: one pixel layer per colour (gradients too), as much of it as shows. */
export async function vectorToPsd(svgText: string): Promise<Blob> {
  const svg = readSvg(svgText);
  const { w, h } = svg;
  const merged = pixels(await svgImage(svg.doc.cloneNode(true) as Document, w, h), w, h);
  const children: Layer[] = [];
  for (const { key, n, cover } of await visibleParts(svg)) {
    const rgb = rgbOf(key);
    // A flat colour in its own colour; a gradient as the merged picture shows it.
    const layer = layerOf(rgb ? `Colour ${n + 1} #${toHex(rgb)}` : `Gradient ${n + 1}`, rgb ?? merged.data, (i) => cover[i]!, w, h);
    if (layer) children.push(layer);
  }
  return save({ width: w, height: h, imageData: merged, children });
}

// --- shape layers ----------------------------------------------------------------------------------------------------

/** A closed outline: its first point, then per curve the two control points and the end (x, y each), in PSD pixels. */
type Outline = number[];

/** An SVG path's outlines, every piece made a cubic curve (lines, quadratic curves and arcs too), absolute. */
export function pathOutlines(d: string): Outline[] {
  const t = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Outline[] = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cur: Outline | null = null;
  let lc: [number, number] | null = null, lq: [number, number] | null = null; // the last control points, for S and T
  const n = () => Number(t[i++]);
  const start = () => { if (!cur) { cur = [x, y]; out.push(cur); } return cur; };
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => { start().push(c1x, c1y, c2x, c2y, ex, ey); x = ex; y = ey; };
  const line = (ex: number, ey: number) => curve(x, y, ex, ey, ex, ey);
  while (i < t.length) {
    if (/[a-zA-Z]/.test(t[i]!)) cmd = t[i++]!;
    else if (!cmd) { i++; continue; }
    const rel = cmd !== cmd.toUpperCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    const was = C;
    if (C === 'M') { x = sx = ox + n(); y = sy = oy + n(); cur = null; start(); cmd = rel ? 'l' : 'L'; }
    else if (C === 'Z') { if (cur && (x !== sx || y !== sy)) line(sx, sy); x = sx; y = sy; cur = null; cmd = ''; }
    else if (C === 'L') line(ox + n(), oy + n());
    else if (C === 'H') line(ox + n(), y);
    else if (C === 'V') line(x, oy + n());
    else if (C === 'C') { const a = [ox + n(), oy + n(), ox + n(), oy + n(), ox + n(), oy + n()] as const; curve(...a); lc = [a[2], a[3]]; }
    else if (C === 'S') {
      const c1: [number, number] = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
      const a = [ox + n(), oy + n(), ox + n(), oy + n()] as const; curve(c1[0], c1[1], a[0], a[1], a[2], a[3]); lc = [a[0], a[1]];
    } else if (C === 'Q' || C === 'T') {
      const q: [number, number] = C === 'Q' ? [ox + n(), oy + n()] : lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y];
      const ex = ox + n(), ey = oy + n();
      curve(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), ex + (2 / 3) * (q[0] - ex), ey + (2 / 3) * (q[1] - ey), ex, ey); lq = q;
    } else if (C === 'A') {
      const rx = n(), ry = n(), phi = n(), fa = n(), fs = n(), ex = ox + n(), ey = oy + n();
      for (const c of arc(x, y, rx, ry, phi, !!fa, !!fs, ex, ey)) curve(...c);
    } else { i++; continue; } // a command it does not know: skipped
    if (was !== 'C' && was !== 'S') lc = null;
    if (was !== 'Q' && was !== 'T') lq = null;
  }
  return out.filter((o) => o.length > 2);
}

/** An elliptical arc as cubic curves (the SVG specification's centre form, a curve per quarter turn at most). */
function arc(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): [number, number, number, number, number, number][] {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const co = Math.cos((phi * Math.PI) / 180), si = Math.sin((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = co * dx + si * dy, yp = -si * dx + co * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (f * rx * yp) / ry, cyp = (-f * ry * xp) / rx;
  const cx = co * cxp - si * cyp + (x1 + x2) / 2, cy = si * cxp + co * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dth = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9)), seg = dth / parts, k = (4 / 3) * Math.tan(seg / 4);
  const at = (u: number, v: number): [number, number] => [cx + rx * u * co - ry * v * si, cy + rx * u * si + ry * v * co];
  const res: [number, number, number, number, number, number][] = [];
  for (let p = 0; p < parts; p++) {
    const a1 = th + p * seg, a2 = a1 + seg;
    const c1 = at(Math.cos(a1) - k * Math.sin(a1), Math.sin(a1) + k * Math.cos(a1));
    const c2 = at(Math.cos(a2) + k * Math.sin(a2), Math.sin(a2) - k * Math.cos(a2));
    const e = p === parts - 1 ? [x2, y2] as [number, number] : at(Math.cos(a2), Math.sin(a2));
    res.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  return res;
}

/** The outlines of any SVG shape element, before its transform. */
function elementOutlines(el: Element): Outline[] {
  const a = (name: string) => parseFloat(el.getAttribute(name) ?? '0') || 0;
  switch (el.nodeName) {
    case 'path': return pathOutlines(el.getAttribute('d') ?? '');
    case 'polygon': case 'polyline': {
      const p = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      return p.length >= 4 ? pathOutlines(`M${p.slice(0, 2).join(' ')} L${p.slice(2).join(' ')} Z`) : [];
    }
    case 'rect': { const x = a('x'), y = a('y'), w = a('width'), h = a('height'); return w > 0 && h > 0 ? pathOutlines(`M${x} ${y} H${x + w} V${y + h} H${x} Z`) : []; }
    case 'circle': case 'ellipse': {
      const cx = a('cx'), cy = a('cy'), rx = el.nodeName === 'circle' ? a('r') : a('rx'), ry = el.nodeName === 'circle' ? a('r') : a('ry');
      return rx > 0 && ry > 0 ? pathOutlines(`M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`) : [];
    }
    default: return [];
  }
}

/** An outline as Photoshop's knots (control in, the point, control out), closed. */
function knots(o: Outline, m?: DOMMatrix): BezierKnot[] {
  const pt =(j: number): [number, number] => { if (!m) return [o[j]!, o[j + 1]!]; const q = m.transformPoint({ x: o[j]!, y: o[j + 1]! }); return [q.x, q.y]; };
  const segs = (o.length - 2) / 6;
  let anchors = segs;
  const [fx, fy] = pt(0), [lx, ly] = pt(o.length - 2);
  const closes = Math.abs(fx - lx) < 1e-6 && Math.abs(fy - ly) < 1e-6;
  if (!closes) anchors += 1; // closed back to the start with a straight line
  const ks: BezierKnot[] = [];
  for (let j = 0; j < anchors; j++) {
    const [ax, ay] = j === 0 ? [fx, fy] : pt(2 + (j - 1) * 6 + 4);
    // In: the second control point of the curve arriving here; out: the first of the curve leaving.
    const into = j === 0 ? (closes ? pt(2 + (segs - 1) * 6 + 2) : [ax, ay] as [number, number]) : pt(2 + (j - 1) * 6 + 2);
    const outOf = j < segs ? pt(2 + j * 6) : [ax, ay] as [number, number];
    ks.push({ linked: false, points: [into[0], into[1], ax, ay, outOf[0], outOf[1]] });
  }
  return ks;
}

/**
 * Where a coverage map crosses half way, as closed outlines (marching squares at the pixel centres, between pixels
 * placed by their values), each smoothed: few points on straight runs, curves through gentle bends, sharp corners kept.
 */
export function traceCoverage(cover: Uint8ClampedArray, w: number, h: number, tolerance = 0.35): BezierKnot[][] {
  const ISO = 127.5, W = w + 2;
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : cover[y * w + x]!);
  // An edge between two neighbouring pixel centres: horizontal (x, y)-(x+1, y) or vertical (x, y)-(x, y+1).
  const hid = (x: number, y: number) => ((y + 1) * W + x + 1) * 2, vid = (x: number, y: number) => ((y + 1) * W + x + 1) * 2 + 1;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => { (links.get(a) ?? links.set(a, []).get(a)!).push(b); (links.get(b) ?? links.set(b, []).get(b)!).push(a); };
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), dd = v(x, y + 1);
    const idx = (a > ISO ? 8 : 0) | (b > ISO ? 4 : 0) | (c > ISO ? 2 : 0) | (dd > ISO ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = hid(x, y), R = vid(x + 1, y), B = hid(x, y + 1), L = vid(x, y);
    const mid = (a + b + c + dd) / 4 > ISO;
    switch (idx) {
      case 1: case 14: link(L, B); break;
      case 2: case 13: link(B, R); break;
      case 3: case 12: link(L, R); break;
      case 4: case 11: link(T, R); break;
      case 6: case 9: link(T, B); break;
      case 7: case 8: link(L, T); break;
      case 5: if (mid) { link(L, T); link(R, B); } else { link(T, R); link(L, B); } break;
      case 10: if (mid) { link(T, R); link(L, B); } else { link(L, T); link(R, B); } break;
    }
  }
  const pos = (id: number): [number, number] => {
    const cell = id >> 1, x = (cell % W) - 1, y = Math.floor(cell / W) - 1;
    const va = v(x, y), vb = id & 1 ? v(x, y + 1) : v(x + 1, y), f = vb === va ? 0.5 : (ISO - va) / (vb - va);
    return id & 1 ? [x + 0.5, y + 0.5 + f] : [x + 0.5 + f, y + 0.5];
  };
  const seen = new Set<number>();
  const rings: BezierKnot[][] = [];
  for (const startId of links.keys()) {
    if (seen.has(startId)) continue;
    const ring: [number, number][] = [];
    let prev = -1, cur = startId;
    for (;;) {
      seen.add(cur); ring.push(pos(cur));
      const nx = links.get(cur)!;
      const next = nx[0] !== prev || nx.length === 1 ? nx[0]! : nx[1]!;
      if (next === startId || seen.has(next)) break;
      prev = cur; cur = next;
    }
    let area = 0;
    for (let j = 0; j < ring.length; j++) { const [x1, y1] = ring[j]!, [x2, y2] = ring[(j + 1) % ring.length]!; area += x1 * y2 - x2 * y1; }
    if (ring.length < 3 || Math.abs(area) / 2 < 1.5) continue; // a speck
    rings.push(smooth(simplify(ring, tolerance)));
  }
  return rings;
}

/** Fewer points along a closed line (Douglas-Peucker), none moved more than tolerance. */
function simplify(ring: [number, number][], tolerance: number): [number, number][] {
  const n = ring.length;
  let far = 0, best = -1;
  for (let j = 1; j < n; j++) { const d = (ring[j]![0] - ring[0]![0]) ** 2 + (ring[j]![1] - ring[0]![1]) ** 2; if (d > best) { best = d; far = j; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = ring[s]!, [bx, by] = ring[e % n]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1, at = -1;
    for (let j = s + 1; j < e; j++) { const [px, py] = ring[j]!; const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len; if (d > worst) { worst = d; at = j; } }
    if (worst > tolerance) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return ring.filter((_, j) => keep[j]);
}

/** Corners stay corners; where the line turns gently, the point gets controls along its direction (a smooth curve). */
function smooth(ring: [number, number][]): BezierKnot[] {
  const n = ring.length;
  return ring.map(([x, y], j) => {
    const [px, py] = ring[(j - 1 + n) % n]!, [nx, ny] = ring[(j + 1) % n]!;
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
    const turn = l1 && l2 ? Math.acos(Math.max(-1, Math.min(1, ((x - px) * (nx - x) + (y - py) * (ny - y)) / (l1 * l2)))) : Math.PI;
    if (turn > (40 * Math.PI) / 180) return { linked: false, points: [x, y, x, y, x, y] };
    const tl = Math.hypot(nx - px, ny - py) || 1, tx = (nx - px) / tl, ty = (ny - py) / tl;
    return { linked: true, points: [x - (tx * l1) / 3, y - (ty * l1) / 3, x, y, x + (tx * l2) / 3, y + (ty * l2) / 3] };
  });
}

/**
 * A vector (SVG text) as a PSD of shape layers, one per colour. With each colour drawn in one go and no gradients (our
 * screen-print vectors), the shapes are the SVG's own curves and the layers stack as it drew them; otherwise each
 * colour's visible part is traced (gradients become their average colour).
 */
export async function vectorToShapesPsd(svgText: string): Promise<Blob> {
  const svg = readSvg(svgText);
  const { w, h } = svg;
  const merged = pixels(await svgImage(svg.doc.cloneNode(true) as Document, w, h), w, h);
  const seq = svg.shapes.map((s) => s.key).filter(Boolean).filter((k, j, all) => j === 0 || all[j - 1] !== k);
  const ownCurves = seq.length === svg.keys.length && svg.keys.every((k) => rgbOf(k));
  const elements = ownCurves ? [...svg.doc.querySelectorAll(SHAPES)] : [];
  const children: Layer[] = [];
  const parts = ownCurves ? svg.keys.map((key, n) => ({ key, n, cover: null as Uint8ClampedArray | null })) : await visibleParts(svg);
  for (const part of parts) {
    const { key, n } = part;
    const cover = part.cover ?? await coverage(svg, key, false);
    const rgb = rgbOf(key) ?? averageColour(merged.data, cover);
    const layer = layerOf(`Colour ${n + 1} #${toHex(rgb)}${rgbOf(key) ? '' : ' (was a gradient)'}`, rgb, (i) => cover[i]!, w, h);
    if (!layer) continue;
    const paths: BezierPath[] = [];
    if (ownCurves) {
      svg.shapes.forEach((s, j) => {
        if (s.key !== key) return;
        // A shape's first outline adds to the layer; the rest (its holes) cut out of it.
        elementOutlines(elements[j]!).forEach((o, q) => paths.push({ open: false, operation: q ? 'exclude' : 'combine', fillRule: 'even-odd', knots: knots(o, s.m) }));
      });
    } else {
      traceCoverage(cover, w, h).forEach((ks) => paths.push({ open: false, operation: 'exclude', fillRule: 'even-odd', knots: ks }));
    }
    if (!paths.length) continue;
    children.push({ ...layer, vectorFill: { type: 'color', color: { r: rgb[0], g: rgb[1], b: rgb[2] } }, vectorMask: { paths } });
  }
  return save({ width: w, height: h, imageData: merged, children });
}
