import { describe, expect, it } from 'vitest';
import { isNumberMatch, matchesWords, searchRecords, searchWords } from './search.ts';

describe('word-by-word search', () => {
  it('finds every word in any order, ignoring case', () => {
    expect(matchesWords('St. Mary Academy CUS-000012', searchWords('academy MARY'))).toBe(true);
    expect(matchesWords('St. Mary Academy CUS-000012', searchWords('mary college'))).toBe(false);
    expect(matchesWords('anything', searchWords('   '))).toBe(true);
  });

  it('finds a phone typed with its leading 0 or spaces, and a TIN typed with dashes', () => {
    const text = 'Sample Shop +639170001234 123456789000';
    expect(matchesWords(text, searchWords('09170001234'))).toBe(true);
    expect(matchesWords(text, searchWords('0917 000 1234'))).toBe(true);
    expect(matchesWords(text, searchWords('+63 917 000 1234'))).toBe(true);
    expect(matchesWords(text, searchWords('123-456-789-000'))).toBe(true);
    expect(matchesWords(text, searchWords('0918'))).toBe(false);
  });

  it('puts the record numbered as typed first', () => {
    expect(isNumberMatch('JO-000012', '12')).toBe(true);
    expect(isNumberMatch('JO-000012', 'jo-000012')).toBe(true);
    expect(isNumberMatch('JO-000120', '12')).toBe(false);
    const rows = [{ n: 'JO-000120', c: 'Team 12' }, { n: 'JO-000012', c: 'Club' }, { n: 'JO-000003', c: 'Other' }];
    expect(searchRecords(rows, '12', (r) => `${r.n} ${r.c}`, (r) => [r.n]).map((r) => r.n)).toEqual(['JO-000012', 'JO-000120']);
  });
});
