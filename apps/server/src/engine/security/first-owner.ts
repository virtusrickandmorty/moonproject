/**
 * What happens when a new shop's first owner is made (the owner's request, Oct 2026): modules register here, so the
 * security engine imports none of them. `freshPriceList`: the first-run screen asks for a price list with nothing in it
 * (no starter rates); the API alone (tests, the practice shop's made-up data) keeps the starters.
 */
import type { Db } from '../../platform/db/driver.ts';

export interface FirstOwner { userId: string; at: string; freshPriceList: boolean }
const listeners: ((db: Db, owner: FirstOwner) => void)[] = [];

export function onFirstOwner(fn: (db: Db, owner: FirstOwner) => void): void {
  if (!listeners.includes(fn)) listeners.push(fn);
}

/** Runs inside the first owner's transaction. */
export const firstOwnerMade = (db: Db, owner: FirstOwner) => listeners.forEach((fn) => fn(db, owner));
