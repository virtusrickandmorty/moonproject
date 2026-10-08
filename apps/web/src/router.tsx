/** A tiny history router with readable URLs such as /docs/cash.transfer/new (PLAN H1). */
import { createContext, useContext, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener('popstate', l);
  return () => (listeners.delete(l), window.removeEventListener('popstate', l));
}

/**
 * A screen on display may take over addresses (a document list shows its own documents in dialogs over itself): it
 * returns the address to go to instead, and `replace` when that step should not stay in Back's history.
 */
export type Rewrite = (to: string) => { to: string; replace?: boolean } | null;
const rewrites = new Set<Rewrite>();
export function addRewrite(r: Rewrite): () => void {
  rewrites.add(r);
  return () => void rewrites.delete(r);
}

export function navigate(to: string, { replace = false } = {}): void {
  for (const r of rewrites) {
    const out = r(to);
    if (out) { to = out.to; replace ||= !!out.replace; break; }
  }
  const stay = to.split('?')[0] === window.location?.pathname; // a dialog over the same page: keep the scroll
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  if (!stay) window.scrollTo(0, 0);
  listeners.forEach((l) => l());
}

/** Path and query, e.g. "/docs/cash.transfer/new?draft=…". */
export const useLocation = () => useSyncExternalStore(subscribe, () => location.pathname + location.search);

/** match('/docs/:type/:id', '/docs/cash.transfer/abc') -> { type: 'cash.transfer', id: 'abc' } */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (const [i, part] of p.entries()) {
    if (part.startsWith(':')) out[part.slice(1)] = decodeURIComponent(s[i]!);
    else if (part !== s[i]) return null;
  }
  return out;
}

/**
 * Inside the ERP: whether the signed-in user may open an address (set by the shell from their permissions). A link to a
 * page they cannot open shows as plain text instead. Outside it (the public website) every link is a link.
 */
export const LinkAccess = createContext<((to: string) => boolean) | null>(null);
/** Link looks (underline, hover, link colours) taken off a link shown as plain text. */
const plainText = (className = '') => className.split(/\s+/).filter((c) => !/^(underline|hover:|focus:|cursor-|text-(indigo|blue|sky)-)/.test(c)).join(' ');

export function Link({ to, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const mayOpen = useContext(LinkAccess);
  if (mayOpen && to.startsWith('/') && !mayOpen(to)) return <span className={plainText(rest.className)} title={rest.title}>{rest.children}</span>;
  const go = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} {...rest} onClick={go} />;
}
