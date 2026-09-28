/** The module forms' record step: a replacement's preview drops the errors that only name the document it replaces. */
import { describe, expect, it } from 'vitest';
import type { Issue } from '@moonproject/shared';
import { withoutOriginal } from './record.tsx';

describe('record a replacement', () => {
  it('keeps warnings and other errors; drops errors about the original, which the reissue cancels first', () => {
    const issues: Issue[] = [
      { field: 'instalmentNo', code: 'PAID', level: 'error', message: 'Instalment 1 of LOAN-000001 is already paid by LPAY-000001.' },
      { field: 'quarter', code: 'LATER_CLOSED', level: 'error', message: 'Q3 2026 is already closed (VATC-000002). Quarters close in order: cancel it first.' },
      { field: 'rows', code: 'DUE_ALREADY', level: 'warning', message: 'LPAY-000001 note' },
    ];
    expect(withoutOriginal(issues, 'LPAY-000001').map((i) => i.code)).toEqual(['LATER_CLOSED', 'DUE_ALREADY']);
    expect(withoutOriginal(issues, 'VATC-000001')).toEqual(issues);
  });
});
