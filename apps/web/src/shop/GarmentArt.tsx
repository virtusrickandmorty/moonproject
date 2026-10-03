/** A flat drawing of a garment in the chosen colour, in place of product photos (the page never fetches an image). */
import type { Shape } from './products.ts';

const BODY: Record<Shape, string> = {
  tee: 'M70 30 L50 36 L22 62 L38 84 L56 72 L56 172 L144 172 L144 72 L162 84 L178 62 L150 36 L130 30 Q100 52 70 30 Z',
  polo: 'M70 30 L50 36 L22 62 L38 84 L56 72 L56 172 L144 172 L144 72 L162 84 L178 62 L150 36 L130 30 L112 30 L100 56 L88 30 Z',
  jersey: 'M72 28 L56 32 Q60 70 44 80 L44 172 L156 172 L156 80 Q140 70 144 32 L128 28 Q100 66 72 28 Z',
  jacket: 'M72 28 L48 36 L24 70 L22 168 L44 168 L50 92 L54 172 L146 172 L150 92 L156 168 L178 168 L176 70 L152 36 L128 28 Q100 44 72 28 Z',
  hoodie: 'M76 34 Q100 4 124 34 L150 40 L176 72 L176 166 L154 166 L148 96 L148 172 L52 172 L52 96 L46 166 L24 166 L24 72 L50 40 Z',
  shorts: 'M48 52 L152 52 L162 156 L110 160 L100 100 L90 160 L38 156 Z',
};
/** Seams and trims drawn on top, a shade darker than the cloth. */
const TRIM: Record<Shape, string> = {
  tee: 'M70 30 Q100 52 130 30',
  polo: 'M88 30 L100 56 L112 30 M100 56 L100 84',
  jersey: 'M72 28 Q100 66 128 28 M56 32 Q60 70 44 80 M144 32 Q140 70 156 80',
  jacket: 'M100 44 L100 172 M56 160 L144 160 M24 158 L44 158 M156 158 L178 158',
  hoodie: 'M76 34 Q100 70 124 34 M72 128 L128 128 L120 150 L80 150 Z',
  shorts: 'M48 64 L152 64 M100 52 L100 100',
};

/** Picks dark or light lines so trims show on any cloth. */
const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
};

export function GarmentArt({ shape, colour, className = '' }: { shape: Shape; colour: string; className?: string }) {
  const line = isLight(colour) ? 'rgb(15 23 42 / 0.35)' : 'rgb(255 255 255 / 0.4)';
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <ellipse cx="100" cy="184" rx="62" ry="6" fill="rgb(15 23 42 / 0.08)" />
      <path d={BODY[shape]} fill={colour} stroke="rgb(15 23 42 / 0.25)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={TRIM[shape]} fill="none" stroke={line} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
