import { afterEach, expect, it, vi } from 'vitest';
import { blur, change, form, id, invalid } from '../JO/entry-test.ts';
import { CustomerDetail, CustomerEditor, Measurements } from './Customers.tsx';
import * as http from './http.ts';
import { ApiError, type Me } from '../../api.ts';

const me = { permissions: [] } as unknown as Me;
const data = { id: id(1), display_name: 'Sample School', groups: [{ id: id(2), name: 'Sample team', is_active: 1, version: 2 }], people: [{ id: id(3), full_name: 'Sample Wearer', group_id: null, is_active: 1, version: 3 }], is_active: 1 } as never;
const detail = () => CustomerDetail({ me, data, canManage: true, onRefresh: async () => undefined, onEdit: () => undefined, onClose: () => undefined });
afterEach(() => vi.restoreAllMocks());

it('customer email is quiet before editing, then its message turns its own box red after blur', () => {
  const f = form(() => CustomerEditor({ me, row: 'new', onClose: () => undefined, onSaved: async () => undefined }));
  expect(f.find('label', 'Email').props.error).toBeUndefined();
  change(f.field('Email'), 'bad-address');
  expect(f.find('label', 'Email').props.error).toBeUndefined();
  blur(f.field('Email'));
  invalid(f, 'Email');
  expect(f.find('label', 'TIN').props.error).toBeUndefined();
});
it('customer Save keeps the original fields, nulls, and untrimmed values', async () => {
  const request = vi.spyOn(http, 'masterRequest').mockResolvedValue({ id: id(1), duplicateWarnings: [] });
  const f = form(() => CustomerEditor({ me, row: 'new', onClose: () => undefined, onSaved: async () => undefined }));
  change(f.field('Display name'), ' Sample School '); change(f.field('TIN'), 'not-a-tax-number'); change(f.field('Email'), 'sample@example.com');
  await f.find('children', 'Save').props.onClick();
  expect(request).toHaveBeenCalledWith(me, '/api/cus/customers', 'POST', { kind: 'organization', displayName: ' Sample School ', registeredName: null,
    tin: 'not-a-tax-number', isVatRegistered: false, withholdingProfile: 'none', billingAddress: null, email: 'sample@example.com', notes: null }, undefined);
});
it('customer Save shows the server email refusal only under Email', async () => {
  vi.spyOn(http, 'masterRequest').mockRejectedValue(new ApiError('INVALID_INPUT', 'Invalid input', 400, [{ field: 'email', message: 'Invalid email address' }]));
  const f = form(() => CustomerEditor({ me, row: 'new', onClose: () => undefined, onSaved: async () => undefined }));
  change(f.field('Display name'), 'Sample'); change(f.field('Email'), 'sample@example.com'); f.find('children', 'Save').props.onClick(); await Promise.resolve();
  invalid(f, 'Email'); expect(f.render().some((n) => n.props.children === 'Invalid input')).toBe(false);
});
it.each([['new group', 'New group', 'x'.repeat(201)], ['edit group', 'Group name', 'x'.repeat(201)], ['new wearer', 'Wearer name', 'x'.repeat(201)], ['edit wearer', 'Name', 'x'.repeat(201)]])('%s has its own box error', (which, label, value) => {
  const f = form(detail);
  if (which === 'edit group') f.find('children', 'Edit').props.onClick();
  if (which === 'edit wearer') f.render().find((n) => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0] === 'Sample Wearer')!.props.onClick();
  change(f.field(label), value); blur(f.field(label)); invalid(f, label);
});
it.each([['new group', 'New group', 'Add', `/api/cus/customers/${id(1)}/groups`, 'POST', { name: 'Sample name' }, undefined],
  ['edit group', 'Group name', 'Save', `/api/cus/groups/${id(2)}`, 'PUT', { name: 'Sample name' }, 2],
  ['new wearer', 'Wearer name', 'Add wearer', `/api/cus/customers/${id(1)}/people`, 'POST', { fullName: 'Sample name', groupId: null }, undefined],
  ['edit wearer', 'Name', 'Save wearer', `/api/cus/people/${id(3)}`, 'PUT', { fullName: 'Sample name', groupId: null }, 3]])('%s keeps its original trimmed request', async (which, label, button, path, method, body, version) => {
  const request = vi.spyOn(http, 'masterRequest').mockResolvedValue({});
  const f = form(detail);
  if (which === 'edit group') f.find('children', 'Edit').props.onClick();
  if (which === 'edit wearer') f.render().find((n) => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0] === 'Sample Wearer')!.props.onClick();
  change(f.field(label as string), ' Sample name ');
  await f.find('children', button).props.onClick(); await Promise.resolve();
  expect(request).toHaveBeenCalledWith(me, path, method, body, ...(version === undefined ? [] : [version]));
});
it('measurement precision belongs to its measurement box', () => {
  const f = form(() => Measurements({ me, person: { id: id(3), full_name: 'Sample Wearer' } as never, canEdit: true, onClose: () => undefined }));
  change(f.field('Chest'), '34.251'); blur(f.field('Chest')); invalid(f, 'Chest');
  expect(f.find('label', 'Chest').props.error).toContain('two decimal');
});
it('measurements keep both presets and values in the same request, in either mode', async () => {
  const request = vi.spyOn(http, 'masterRequest').mockResolvedValue({ warnings: [] });
  const f = form(() => Measurements({ me, person: { id: id(3), full_name: 'Sample Wearer' } as never, canEdit: true, onClose: () => undefined }));
  change(f.field('Upper size'), id(4)); change(f.field('Chest'), '34.25');
  await f.find('children', 'Save revision').props.onClick();
  expect(request).toHaveBeenCalledWith(me, `/api/cus/people/${id(3)}/measurements`, 'POST', { sizeMode: 'preset', upperSize: id(4), lowerSize: null, unit: 'inch', values: { chest: 34.25 } });
});
