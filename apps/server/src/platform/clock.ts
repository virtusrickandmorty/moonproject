import { AppError, manilaDate, manilaTimestamp } from '@moonproject/shared';

/** Everything that needs "now" takes a Clock, so tests can pin the date. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock & { set(iso: string): void; advance(ms: number): void } {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    set: (s: string) => {
      t = new Date(s).getTime();
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const today = (c: Clock) => manilaDate(c.now());
export const stamp = (c: Clock) => manilaTimestamp(c.now());

/** How far the clock may appear to go backwards before posting is blocked (PLAN C8, N-09). */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

export function clockBackwardsError(lastSeen: string): AppError {
  return new AppError(
    'CLOCK_BEHIND',
    `The server clock is earlier than the last recorded activity (${lastSeen}). Recording is paused until the clock is fixed. Open System Health for steps.`,
    503,
  );
}
