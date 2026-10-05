/** A refusal from the server becomes a message under each refused box, in the shop's words. */
import { describe, expect, it } from 'vitest';
import { ApiError, refusedFields } from './api.ts';

const refusal = (details: unknown) => new ApiError('INVALID_INPUT', 'Some fields are missing or not allowed.', 400, details);

describe('refusedFields', () => {
  it('names each refused box with what to do, from the server checks as they are worded today', () => {
    expect(refusedFields(refusal([
      { field: 'kind', message: 'Invalid option: expected one of "person"|"organization"' },
      { field: 'displayName', message: 'Too small: expected string to have >=1 characters' },
      { field: 'isVatRegistered', message: 'Invalid input: expected boolean, received string' },
      { field: 'email', message: 'Invalid email address' },
      { field: 'notes', message: 'Too big: expected string to have <=500 characters' },
    ]))).toEqual({
      kind: 'Pick one of the choices.',
      displayName: 'Fill this in.',
      isVatRegistered: 'This is not allowed here.',
      email: 'Type an email like name@example.com.',
      notes: 'This is too long or too large.',
    });
  });

  it("keeps a check's own plain words, and marks a box once for its first problem", () => {
    expect(refusedFields(refusal([
      { field: 'lines.0.amountCents', message: 'Type the amount like 250.00' },
      { field: 'lines.1.amountCents', message: 'Too small: expected number to be >0' },
      { field: 'tin', message: 'Type the TIN like 123-456-789-000.' },
    ]))).toEqual({ lines: 'Type the amount like 250.00', tin: 'Type the TIN like 123-456-789-000.' });
  });

  it('gives nothing for a refusal that names no box', () => {
    expect(refusedFields(refusal(undefined))).toEqual({});
    expect(refusedFields(refusal([{ field: '', message: 'Not balanced' }, { message: 'x' }, null]))).toEqual({});
    expect(refusedFields(new Error('offline'))).toEqual({});
  });
});
