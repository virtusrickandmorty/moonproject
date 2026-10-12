/**
 * Cash to prepare for a payroll release (the owner's request, Oct 2026): each person's net pay counted out in Philippine
 * bills and coins, largest first, so each envelope can be filled and the bank withdrawal asked for by denomination.
 * Pure, in centavos.
 */
export const BILLS = [100_000, 50_000, 20_000, 10_000, 5_000, 2_000] as const; // ₱1,000 ₱500 ₱200 ₱100 ₱50 ₱20
export const COINS = [2_000, 1_000, 500, 100, 25, 5, 1] as const; // ₱20 ₱10 ₱5 ₱1 25¢ 5¢ 1¢ (the ₱20 coin only after the bills)

export interface CashBreakdown {
  /** Bills by value in centavos, how many of each. */
  bills: Record<number, number>;
  /** Coins by value in centavos, how many of each. */
  coins: Record<number, number>;
  /** What the coins add up to, in centavos. */
  coinCents: number;
}

/** One amount in the fewest bills, then coins for what is under ₱20. */
export function breakdown(cents: number): CashBreakdown {
  let left = Math.max(0, Math.round(cents));
  const bills: Record<number, number> = {};
  for (const b of BILLS) { bills[b] = Math.floor(left / b); left -= bills[b]! * b; }
  const coinCents = left;
  const coins: Record<number, number> = {};
  for (const c of COINS) { coins[c] = Math.floor(left / c); left -= coins[c]! * c; }
  return { bills, coins, coinCents };
}

/** Several breakdowns added up: what to withdraw for all of them. */
export function addUp(all: CashBreakdown[]): CashBreakdown {
  const out: CashBreakdown = { bills: Object.fromEntries(BILLS.map((b) => [b, 0])), coins: Object.fromEntries(COINS.map((c) => [c, 0])), coinCents: 0 };
  for (const x of all) {
    for (const b of BILLS) out.bills[b]! += x.bills[b] ?? 0;
    for (const c of COINS) out.coins[c]! += x.coins[c] ?? 0;
    out.coinCents += x.coinCents;
  }
  return out;
}

/** A denomination as printed: ₱1,000, ₱20, 25¢. */
export const denomination = (cents: number) => (cents >= 100 ? `₱${(cents / 100).toLocaleString('en-PH')}` : `${cents}¢`);
