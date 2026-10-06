/** Practice mode's words and address (PLAN C8), kept apart from the screens so they can be tested. */
import type { PracticeStatus } from '../../api.ts';

/** The practice shop is this same PC on its own port, over the same kind of address the page was opened with. */
/** The practice shop's public address (it answers as the practice shop, practice: true on /api/health). */
export const PRACTICE_URL = 'https://practice.virtusgarments.com/';
/** Whether the ERP is opened on this PC or the shop network itself (not through the public address). */
export const isLocalAddress = (hostname: string) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(hostname);

/** The practice shop on this PC or the shop network: the same host, the practice port. */
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
