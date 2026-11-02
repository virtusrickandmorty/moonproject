/**
 * Dark screens (the owner's request, Nov 2026) without a `dark:` class on every screen: a PostCSS step after Tailwind
 * (vite.config.ts) gives every colour a dark value under `:root[data-theme="dark"]`, which theme.ts sets on the ERP's
 * screens only (never the website or the customers' order-link page). Screens only: a printout stays as it is.
 *
 * - Each colour scale is turned over: the pale tints (50 to 400) used for backgrounds, chips, borders and rings become
 *   dark tints of the same hue, the deep shades (700 to 950) used for text become light ones, 500 and 600 stay mid tones
 *   (a 600 button still carries white text). The greys (slate, gray, …) turn over end to end, 600 included.
 * - What a light value cannot cover is added rule by rule, beside Tailwind's own, at the same specificity so a hover still
 *   wins: white backgrounds become the card colour (white text stays white), backgrounds in 700 to 950 (a button's
 *   hover, a dark bar) stay dark, text in a colour's 500 or 600 is lightened, and fixed colours (`text-[#0f172a]`)
 *   have their lightness turned over.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { AtRule, Container, Declaration, Plugin, Root, Rule } from 'postcss';

type Okl = { l: number; c: number; h: number };
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const NEUTRAL = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone', 'mauve', 'olive', 'mist', 'taupe']);
const DARK = ':root[data-theme="dark"]';

// Lightness (oklch) on the dark screens. The card is 0.215 and the page behind it 0.175.
const PAGE_L = 0.175;
const CARD_L = 0.215;
const TONE: Record<number, [number, number]> = { // colour scales: [lightness, share of the scale's chroma]
  50: [0.25, 0.16], 100: [0.28, 0.22], 200: [0.33, 0.3], 300: [0.42, 0.45], 400: [0.54, 0.7], 500: [0.64, 0.95],
  600: [0.56, 0.95], 700: [0.82, 0.55], 800: [0.87, 0.42], 900: [0.92, 0.28], 950: [0.95, 0.18],
};
const GREY: Record<number, number> = { 50: 0.245, 100: 0.275, 200: 0.33, 300: 0.41, 400: 0.56, 500: 0.69, 600: 0.77, 700: 0.84, 800: 0.9, 900: 0.94, 950: 0.97 };
const SOLID: Record<number, [number, number]> = { 700: [0.49, 0.85], 800: [0.43, 0.75], 900: [0.37, 0.6], 950: [0.31, 0.5] }; // backgrounds that stay dark
const SOLID_GREY: Record<number, number> = { 700: 0.38, 800: 0.335, 900: 0.3, 950: 0.265 };
const TEXT: Record<number, [number, number]> = { 500: [0.76, 0.75], 600: [0.78, 0.7] }; // text in a colour's mid tones
/** The app's indigo is Star Admin's blue (index.css), not Tailwind's: its hue and chroma, as oklch. */
const OWN: Record<string, Okl> = { indigo: { l: 0.4, c: 0.19, h: 266 } };

