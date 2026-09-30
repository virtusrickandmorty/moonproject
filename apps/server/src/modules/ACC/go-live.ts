import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest } from '@moonproject/shared';
import type { AppDeps } from '../../app.ts';
import { tx } from '../../platform/db/driver.ts';
import { stamp, today } from '../../platform/clock.ts';
import { appendAudit } from '../../engine/audit.ts';
import { currentUser } from '../../engine/security/routes.ts';
import { settingAt } from '../../engine/settings.ts';
import { GO_LIVE_DECISIONS } from './go-live-decisions.ts';

const answerInput = z.object({
  decisionId: z.string(), answer: z.string().trim().min(1).max(1000), decidedBy: z.string().trim().min(2).max(120),
  decidedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(1000),
}).strict();
type AnswerRow = { id: number; decision_id: string; answer: string; decided_by: string; decided_on: string; note: string; recorded_at: string; recorded_by: string; recorded_by_name: string };
const settingWords = (key: string, value: unknown) => key === 'col.cr_mode' ? ((value as { mode: string }).mode === 'booklet' ? 'Booklet mode' : 'System-numbered') : key === 'tax.top_withholding_agent' ? ((value as boolean) ? 'Yes' : 'No') : key === 'col.forfeit_vatable' ? ((value as boolean) ? 'VATable' : 'Not VATable') : String(value);
const agrees = (id: string, answer: string, value: unknown) => {
  const a = answer.trim().toLowerCase();
  if (id === 'ACC-02') return a === String(value).toLowerCase() || a.startsWith(`${String(value).toLowerCase()} `);
  if (id === 'ACC-03') return a.includes((value as { mode: string }).mode === 'booklet' ? 'booklet' : 'system');
  if (id === 'ACC-06') return (value as boolean) ? /(^|\W)(yes|twa|published)(\W|$)/i.test(answer) && !/not\s+(a\s+)?twa/i.test(answer) : /not\s+(a\s+)?twa|not published/i.test(answer);
  if (id === 'ACC-15') return (value as boolean) ? /vatable/i.test(answer) && !/not\s+vatable/i.test(answer) : /not\s+vatable/i.test(answer);
  return true;
};
const output = (db: AppDeps['db'], day: string) => {
  const rows = db.prepare(`SELECT a.*, u.display_name recorded_by_name FROM acc_go_live_answers a JOIN users u ON u.id=a.recorded_by ORDER BY a.id DESC`).all() as AnswerRow[];
  return GO_LIVE_DECISIONS.map((d) => {
    const history = rows.filter((r) => r.decision_id === d.id).map((r) => ({ id: r.id, answer: r.answer, decidedBy: r.decided_by, decidedOn: r.decided_on, note: r.note, recordedAt: r.recorded_at, recordedByName: r.recorded_by_name }));
    const current = d.settingKey ? settingAt(db, d.settingKey as Parameters<typeof settingAt>[1], day) : undefined;
    return { ...d, history, setting: d.settingKey ? { key: d.settingKey, value: current, words: settingWords(d.settingKey, current), matches: history[0] ? agrees(d.id, history[0].answer, current) : null } : null };
  });
};
export function goLiveRoutes(app: FastifyInstance, { db, clock }: AppDeps) {
  app.get('/api/acc/go-live-decisions', { config: { permission: 'acc.golive.view' } }, async () => ({ asOf: today(clock), rows: output(db, today(clock)), open: GO_LIVE_DECISIONS.length - new Set((db.prepare('SELECT decision_id FROM acc_go_live_answers').pluck().all() as string[])).size }));
  app.post('/api/acc/go-live-decisions/answers', { config: { permission: 'acc.golive.answer' } }, async (req) => {
    const input = answerInput.parse(req.body);
    if (!GO_LIVE_DECISIONS.some((d) => d.id === input.decisionId)) throw badRequest('UNKNOWN_DECISION', 'Choose a decision from the register.');
    const user = currentUser(req), at = stamp(clock);
    return tx(db, () => {
      const r = db.prepare('INSERT INTO acc_go_live_answers (decision_id,answer,decided_by,decided_on,note,recorded_at,recorded_by) VALUES (?,?,?,?,?,?,?)').run(input.decisionId, input.answer, input.decidedBy, input.decidedOn, input.note, at, user.userId);
      appendAudit(db, { at, userId: user.userId, action: 'acc.golive.answer', entityType: 'acc.go_live_decision', entityId: input.decisionId, data: { answerId: Number(r.lastInsertRowid), answer: input.answer, decidedBy: input.decidedBy, decidedOn: input.decidedOn, note: input.note } });
      return { asOf: today(clock), rows: output(db, today(clock)), open: GO_LIVE_DECISIONS.length - new Set((db.prepare('SELECT decision_id FROM acc_go_live_answers').pluck().all() as string[])).size };
    });
  });
}
