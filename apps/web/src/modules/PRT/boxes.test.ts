import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, invalid } from '../JO/entry-test.ts';
import { api } from '../../api.ts';
import { CompanyProfileScreen } from './CompanyProfile.tsx';
afterEach(() => vi.restoreAllMocks());
const profile = { registeredName: ' Sample Corporation ', tradeName: ' Sample shop ', tin: ' Any registration text ', registeredAddress: ' Sample street ', isVatRegistered: true, version: 2 };
it('company profile puts a name over the server length on its box without checking TIN format', () => {
  const f = form(() => CompanyProfileScreen(), [profile, [], '', true]);
  change(f.field('Registered name'), 'x'.repeat(201)); blur(f.field('Registered name')); invalid(f, 'Registered name');
  blur(f.field('TIN')); expect(f.find('label', 'TIN').props.error).toBeUndefined();
});
it('company profile Save keeps step-up, the raw profile values and version, then history refresh', async () => {
  const step = vi.spyOn(api, 'stepUp').mockResolvedValue({} as never);
  const save = vi.spyOn(api, 'saveCompanyProfile').mockResolvedValue(profile);
  const history = vi.spyOn(api, 'companyProfileHistory').mockResolvedValue([]);
  const f = form(() => CompanyProfileScreen(), [profile, [], 'sample-password', true]); f.find('children', 'Save details').props.onClick();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(step).toHaveBeenLastCalledWith('sample-password');
  expect(save).toHaveBeenLastCalledWith({ registeredName: profile.registeredName, tradeName: profile.tradeName, tin: profile.tin, registeredAddress: profile.registeredAddress, isVatRegistered: true }, 2);
  expect(step.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]!); expect(save.mock.invocationCallOrder[0]).toBeLessThan(history.mock.invocationCallOrder[0]!);
});
it('paper refusal is on Paper and does not highlight an untouched company profile', () => {
  const f = form(() => CompanyProfileScreen(), [profile, [], 'sample-password', true]); change(f.field('Paper'), 'letter'); blur(f.field('Paper')); invalid(f, 'Paper');
  expect(f.find('label', 'Registered name').props.error).toBeUndefined();
});
it('paper Save keeps step-up then the chosen paper request even with an incomplete company form', async () => {
  const step = vi.spyOn(api, 'stepUp').mockResolvedValue({} as never);
  const save = vi.spyOn(api, 'saveLooseLeafPaper').mockResolvedValue({ looseLeafPaper: 'long' });
  const f = form(() => CompanyProfileScreen(), [{ ...profile, registeredName: '' }, [], 'sample-password', true]); change(f.field('Paper'), 'long'); f.find('children', 'Save paper').props.onClick();
  await Promise.resolve(); await Promise.resolve();
  expect(step).toHaveBeenLastCalledWith('sample-password'); expect(save).toHaveBeenLastCalledWith('long'); expect(step.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]!);
  expect(f.find('label', 'Registered name').props.error).toBeUndefined();
});
