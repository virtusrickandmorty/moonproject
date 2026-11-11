/** The Floor app's Jobs screen: a tab for each of the worker's own steps (the owner's request, Nov 2026). */
import { describe, expect, it } from 'vitest';
import type { FloorOpen } from '../../../api.ts';
import { stepTabs } from './FloorApp.tsx';

const job = (n: number, stepId: number, stepName: string): FloorOpen['jobs'][number] => ({
  jobOrderId: `jo-${n}`, jobOrderNumber: `JO-00000${n}`, customerName: 'Sample Team', dueDate: '2026-11-20', rush: false,
  lineNo: 1, description: 'Sample jersey', qty: 10, stepId, stepName, done: 0, left: 10, ready: 10, waiting: 0,
});
const steps = [{ id: 1, name: 'Cutting' }, { id: 4, name: 'Sewing' }, { id: 6, name: 'Pressing' }];
const jobs = [job(1, 4, 'Sewing'), job(2, 1, 'Cutting'), job(3, 4, 'Sewing')];

describe('the Jobs screen tabs', () => {
  it('one tab per own step, with how many jobs wait on it; a tab shows only its step', () => {
    const t = stepTabs(steps, jobs, 4);
    expect(t.tabs.map((x) => [x.name, x.count])).toEqual([['Cutting', 1], ['Sewing', 2], ['Pressing', 0]]);
    expect(t.on?.name).toBe('Sewing');
    expect(t.jobs.map((j) => j.jobOrderNumber)).toEqual(['JO-000001', 'JO-000003']);
  });

  it('opens on the first step with work, when none is asked or the asked one is not theirs', () => {
    expect(stepTabs(steps, [job(5, 6, 'Pressing')]).on?.name).toBe('Pressing');
    expect(stepTabs(steps, jobs, 99).on?.name).toBe('Cutting');
    expect(stepTabs(steps, []).on?.name).toBe('Cutting');
  });

  it('a worker with one step gets their whole list, no tabs', () => {
    const t = stepTabs([{ id: 4, name: 'Sewing' }], [job(1, 4, 'Sewing')]);
    expect(t.tabs).toHaveLength(1);
    expect(t.jobs).toHaveLength(1);
  });
});
