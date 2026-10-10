/** Which table-row clicks open the row's link (the owner's request, Oct 2026), on a small stand-in for the page's elements. */
import { describe, expect, it } from 'vitest';
import { rowLinkFor } from './rowLinks.ts';

/** A stand-in element: a tag, attributes, classes and children, with the few lookups rowLinkFor makes. */
class El {
  parent: El | null = null;
  constructor(public tag: string, public attrs: Record<string, string> = {}, public kids: El[] = []) { for (const k of kids) k.parent = this; }
  get classList() { return { contains: (c: string) => (this.attrs.class ?? '').split(' ').includes(c) }; }
  hasAttribute(a: string) { return a in this.attrs; }
  /** One simple selector: a tag, [a="v"], [a], tag[a], or "tbody tr". */
  private is(sel: string): boolean {
    sel = sel.trim();
    if (sel === 'tbody tr') return this.tag === 'tr' && !!this.parent && this.parent.tag === 'tbody';
    const m = /^([a-z]*)(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(sel)!;
    return (!m[1] || m[1] === this.tag) && (!m[2] || (m[3] === undefined ? m[2] in this.attrs : this.attrs[m[2]] === m[3]));
  }
  private matches(list: string) { return list.split(',').some((s) => this.is(s)); }
  closest(list: string): El | null { for (let at: El | null = this; at; at = at.parent) if (at.matches(list)) return at; return null; }
  querySelector(list: string): El | null { for (const k of this.kids) { if (k.matches(list)) return k; const deep = k.querySelector(list); if (deep) return deep; } return null; }
}
const row = (attrs: Record<string, string>, ...cells: El[]) => new El('table', {}, [new El('tbody', {}, [new El('tr', attrs, cells.map((c) => new El('td', {}, [c])))])]);
const cell = (t: El) => t.kids[0]!.kids[0]!.kids;
const open = (target: El) => rowLinkFor(target as unknown as Element) as unknown as El | null;

describe('clickable table rows', () => {
  it('opens the first link of a row clicked anywhere, not on its own controls', () => {
    const link = new El('a', { href: '/docs/ap.bill/1' });
    const t = row({}, link, new El('span'), new El('button'));
    const [first, plain, button] = cell(t);
    expect(open(plain!.kids[0]!)).toBe(link);
    expect(open(first!.kids[0]!)).toBeNull(); // the link itself: it opens on its own
    expect(open(button!.kids[0]!)).toBeNull();
  });

  it('leaves form rows, rows a screen already handles, rows switched off and rows with no link', () => {
    const form = row({}, new El('a', { href: '/x' }), new El('input'), new El('span'));
    expect(open(cell(form)[2]!.kids[0]!)).toBeNull();
    for (const attrs of [{ class: 'border-t cursor-pointer' }, { tabindex: '0' }] as Record<string, string>[]) {
      const own = row(attrs, new El('a', { href: '/x' }), new El('span'));
      expect(open(cell(own)[1]!.kids[0]!)).toBeNull();
    }
    const off = new El('div', { 'data-row-link': 'off' }, [row({}, new El('a', { href: '/x' }), new El('span'))]);
    expect(open(cell(off.kids[0]!)[1]!.kids[0]!)).toBeNull();
    expect(open(cell(row({}, new El('span'), new El('span')))[1]!.kids[0]!)).toBeNull();
  });
});
