/** Dark screens (the owner's request, Nov 2026): the dark copies dark-css.ts adds, and the light ones it leaves alone. */
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { darkTheme, darkValue, darkVariables, hexToOklch, tailwindScales } from './dark-css.ts';

describe('the dark value of a declaration', () => {
  it('turns white backgrounds into the card colour and keeps white text white', () => {
    expect(darkValue('background-color', 'var(--color-white)')).toBe('var(--dk-card)');
    expect(darkValue('color', 'var(--color-white)')).toBeNull();
  });
  it('keeps dark backgrounds dark (a button hover, a dark bar), and lightens mid-tone colour text but not grey text', () => {
    expect(darkValue('background-color', 'var(--color-indigo-700)')).toBe('var(--dk-solid-indigo-700, var(--color-indigo-700))');
    expect(darkValue('background-color', 'var(--color-slate-900)')).toBe('var(--dk-solid-slate-900, var(--color-slate-900))');
    expect(darkValue('color', 'var(--color-red-600)')).toBe('var(--dk-text-red-600)');
    expect(darkValue('color', 'var(--color-slate-600)')).toBeNull(); // the greys turn over by themselves
    expect(darkValue('background-color', 'var(--color-slate-50)')).toBeNull();
  });
  it('turns fixed colours over: dark text becomes light, a pale background dark, white text stays', () => {
    const text = darkValue('color', '#0f172a')!;
    expect(hexToOklch('#0f172a')!.l).toBeLessThan(0.3);
    expect(Number(/oklch\(([\d.]+)%/.exec(text)![1])).toBeGreaterThan(80);
    expect(Number(/oklch\(([\d.]+)%/.exec(darkValue('background-color', '#f4f5f7')!)![1])).toBeLessThan(30);
    expect(darkValue('color', '#ffffff')).toBeNull();
  });
});

describe('the PostCSS step', () => {
  const css = `@layer theme { :root { --color-white: #fff; } }
@layer utilities {
  .bg-white { background-color: var(--color-white); }
  .text-slate-500 { color: var(--color-slate-500); }
  @media (hover: hover) { .hover\\:bg-indigo-700:hover { background-color: var(--color-indigo-700); } }
}
.outside { background-color: var(--color-white); }`;
  const out = () => postcss([darkTheme(tailwindScales())]).process(css, { from: undefined }).css;

  it('adds a dark copy beside a rule that needs one, for screens only and at the same specificity, and leaves the light rules as they were', () => {
    const result = out();
    expect(result).toContain('.bg-white { background-color: var(--color-white); }');
    expect(result).toMatch(/@media screen \{\s*:where\(:root\[data-theme="dark"\]\) \.bg-white \{ background-color: var\(--dk-card\); \}/);
    expect(result).toMatch(/:where\(:root\[data-theme="dark"\]\) \.hover\\:bg-indigo-700:hover \{ background-color: var\(--dk-solid-indigo-700/);
    expect(result).not.toMatch(/data-theme="dark"\]\) \.text-slate-500/); // nothing to add: its colour turns over
    expect(result).not.toMatch(/data-theme="dark"\]\) \.outside/); // only Tailwind's utilities
  });

  it('gives every colour scale its dark values, the greys turned end to end', () => {
    const vars = darkVariables(tailwindScales());
    const l = (name: string) => Number(new RegExp(`^${name}: oklch\\(([\\d.]+)%`).exec(vars.find((v) => v.startsWith(`${name}:`))!)![1]);
    expect(l('--color-slate-50')).toBeLessThan(30);
    expect(l('--color-slate-900')).toBeGreaterThan(90);
    expect(l('--color-amber-50')).toBeLessThan(30);
    expect(l('--color-amber-800')).toBeGreaterThan(80);
    expect(l('--dk-solid-indigo-700')).toBeLessThan(55); // white text on it stays readable
    expect(out()).toContain(':root[data-theme="dark"]');
  });
});
