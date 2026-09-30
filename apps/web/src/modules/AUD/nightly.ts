import type { NightlyCheck, NightlyStatus } from '../../api.ts';

/** The red line on the owner's and accountant's Home; null when last night found nothing (or none has run). */
export function nightlyLine(s: NightlyStatus): string | null {
  if (!s.night || s.foundCount === 0) return null;
  const names = s.found.map((c) => c.label.toLowerCase()).join(', ');
  return `Last night's checks (${s.night}) found ${s.foundCount === 1 ? 'something' : `${s.foundCount} things`} to look at: ${names}.`;
}

/** "3 found" or "Passed", for a check's row. */
export const checkResult = (c: Pick<NightlyCheck, 'passed' | 'foundCount'>) => (c.passed ? 'Passed' : `${c.foundCount} found`);
