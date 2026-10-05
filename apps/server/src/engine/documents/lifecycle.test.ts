/**
 * A date asked for on a document that may be backdated must be a real calendar day (A1-004): 2026-02-30 is refused
 * before a number is used.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import fc from 'fast-check';
import { AppError } from '@moonproject/shared';
import { createTestEnv, type TestEnv } from '../../../test/helpers.ts';
import { BACKDATE_PERMISSION, postDocument, previewDocument } from './lifecycle.ts';
import type { DocTypeDef } from './registry.ts';

type Input = { note: string };
const noteDoc: DocTypeDef<Input, Input & { totalCents: number }> = {
  key: 'test.note', module: 'TEST', title: 'Cash Count', // any registered title: this test type is never registered
  numbering: { series: { key: 'TNOTE', prefix: 'TN-' } },
  permissions: { view: 'test.view', create: 'test.create', post: 'test.post', cancel: 'test.cancel' },
  dating: 'accountant_may_backdate',
  inputSchema: z.object({ note: z.string() }).strict(),
  compute: (input) => ({ ...input, totalCents: 0 }),
  validate: () => [],
  persist: () => undefined,
  load: () => ({ note: '', totalCents: 0 }),
  toInput: ({ note }) => ({ note }),
  summary: (doc) => doc.note,
  arbitrary: () => fc.constant({ note: 'x' }),
};

let env: TestEnv;
let userId: string;
beforeEach(async () => {
  env = await createTestEnv(); // 2026-09-28
  userId = (await env.as('accountant')).userId;
});

const actor = () => ({ userId, permissions: new Set(['test.create', 'test.post', BACKDATE_PERMISSION]) });
const codeOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as AppError).code;
  }
  return 'OK';
};

describe('backdating asks for a real date (A1-004)', () => {
  it('refuses 2026-02-30 and other days that do not exist, before a number is used', () => {
    const e = { db: env.db, clock: env.clock };
    for (const day of ['2026-02-30', '2026-04-31', '2025-02-29', '2026-13-01', '2026-00-10']) {
      expect(codeOf(() => previewDocument(e, noteDoc, actor(), { note: 'a' }, day))).toBe('BAD_DATE');
      expect(codeOf(() => postDocument(e, noteDoc, actor(), { input: { note: 'a' }, expectedTotalCents: 0, businessDate: day }))).toBe('BAD_DATE');
    }
    expect(env.db.prepare(`SELECT COUNT(*) FROM documents WHERE doc_type = 'test.note'`).pluck().get()).toBe(0);
    expect(env.db.prepare(`SELECT next_value FROM number_series WHERE series_key = 'TNOTE'`).pluck().get()).toBeUndefined();
    const ok = postDocument(e, noteDoc, actor(), { input: { note: 'a' }, expectedTotalCents: 0, businessDate: '2024-02-29' });
    expect([ok.number, ok.businessDate]).toEqual(['TN-000001', '2024-02-29']);
  });
});
