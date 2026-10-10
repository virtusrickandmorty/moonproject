/**
 * Clickable table rows across the ERP (the owner's request, Oct 2026: "some tables are not clickable yet"). A row whose
 * cells link somewhere opens its first link when clicked anywhere, as the job order and employee lists do, without
 * changing each screen. Left alone: a row with a box to type or pick in (a form row: a stray click must not leave the
 * form), a row a screen already makes clickable (cursor-pointer or tabIndex), a click on a control of its own, and a
 * click that ends a text selection. The page area's CSS shows the pointer on these rows (index.css).
 */

const CONTROLS = 'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [role="switch"], [contenteditable="true"]';

/** The link a click on a table row should follow, or null when the row is not one to open this way. */
export function rowLinkFor(target: Element | null): HTMLAnchorElement | null {
  if (!target || target.closest(CONTROLS)) return null;
  const row = target.closest('tbody tr');
  if (!row || row.closest('[data-row-link="off"]')) return null;
  if (row.classList.contains('cursor-pointer') || row.hasAttribute('tabindex')) return null; // the screen's own click
  if (row.querySelector('input, select, textarea')) return null; // a form row
  return row.querySelector<HTMLAnchorElement>('a[href]');
}

/** Follows the row's link on a plain click (the app's own navigation); Ctrl or ⌘ opens it in a new tab. */
export function followRowLink(e: MouseEvent): void {
  if (e.button !== 0 || e.defaultPrevented) return;
  if ((window.getSelection?.()?.toString() ?? '') !== '') return; // selecting text, not opening
  const link = rowLinkFor(e.target as Element | null);
  if (!link) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(link.href, '_blank', 'noopener');
  else link.click();
}
