import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentToasts, dismissToast, showToast, textOf } from './Toasts.tsx';

beforeEach(() => { for (const t of [...currentToasts()]) dismissToast(t.id); });
const words = () => currentToasts().map((t) => t.key);

describe('pop-up messages', () => {
  it('reads the words of a message made of text, numbers and elements', () => {
    expect(textOf(['Recorded as ', createElement('b', null, 'JO-', 12), '.'])).toBe('Recorded as JO-12.');
    expect(textOf(null)).toBe('');
  });

  it('shows a repeated message once and starts its time over', () => {
    showToast('error', 'Wrong password.');
    showToast('error', 'Wrong password.');
    expect(words()).toEqual(['error:Wrong password.']);
    expect(currentToasts()[0]!.round).toBe(1);
    showToast('success', 'Wrong password.');
    expect(words()).toHaveLength(2); // the same words as a success are a different message
  });

  it('keeps at most five, dropping the oldest, and ignores an empty message', () => {
    for (const m of ['a', 'b', 'c', 'd', 'e', 'f']) showToast('error', m);
    showToast('success', '   ');
    expect(words()).toEqual(['error:b', 'error:c', 'error:d', 'error:e', 'error:f']);
  });

  it('goes when dismissed', () => {
    showToast('success', 'Saved.');
    dismissToast(currentToasts()[0]!.id);
    expect(currentToasts()).toEqual([]);
  });
});
