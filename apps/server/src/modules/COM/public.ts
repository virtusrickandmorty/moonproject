/** What other modules may use from customer emails (AGENTS.md: other modules only through public.ts). */
export { enqueueOnlineOrder, type OnlineOrderEmail, type NotQueued } from './outbox.ts';
export { plain } from './text.ts';
