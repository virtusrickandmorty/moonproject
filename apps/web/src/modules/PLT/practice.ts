/** Practice mode's words and address (PLAN C8), kept apart from the screens so they can be tested. */
import type { PracticeStatus } from '../../api.ts';

/** The practice shop is this same PC on its own port, over the same kind of address the page was opened with. */
export function practiceAddress(location: { protocol: string; hostname: string }, port: number): string {
  return `${location.protocol}//${location.hostname}:${port}/`;
}

/** One sentence on where the practice shop stands. */
export function practiceLine(s: PracticeStatus): string {
  switch (s.state) {
    case 'off': return 'Practice mode is off on this PC. The Windows installer turns it on.';
    case 'here': return 'You are in the practice shop.';
    case 'preparing': return 'The practice shop is being prepared with new made-up data. This takes a minute or two.';
    case 'failed': return `The practice shop is not running. ${s.message ?? ''}`.trim();
    case 'ready': return s.days ? `The practice shop is ready, with ${s.days} days of made-up shop work.` : 'The practice shop is ready.';
  }
}
