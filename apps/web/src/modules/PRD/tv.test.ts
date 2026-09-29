import { describe, expect, it } from 'vitest';
import { initials } from './TvBoard.tsx';

describe('TV customer privacy', () => {
  it('shows only initials for an individual name', () => expect(initials('Ada Maria Santos')).toBe('AMS'));
});
