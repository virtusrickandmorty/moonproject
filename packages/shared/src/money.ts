/**
 * Money is always an integer number of centavos (PLAN C5). No floating point in posting.
 */
export type Cents = number;

export function isCents(v: unknown): v is Cents {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

export function assertCents(v: unknown, what = 'amount'): asserts v is Cents {
  if (!isCents(v)) throw new Error(`${what} must be a whole number of centavos`);
}

/** Parses "1,234.56", "₱1,234.5" or "-20" into centavos. Rejects more than 2 decimals. */
export function parsePesos(text: string): Cents {
  const s = text.replace(/[₱,\s]/g, '');
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`"${text}" is not a peso amount`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error(`"${text}" is too large`);
  return m[1] ? -cents : cents;
}

/** 1234567 -> "12,345.67" (no peso sign). */
export function formatPesos(cents: Cents): string {
  assertCents(cents);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export function formatPeso(cents: Cents): string {
  const s = formatPesos(cents);
  return s.startsWith('-') ? `-₱${s.slice(1)}` : `₱${s}`;
}

/** round_half_away_from_zero(a / b) for integers, b > 0. */
export function divRoundHalfAway(a: number, b: number): number {
  if (b <= 0 || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error('bad division');
  const q = Math.floor((Math.abs(a) * 2 + b) / (2 * b));
  return a < 0 && q !== 0 ? -q : q;
}

/**
 * VAT inside a VAT-inclusive gross (PLAN D4.1). rateBp in basis points (1200 = 12%).
 * VAT = round_half_away(G × r / (1 + r)); NET = G − VAT.
 */
export function vatFromGross(grossCents: Cents, rateBp: number): { netCents: Cents; vatCents: Cents } {
  assertCents(grossCents, 'gross');
  const vatCents = divRoundHalfAway(grossCents * rateBp, 10000 + rateBp);
  return { netCents: grossCents - vatCents, vatCents };
}

/** round_half_away(base × rate) with rate in basis points (PLAN D4.5). */
export function applyRate(baseCents: Cents, rateBp: number): Cents {
  assertCents(baseCents, 'base');
  return divRoundHalfAway(baseCents * rateBp, 10000);
}

/**
 * Splits total into parts proportional to weights by largest remainder, so Σ parts = total exactly.
 * Ties go to the earlier index.
 */
export function allocate(totalCents: Cents, weights: readonly number[]): Cents[] {
  assertCents(totalCents, 'total');
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || sumW <= 0 || weights.some((w) => w < 0 || !Number.isSafeInteger(w))) {
    throw new Error('weights must be non-negative integers with a positive sum');
  }
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const parts = weights.map((w) => Math.floor((abs * w) / sumW));
  const rems = weights.map((w, i) => ({ i, r: (abs * w) % sumW }));
  let left = abs - parts.reduce((a, b) => a + b, 0);
  rems.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of rems) {
    if (left <= 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts.map((p) => p * sign);
}