const ok = ({ l, c, h }: Okl) => `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;

/** Tailwind's colour scales (its theme.css): each step's lightness, chroma and hue. */
export function tailwindScales(css = readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8')): Map<string, Map<number, Okl>> {
  const out = new Map<string, Map<number, Okl>>();
  for (const m of css.matchAll(/--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)) {
    if (!out.has(m[1]!)) out.set(m[1]!, new Map());
    out.get(m[1]!)!.set(Number(m[2]), { l: Number(m[3]) / 100, c: Number(m[4]), h: Number(m[5]) });
  }
  return out;
}

/** The dark values: every scale's steps, the card and page, and the extra ones the added rules use. */
export function darkVariables(scales: Map<string, Map<number, Okl>>): string[] {
  const out = ['color-scheme: dark', `--dk-card: ${ok({ l: CARD_L, c: 0.012, h: 260 })}`, `--color-page: ${ok({ l: PAGE_L, c: 0.01, h: 260 })}`,
    `--color-muted: ${ok({ l: 0.69, c: 0.02, h: 257 })}`, '--shadow-sm: 0 4px 16px 0 rgb(0 0 0 / 0.35)', `--color-black: ${ok({ l: 0.97, c: 0, h: 0 })}`];
  for (const [name, steps] of scales) {
    const base = OWN[name] ?? steps.get(500);
    if (!base) continue;
    for (const s of STEPS) {
      const h = OWN[name]?.h ?? steps.get(s)?.h ?? base.h;
      if (NEUTRAL.has(name)) {
        out.push(`--color-${name}-${s}: ${ok({ l: GREY[s]!, c: Math.min(base.c, 0.04) * 0.8, h })}`);
        if (SOLID_GREY[s]) out.push(`--dk-solid-${name}-${s}: ${ok({ l: SOLID_GREY[s]!, c: Math.min(base.c, 0.04) * 0.8, h })}`);
        continue;
      }
      const [l, share] = TONE[s]!;
      out.push(`--color-${name}-${s}: ${ok({ l, c: base.c * share, h })}`);
      if (SOLID[s]) out.push(`--dk-solid-${name}-${s}: ${ok({ l: SOLID[s]![0], c: base.c * SOLID[s]![1], h })}`);
      if (TEXT[s]) out.push(`--dk-text-${name}-${s}: ${ok({ l: TEXT[s]![0], c: base.c * TEXT[s]![1], h })}`);
    }
  }
  return out;
}

/** A fixed colour (#rgb, #rrggbb, #rrggbbaa) as oklch. */
export function hexToOklch(hex: string): (Okl & { a: number }) | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!m) return null;
  const x = m[1]!.length <= 4 ? [...m[1]!].map((d) => d + d).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => { const v = parseInt(x.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  const a = x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1;
  const L = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const M = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const S = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * L + 0.793617785 * M - 0.0040720468 * S;
  const A = 1.9779984951 * L - 2.428592205 * M + 0.4505937099 * S;
  const B = 0.0259040371 * L + 0.7827717662 * M - 0.808675766 * S;
  return { l, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360, a };
}

/** A fixed colour with its lightness turned over: dark text becomes light, a pale background dark. */
export function turnedOver(hex: string, background: boolean): string | null {
  const o = hexToOklch(hex);
  if (!o || o.l > 0.995 && !background) return null; // white text stays white
  const l = background ? (o.l > 0.6 ? CARD_L + (1 - o.l) * 0.5 : o.l) : (o.l < 0.6 ? 1 - o.l * 0.55 : o.l);
  if (Math.abs(l - o.l) < 0.005) return null;
  const color = ok({ l, c: o.c * (background ? 0.5 : 0.8), h: o.h });
  return o.a < 1 ? color.replace(')', ` / ${o.a.toFixed(2)})`) : color;
}

const BACKGROUND = /^(background|background-color|--tw-gradient-(from|via|to))$/;
const EDGE = /^(border(-[a-z]+)*-color|border|outline-color|--tw-ring-color|--tw-ring-offset-color|--tw-shadow-color|fill|stroke)$/;

/** One declaration's dark value, or null when its light value already turns over. */
export function darkValue(prop: string, value: string): string | null {
  let v = value;
  if (BACKGROUND.test(prop) || EDGE.test(prop)) v = v.replace(/var\(--color-white\)/g, 'var(--dk-card)');
  if (BACKGROUND.test(prop)) v = v.replace(/var\(--color-([a-z]+)-(700|800|900|950)\)/g, 'var(--dk-solid-$1-$2, var(--color-$1-$2))');
  if (prop === 'color') v = v.replace(/var\(--color-([a-z]+)-(500|600)\)/g, (all, name: string, step: string) => (NEUTRAL.has(name) ? all : `var(--dk-text-${name}-${step})`));
  if (prop === 'color' || BACKGROUND.test(prop) || EDGE.test(prop)) {
    v = v.replace(/#[0-9a-f]{3,8}\b/gi, (hex) => turnedOver(hex, !(prop === 'color' || prop === 'fill' || prop === 'stroke')) ?? hex);
  }
  return v === value ? null : v;
}

const inUtilities = (node: Rule) => {
  for (let p: Container | undefined = node.parent; p; p = p.parent as Container | undefined) {
    if (p.type === 'atrule' && (p as AtRule).name === 'layer') return /^(utilities|components)$/.test((p as AtRule).params);
  }
  return false;
};

/** The PostCSS step: the dark values on :root, and beside each rule that needs it, its dark copy (screens only). */
export function darkTheme(scales = tailwindScales()): Plugin {
  return {
    postcssPlugin: 'moonproject-dark-theme',
    Once(root: Root, { atRule, rule, decl }) {
      if (!root.toString().includes('@layer utilities')) return; // only Tailwind's own sheet
      root.walkRules((r) => {
        if (!inUtilities(r) || r.selector.includes(DARK)) return;
        const copy = r.clone();
        let changed = false;
        copy.walkDecls((d: Declaration) => {
          const v = darkValue(d.prop, d.value);
          if (v === null) return;
          d.value = v;
          changed = true;
        });
        if (!changed) return;
        copy.selectors = r.selectors.map((s) => `:where(${DARK}) ${s}`);
        r.after(atRule({ name: 'media', params: 'screen' }).append(copy));
      });
      const vars = rule({ selector: DARK });
      for (const line of darkVariables(scales)) {
        const at = line.indexOf(':');
        vars.append(decl({ prop: line.slice(0, at), value: line.slice(at + 1).trim() }));
      }
      const body = rule({ selector: `${DARK} body` }).append(decl({ prop: 'background-color', value: 'var(--color-page)' }), decl({ prop: 'color', value: 'var(--color-slate-900)' }));
      root.append(atRule({ name: 'media', params: 'screen' }).append(vars, body));
    },
  };
}
darkTheme.postcss = true;
