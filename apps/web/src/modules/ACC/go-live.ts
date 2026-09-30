import type { GoLiveDecision } from '../../api.ts';
export const GO_LIVE_PRINT_TITLE = 'Go-Live Decisions';
export const visibleDecisions = (rows: GoLiveDecision[], group: string) => group === 'all' ? rows : rows.filter((r) => r.group === group);
