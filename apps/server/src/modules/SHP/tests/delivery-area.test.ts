/** Which delivery area an address falls in (made-up fees). */
import { describe, expect, it } from 'vitest';
import { areaFor } from '../orders.ts';

const options = [
  { name: 'Metro Manila', feeCents: 0, places: ['Quezon City', 'Parañaque'], otherwise: false },
  { name: 'Cavite', feeCents: 10_000, places: ['Cavite'], otherwise: false },
  { name: 'Elsewhere', feeCents: 30_000, places: [], otherwise: true },
];
const area = (city: string, province: string) => areaFor(options, city, province)?.name;

describe('delivery areas', () => {
  it('matches a listed city however it is typed', () => {
    expect(area('Quezon City', 'Metro Manila')).toBe('Metro Manila');
    expect(area('City of Quezon', 'Metro Manila')).toBe('Metro Manila');
    expect(area('Paranaque City', 'Metro Manila')).toBe('Metro Manila');
  });

  it('does not take a province for the listed city of the same name', () => {
    expect(area('Lucena', 'Quezon')).toBe('Elsewhere');
  });

  it('matches a listed province for any town in it', () => {
    expect(area('Silang', 'Cavite')).toBe('Cavite');
  });
});
