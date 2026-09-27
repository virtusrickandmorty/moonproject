/** A tiny history router with readable URLs such as /docs/cash.transfer/new (PLAN H1). */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

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

export function Link({ to, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const go = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} {...rest} onClick={go} />;
}
