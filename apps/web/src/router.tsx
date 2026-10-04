/** A tiny history router with readable URLs such as /docs/cash.transfer/new (PLAN H1). */
import { createContext, useContext, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener('popstate', l);
  return () => (listeners.delete(l), window.removeEventListener('popstate', l));
}

export function navigate(to: string): void {
  history.pushState(null, '', to);
  window.scrollTo(0, 0);
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
