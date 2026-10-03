/**
 * Every menu group open. A long menu folds (apps/web/src/shell/menu.ts openGroups) and the browser remembers what was
 * opened; the specs click menu items by name, wherever they are, so their browsers start with every group open.
 * 01-first-run checks the folding itself.
 */
import { MENU_FOLDS_KEY, MENU_GROUPS } from '../apps/web/src/shell/menu';

export const MENU_ALL_OPEN = { name: MENU_FOLDS_KEY, value: JSON.stringify(Object.fromEntries(MENU_GROUPS.map((g) => [g, true]))) };

/** A Playwright storageState for the shop at `origin`: no cookies, every menu group open. */
export const menuOpenAt = (origin: string) => ({ cookies: [], origins: [{ origin, localStorage: [MENU_ALL_OPEN] }] });
