/**
 * Zooming a picture in the image tools (the owner's request, Oct 2026): the view is a scale and an offset of the picture
 * in its frame. Zoom 1 is the whole picture fitted; the picture never drifts off the frame's edges.
 */
export type View = { z: number; x: number; y: number };
export const FIT: View = { z: 1, x: 0, y: 0 };
export const MAX_ZOOM = 16;

/** Keeps the picture covering the frame (w × h): no empty gap at an edge. */
export function limit(v: View, w: number, h: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  const clamp = (n: number, size: number) => Math.min(0, Math.max(size - size * z, n));
  return { z, x: clamp(v.x, w), y: clamp(v.y, h) };
}

/** Zooms by factor keeping the point (px, py) of the frame still: the spot under the mouse stays under it. */
export function zoomAt(v: View, factor: number, px: number, py: number, w: number, h: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z * factor));
  const k = z / v.z;
  return limit({ z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, w, h);
}
