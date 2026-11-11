/** The Floor app's Jobs screen tabs and bell lines (the owner's requests, Nov 2026). */
import { describe, expect, it } from 'vitest';
import type { FloorNote, FloorOpen } from '../../../api.ts';
import { noteDetail, stepTabs } from './FloorApp.tsx';

const job = (n: number, stepId: number, stepName: string): FloorOpen['jobs'][number] => ({
  jobOrderId: `jo-${n}`, jobOrderNumber: `JO-00000${n}`, customerName: 'Sample Team', dueDate: '2026-11-20', rush: false,
  lineNo: 1, description: 'Sample jersey', qty: 10, stepId, stepName, done: 0, left: 10, ready: 10, waiting: 0,
});
const steps = [{ id: 1, name: 'Cutting' }, { id: 4, name: 'Sewing' }, { id: 6, name: 'Pressing' }];
const jobs = [job(1, 4, 'Sewing'), job(2, 1, 'Cutting'), job(3, 4, 'Sewing')];

describe('the Jobs screen tabs', () => {
  it('a tab only for each own step with work on it, with how many jobs wait; a tab shows only its step', () => {
    const t = stepTabs(steps, jobs, 4);
    expect(t.tabs.map((x) => [x.name, x.count])).toEqual([['Cutting', 1], ['Sewing', 2]]); // Pressing has none: no tab
    expect(t.on?.name).toBe('Sewing');
    expect(t.jobs.map((j) => j.jobOrderNumber)).toEqual(['JO-000001', 'JO-000003']);
  });

  it('opens on the first step with work when none is asked, or the asked one has none', () => {
    expect(stepTabs(steps, jobs).on?.name).toBe('Cutting');
    expect(stepTabs(steps, jobs, 6).on?.name).toBe('Cutting');
    expect(stepTabs(steps, []).tabs).toEqual([]);
  });

  it('one step with work: its whole list, no tabs', () => {
    const t = stepTabs(steps, [job(5, 6, 'Pressing')]);
    expect(t.tabs.map((x) => x.name)).toEqual(['Pressing']);
    expect(t.jobs).toHaveLength(1);
  });
});

describe('the bell', () => {
  const note = (kind: FloorNote['kind'], left: number, ready: number, rush = false): FloorNote => ({
    id: `${kind}:x`, kind, read: false, jobOrderNumber: 'JO-000231', customerName: 'Sample Team', dueDate: '2026-11-13', rush,
    lineNo: 1, description: 'Sample jersey', stepId: 4, stepName: 'Sewing', left, ready,
  });
  it('says the pieces, the day and whether they are ready', () => {
    expect(noteDetail(note('new', 50, 0))).toBe('50 pcs to do · due Nov 13 · not ready yet');
    expect(noteDetail(note('today', 10, 4, true))).toBe('10 pcs left · 4 ready for you · rush');
    expect(noteDetail(note('tomorrow', 1, 1))).toBe('1 pc left · ready for you');
    expect(noteDetail(note('late', 6, 6))).toBe('6 pcs left · was due Nov 13');
  });
});
