/** A step's row on the production board's line panel: Complete only with every piece done; pieces received and forwarded. */
import { describe, expect, it } from 'vitest';
import type { BoardCard } from '../../api.ts';
import { activeSteps, emptyRow, readyNow, rowsToInput, stepFlow } from './board.ts';

type Steps = NonNullable<BoardCard['steps']>;
const NAMES: Record<number, string> = { 4: 'Cutting', 6: 'Sewing', 8: 'Packing', 1: 'Layout' };
const name = (id: number) => NAMES[id]!;
const step = (stepId: number, status: Steps[number]['status'], pieces: number, receivedPieces: number) => ({ stepId, status, pieces, reworkPieces: 0, receivedPieces });

describe('production step flow', () => {
  it('greys out Complete until every piece of the line is done on the step, and says how many are missing', () => {
    const steps: Steps = [step(4, 'in_progress', 40, 60), step(6, 'in_progress', 25, 40), step(8, 'pending', 0, 25)];
    expect(stepFlow(steps, 0, 60, name)).toMatchObject({ canComplete: false, shortWords: 'Record the other 20 of 60 pcs to complete Cutting.', percent: 67 });
    expect(stepFlow([step(4, 'pending', 0, 60)], 0, 60, name).shortWords).toBe('Record all 60 pcs to complete Cutting.');
    const full: Steps = [step(4, 'in_progress', 60, 60)];
    expect(stepFlow(full, 0, 60, name)).toMatchObject({ canComplete: true, shortWords: '', percent: 100 });
    const closed: Steps = [step(4, 'completed', 60, 60)];
    expect(stepFlow(closed, 0, 60, name)).toMatchObject({ canComplete: false, shortWords: '' });
  });

  it('shows the pieces forwarded to the next needed step and received from the one before, skipping steps not needed', () => {
    const steps: Steps = [step(1, 'not_needed', 0, 60), step(4, 'in_progress', 40, 60), step(6, 'in_progress', 25, 40), step(8, 'pending', 0, 25)];
    expect(stepFlow(steps, 1, 60, name)).toMatchObject({ received: null, forwarded: { pieces: 40, to: 'Sewing' } }); // Layout not needed: Cutting is first
    expect(stepFlow(steps, 2, 60, name)).toMatchObject({ received: { pieces: 40, from: 'Cutting' }, forwarded: { pieces: 25, to: 'Packing' } });
    expect(stepFlow(steps, 3, 60, name)).toMatchObject({ received: { pieces: 25, from: 'Sewing' }, forwarded: null }); // the last step forwards nothing
    expect(stepFlow(steps, 0, 60, name)).toMatchObject({ received: null, forwarded: null });
    expect(stepFlow([step(4, 'pending', 0, 60), step(6, 'pending', 0, 0)], 1, 60, name).received).toBeNull(); // nothing received yet: no line
  });
});

describe('wearers ticked on Record pieces', () => {
  it('go to the server with the row (in order); on rework, the wearers sent back', () => {
    const row = { ...emptyRow('1'), employeeId: 'e1', pieces: '3', wearers: [4, 1] };
    expect(rowsToInput([row]).rows).toEqual([{ lineNo: 1, employeeId: 'e1', pieces: 3, wearers: [1, 4] }]);
    expect(rowsToInput([{ ...row, rework: true, rate: '20.00', rateReason: 'Pasubra on a seam' }]).rows[0]!.wearers).toEqual([1, 4]);
    expect(rowsToInput([{ ...row, wearers: [] }]).rows[0]).not.toHaveProperty('wearers');
  });
});

describe('sets on the board and on Record pieces', () => {
  it('says which part of a set still needs pieces, and sends the part with the row', () => {
    const set = [{ stepId: 6, status: 'in_progress' as const, pieces: 1, reworkPieces: 0, receivedPieces: 2, parts: { upper: 2, lower: 1 } }];
    expect(stepFlow(set, 0, 2, () => 'Sewing')).toMatchObject({ canComplete: false, shortWords: 'Record the rest of the parts to complete Sewing: upper 2 of 2, lower 1 of 2.' });
    expect(rowsToInput([{ ...emptyRow('1'), employeeId: 'e1', pieces: '1', part: 'lower', wearers: [2] }]).rows).toEqual([{ lineNo: 1, employeeId: 'e1', pieces: 1, wearers: [2], part: 'lower' }]);
  });
});

describe('where an item shows on the board', () => {
  it('under its first step not done and every later one with work forwarded to it or done on it', () => {
    const steps: Steps = [step(4, 'in_progress', 6, 10), step(6, 'in_progress', 2, 6), step(8, 'pending', 0, 2), step(9, 'pending', 0, 0)];
    expect(activeSteps({ currentStepId: 4, steps })).toEqual([4, 6, 8]); // cutting, sewing (6 came), packing (2 came); not the step after
    const done: Steps = [step(4, 'completed', 10, 10), step(6, 'in_progress', 3, 10), step(8, 'pending', 0, 3)];
    expect(activeSteps({ currentStepId: 6, steps: done })).toEqual([6, 8]); // a completed step is not shown
    expect(activeSteps({ currentStepId: null, steps: null })).toEqual([]);
  });
});

describe('ready for release on the board', () => {
  it('takes an item with every step done, or with pieces through every step not released yet', () => {
    expect(readyNow({ ready: true, finishedPieces: 10, releasedQty: 0 })).toBe(true);
    expect(readyNow({ ready: false, finishedPieces: 4, releasedQty: 0 })).toBe(true); // 4 of 10 packed: they can go out
    expect(readyNow({ ready: false, finishedPieces: 4, releasedQty: 4 })).toBe(false); // those 4 are already out
    expect(readyNow({ ready: false, finishedPieces: 0, releasedQty: 0 })).toBe(false);
  });
});

describe('rework sent back (the owner\'s request, Oct 2026)', () => {
  it('shows an item under a step with rework sent back to it, even a completed one', () => {
    const steps: Steps = [{ ...step(4, 'completed', 5, 5), reworkOpen: 2 }, step(6, 'completed', 5, 5), step(8, 'completed', 5, 5)];
    expect(activeSteps({ steps, currentStepId: null })).toEqual([4]);
    expect(activeSteps({ steps: steps.map((s) => ({ ...s, reworkOpen: 0 })), currentStepId: null })).toEqual([]);
  });

  it('sends the wearers ticked on a rework row', () => {
    const { rows } = rowsToInput([{ ...emptyRow('1'), employeeId: 'e1', pieces: '2', rework: true, rate: '20', rateReason: 'Pasubra', wearers: [2] }]);
    expect(rows).toEqual([{ lineNo: 1, employeeId: 'e1', pieces: 2, rework: true, rateCents: 2000, rateReason: 'Pasubra', wearers: [2] }]);
  });
});
