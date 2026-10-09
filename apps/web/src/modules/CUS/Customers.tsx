import { useCallback, useEffect, useState } from 'react';
import { openServerPrint, refusedFields, type Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass, peso, searchClass, searchRowClass } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { masterRequest } from './http.ts';
import { withholdingLabels, type WithholdingProfile } from './withholding.ts';

type Customer = { id: string; code: string; kind: 'person' | 'organization'; display_name: string; registered_name: string | null;
  tin: string | null; is_vat_registered: number; billing_address: string | null; email: string | null; notes: string | null;
  withholding_profile: WithholdingProfile; is_active: number; version: number; created_at?: string; updated_at?: string };
type Group = { id: string; name: string; is_active: number; version: number };
type Person = { id: string; full_name: string; group_id: string | null; is_active: number; version: number };
type Phone = { id: string; phone: string; label: string | null; version: number };
type Detail = Customer & { groups: Group[]; people: Person[]; phones: Phone[] };
type DuplicateWarning = { id: string; reason: string };
type Size = { id: string; label: string; category: 'adult' | 'kids'; is_active: number };
type Chart = { id: string; revision_no: number; status: string; size_mode: 'preset' | 'measured'; upper_size: string | null;
  lower_size: string | null; unit: 'inch' | 'cm'; values: Record<string, number | null>; remarks: string | null; measured_on: string; reason: string | null };
const measures = ['shoulder', 'chest', 'upperWaist', 'collar', 'bustPoint', 'figurePoint', 'bustDistance', 'armHole', 'sleeveHole',
  'sleeveLength', 'upperLength', 'lowerWaist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lowerLength'] as const;
/** The server's rule (normalizePhone): a Philippine number, 9 or 10 digits after 0 or +63. Checked here first so a bad number never leaves a customer half-saved. */
const phoneOk = (raw: string) => {
  const d = raw.replace(/[^0-9]/g, '');
  const national = d.startsWith('63') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : d;
  return national.length >= 9 && national.length <= 10;
};
const PHONE_RULE = 'Enter a Philippine phone number with 9 or 10 digits, like 0917 123 4567.';
/** Grouped for reading: mobile "+63 917 123 4567", Metro Manila "+63 2 8123 4567", provincial "+63 32 234 5678". */
function showPhone(p: string): string {
  const n = p.replace(/^\+63/, '');
  if (/^9\d{9}$/.test(n)) return `+63 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (/^2\d{8}$/.test(n)) return `+63 2 ${n.slice(1, 5)} ${n.slice(5)}`;
  if (/^\d{9}$/.test(n)) return `+63 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  return p;
}
const label = (name: string) => name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`).replace(/^./, (c) => c.toUpperCase());

export function Customers({ me }: { me: Me }) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [error, setError] = useState('');
  const [saveWarnings, setSaveWarnings] = useState<DuplicateWarning[]>([]);
  const canManage = me.permissions.includes('cus.manage');
  const load = useCallback(async () => {
    try {
      setRows(await masterRequest<Customer[]>(me, `/api/cus/customers?${new URLSearchParams({ search, offset: String(offset), limit: '25' })}`));
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, [me, search, offset]);
  const open = async (id: string) => {
    try { setSelected(await masterRequest<Detail>(me, `/api/cus/customers/${id}`)); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('customer');
    if (id) void open(id);
  // A linked customer is opened once when this screen mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refreshed = async () => { await load(); if (selected) await open(selected.id); };
  return <div className="max-w-5xl space-y-4">
    <div className="flex items-center gap-3"><h1 className="flex-1 text-2xl font-semibold">Customers</h1>
      {canManage && <Button tone="primary" onClick={() => { setSaveWarnings([]); setEditing('new'); }}>+ New customer</Button>}</div>
    {error && <Notice>{error}</Notice>}
    <div className={searchRowClass}><input aria-label="Search customers" placeholder="Search name or code" className={`${inputClass} ${searchClass}`} value={search}
      onChange={(e) => { setSearch(e.target.value); setOffset(0); }} /></div>
    <Panel title="Customer list"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
      <th className="py-2 pl-2">Code</th><th>Name</th><th>Kind</th><th>Status</th></tr></thead><tbody>{rows.map((r) => (
        // The whole row opens the customer, by mouse or by keyboard (Tab to it, then Enter or Space).
        <tr key={r.id} tabIndex={0} aria-selected={selected?.id === r.id} onClick={() => void open(r.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void open(r.id); } }}
          className={`cursor-pointer border-t outline-none transition-colors hover:bg-indigo-50 focus-visible:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 ${selected?.id === r.id ? 'bg-indigo-50 font-semibold text-indigo-800' : ''}`}>
          <td className="py-2 pl-2">{r.code}</td><td>{r.display_name}</td><td>{r.kind}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td></tr>))}</tbody></table>
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No customers found.</p>}</div>
      <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button>
        <Button disabled={rows.length < 25} onClick={() => setOffset(offset + 25)}>Next</Button></div></Panel>
    {/* The customer opens over the list; Edit opens its form over that, and closing the form comes back here. */}
    {selected && <Dialog wide title={`${selected.display_name} · ${selected.code}`} onClose={() => { setSelected(null); setSaveWarnings([]); }}>
      {saveWarnings.length > 0 && <Notice tone="warning">Possible duplicate customer: {saveWarnings.map((w) => `${w.reason} matches customer ${rows.find((r) => r.id === w.id)?.code ?? w.id}`).join('; ')}. Review before creating another record.</Notice>}
      <CustomerDetail me={me} data={selected} canManage={canManage} onRefresh={refreshed}
        onEdit={() => { setSaveWarnings([]); setEditing(selected); }} onClose={() => { setSelected(null); setSaveWarnings([]); }} />
    </Dialog>}
    {editing && <CustomerEditor me={me} row={editing} onClose={() => setEditing(null)} onSaved={async (id, warnings) => {
      setEditing(null); await load(); await open(id);
      setSaveWarnings(warnings);
    }} />}
  </div>;
}

/** The customer form (new or edit), in its own dialog; also opened from the job order form to add a customer there. */
export function CustomerEditor({ me, row, onClose, onSaved }: { me: Me; row: Customer | 'new'; onClose: () => void; onSaved: (id: string, warnings: DuplicateWarning[]) => Promise<void> }) {
  const old = row === 'new' ? null : row;
  const [v, setV] = useState({ kind: old?.kind ?? 'organization', displayName: old?.display_name ?? '',
    registeredName: old?.registered_name ?? '', tin: old?.tin ?? '', isVatRegistered: Boolean(old?.is_vat_registered),
    withholdingProfile: old?.withholding_profile ?? 'none', billingAddress: old?.billing_address ?? '', email: old?.email ?? '', notes: old?.notes ?? '' });
  const [phone, setPhone] = useState({ number: '', label: '' }); // a new customer's first number; more go on the customer itself
  const [error, setError] = useState('');
  const [refused, setRefused] = useState<Record<string, string>>({});
  /** Typing in a box the server refused clears its red mark until the next Save. */
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV({ ...v, [key]: value });
    setRefused(({ [key]: _gone, ...rest }) => rest);
  };
  const save = async () => {
    if (!old && phone.number.trim() && !phoneOk(phone.number)) return setError(PHONE_RULE);
    try {
      const body = { ...v, registeredName: v.registeredName || null, tin: v.tin || null, billingAddress: v.billingAddress || null,
        email: v.email || null, notes: v.notes || null };
      const saved = await masterRequest<Customer & { duplicateWarnings: DuplicateWarning[] }>(me, old ? `/api/cus/customers/${old.id}` : '/api/cus/customers',
        old ? 'PUT' : 'POST', body, old?.version);
      let warnings = saved.duplicateWarnings ?? [];
      if (!old && phone.number.trim()) {
        const added = await masterRequest<{ duplicateWarnings: DuplicateWarning[] }>(me, `/api/cus/customers/${saved.id}/phones`, 'POST',
          { phone: phone.number.trim(), label: phone.label.trim() || null });
        warnings = added.duplicateWarnings ?? warnings;
      }
      await onSaved(saved.id, warnings);
    } catch (e) { setRefused(refusedFields(e)); setError((e as Error).message); }
  };
  return <Dialog title={old ? `Edit ${old.display_name}` : 'New customer'} onClose={onClose}><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Kind" required error={refused.kind}><select className={inputClass} value={v.kind} onChange={(e) => set('kind', e.target.value as typeof v.kind)}>
      <option value="organization">Organization</option><option value="person">Person</option></select></Field>
    <Field label="Display name" required error={refused.displayName}><input className={inputClass} value={v.displayName} onChange={(e) => set('displayName', e.target.value)} /></Field>
    <Field label="Registered name" error={refused.registeredName}><input className={inputClass} value={v.registeredName} onChange={(e) => set('registeredName', e.target.value)} /></Field>
    <Field label="TIN" error={refused.tin}><input className={inputClass} value={v.tin} onChange={(e) => set('tin', e.target.value)} /></Field>
    <Field label="Billing address" error={refused.billingAddress}><input className={inputClass} value={v.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} /></Field>
    <Field label="Email" error={refused.email}><input type="email" className={inputClass} value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
    {!old && <>
      <Field label="Contact no." hint="Mobile or landline, like 0917 123 4567"><input type="tel" inputMode="tel" autoComplete="tel" className={inputClass} value={phone.number} onChange={(e) => setPhone({ ...phone, number: e.target.value })} /></Field>
      <Field label="Contact no. label" hint="Optional, like Mobile, Office or Coach"><input className={inputClass} value={phone.label} onChange={(e) => setPhone({ ...phone, label: e.target.value })} /></Field>
    </>}
    <Field label="Notes" error={refused.notes}><input className={inputClass} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    <Field label="Withholding profile" error={refused.withholdingProfile}><select className={inputClass} value={v.withholdingProfile} onChange={(e) => set('withholdingProfile', e.target.value as WithholdingProfile)}>
      {Object.entries(withholdingLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
    <Field label="VAT registered" error={refused.isVatRegistered}><input type="checkbox" checked={v.isVatRegistered} onChange={(e) => set('isVatRegistered', e.target.checked)} /></Field>
  </div>{error && <Notice>{error}</Notice>}<div className="flex gap-2"><Button tone="primary" disabled={!v.displayName.trim()} onClick={() => void save()}>Save</Button>
    <Button onClick={onClose}>Cancel</Button></div></Dialog>;
}

function CustomerDetail({ me, data, canManage, onRefresh, onEdit, onClose }: {
  me: Me; data: Detail; canManage: boolean; onRefresh: () => Promise<void>; onEdit: () => void; onClose: () => void;
}) {
  const [newGroup, setNewGroup] = useState('');
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [groupName, setGroupName] = useState('');
  const [newPerson, setNewPerson] = useState('');
  const [groupId, setGroupId] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const [personName, setPersonName] = useState('');
  const [personGroup, setPersonGroup] = useState('');
  const [newPhone, setNewPhone] = useState({ number: '', label: '' });
  const [error, setError] = useState('');
  const action = async (path: string, body: unknown) => {
    try { await masterRequest(me, path, 'POST', body); setError(''); await onRefresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };
  const update = async (path: string, body: unknown, version: number) => {
    try { await masterRequest(me, path, 'PUT', body, version); setError(''); await onRefresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };
  const addPhone = async () => {
    if (!phoneOk(newPhone.number)) return setError(PHONE_RULE);
    if (await action(`/api/cus/customers/${data.id}/phones`, { phone: newPhone.number.trim(), label: newPhone.label.trim() || null })) setNewPhone({ number: '', label: '' });
  };
  const removePhone = async (p: Phone) => {
    try { await masterRequest(me, `/api/cus/phones/${p.id}/deactivate`, 'POST', {}, p.version); setError(''); await onRefresh(); }
    catch (e) { setError((e as Error).message); }
  };
  // Everything typed on the customer form, a dash where it was left blank; the contact numbers have their own panel below.
  const shown: [string, string | null, boolean?][] = [
    ['Code', data.code], ['Display name', data.display_name], ['Kind', data.kind === 'organization' ? 'Organization' : 'Person'],
    ['Status', data.is_active ? 'Active' : 'Inactive'], ['Registered name', data.registered_name], ['TIN', data.tin],
    ['VAT registered', data.is_vat_registered ? 'Yes' : 'No'], ['Withholding profile', withholdingLabels[data.withholding_profile]], ['Email', data.email],
    ['Billing address', data.billing_address, true], ['Notes', data.notes, true],
    ['Added', data.created_at?.slice(0, 16).replace('T', ' ') ?? null], ['Last changed', data.updated_at?.slice(0, 16).replace('T', ' ') ?? null],
  ];
  return <div className="space-y-4"><Panel title="Details">
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {shown.map(([name, value, wide]) => <div key={name} className={wide ? 'sm:col-span-2' : ''}>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{name}</dt>
        <dd className={`mt-0.5 whitespace-pre-wrap break-words ${value ? 'text-slate-900' : 'text-slate-400'}`}>
          {name === 'Email' && value ? <a href={`mailto:${value}`} className="text-indigo-700 hover:underline">{value}</a> : value || '—'}
        </dd>
      </div>)}
    </dl>
    <div className="flex gap-2">{canManage && data.is_active === 1 && <Button onClick={onEdit}>Edit customer</Button>}<Button onClick={onClose}>Close</Button></div>
  </Panel>
    {me.permissions.includes('jo.view') && <CustomerOrders me={me} customerId={data.id} />}
    {error && <Notice>{error}</Notice>}
    <Panel title="Contact numbers">
      {data.phones.length === 0 ? <p className="text-sm text-muted">No contact number yet.</p> : <ul className="divide-y divide-slate-100">{data.phones.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <a href={`tel:${p.phone}`} className="font-semibold text-indigo-700 underline">{showPhone(p.phone)}</a>
          {p.label && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.label}</span>}
          {canManage && data.is_active === 1 && <button type="button" className="ml-auto text-xs text-red-700 underline" onClick={() => void removePhone(p)}>Remove</button>}
        </li>))}</ul>}
      {canManage && data.is_active === 1 && <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input aria-label="New contact no." type="tel" inputMode="tel" placeholder="Contact no., like 0917 123 4567" className={inputClass} value={newPhone.number} onChange={(e) => setNewPhone({ ...newPhone, number: e.target.value })} />
        <input aria-label="New contact no. label" placeholder="Label (optional), like Mobile" className={inputClass} value={newPhone.label} onChange={(e) => setNewPhone({ ...newPhone, label: e.target.value })} />
        <Button disabled={!newPhone.number.trim()} onClick={() => void addPhone()}>Add number</Button></div>}
    </Panel>
    <Panel title="Groups"><div className="flex flex-wrap gap-2">{data.groups.map((g) => <span key={g.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
      {g.name}{!g.is_active && ' (inactive)'} {canManage && g.is_active === 1 && <button className="text-indigo-700 underline" onClick={() => {
        setEditGroup(g); setGroupName(g.name);
      }}>Edit</button>}</span>)}</div>
      {editGroup && <div className="flex max-w-md gap-2"><input aria-label="Group name" className={inputClass} value={groupName}
        onChange={(e) => setGroupName(e.target.value)} /><Button disabled={!groupName.trim()} onClick={() => void update(`/api/cus/groups/${editGroup.id}`,
          { name: groupName.trim() }, editGroup.version).then((ok) => { if (ok) setEditGroup(null); })}>Save</Button>
        <Button onClick={() => setEditGroup(null)}>Cancel</Button></div>}
      {canManage && data.is_active === 1 && <div className="flex max-w-md gap-2"><input aria-label="New group" placeholder="Team or department" className={inputClass}
        value={newGroup} onChange={(e) => setNewGroup(e.target.value)} /><Button disabled={!newGroup.trim()} onClick={() => void action(`/api/cus/customers/${data.id}/groups`, { name: newGroup.trim() }).then((ok) => { if (ok) setNewGroup(''); })}>Add</Button></div>}
    </Panel>
    <Panel title="Wearers"><div className="grid gap-2 sm:grid-cols-2">{data.people.map((p) => <button key={p.id} className="rounded-md border p-2 text-left hover:bg-indigo-50"
      onClick={() => { setPerson(p); setPersonName(p.full_name); setPersonGroup(p.group_id ?? ''); }}>{p.full_name}{p.group_id ? ` · ${data.groups.find((g) => g.id === p.group_id)?.name ?? 'Group'}` : ''}{!p.is_active && ' (inactive)'}</button>)}</div>
      {canManage && data.is_active === 1 && <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label="Wearer name" placeholder="Wearer name" className={inputClass}
        value={newPerson} onChange={(e) => setNewPerson(e.target.value)} /><select aria-label="Group" className={inputClass} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        <option value="">No group</option>{data.groups.filter((g) => g.is_active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <Button disabled={!newPerson.trim()} onClick={() => void action(`/api/cus/customers/${data.id}/people`, { fullName: newPerson.trim(), groupId: groupId || null }).then((ok) => { if (ok) setNewPerson(''); })}>Add wearer</Button></div>}
    </Panel>
    {/* A wearer opens in its own window (the owner's request, Oct 2026): their name and group, and their measurements. */}
    {person && <Dialog title={`Wearer · ${person.full_name}`} wide onClose={() => setPerson(null)}>
    {error && <Notice>{error}</Notice>}
    {canManage && person.is_active === 1 && <Panel title="Name and group"><div className="grid gap-2 sm:grid-cols-2">
      <Field label="Name"><input className={inputClass} value={personName} onChange={(e) => setPersonName(e.target.value)} /></Field>
      <Field label="Group"><select className={inputClass} value={personGroup} onChange={(e) => setPersonGroup(e.target.value)}>
        <option value="">No group</option>{data.groups.filter((g) => g.is_active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      </div><Button disabled={!personName.trim()} onClick={() => void update(`/api/cus/people/${person.id}`,
        { fullName: personName.trim(), groupId: personGroup || null }, person.version).then((ok) => { if (ok) setPerson(null); })}>Save wearer</Button></Panel>}
    {me.permissions.includes('cus.measure.view') && <Measurements key={person.id} me={me} person={person} canEdit={me.permissions.includes('cus.measure') && person.is_active === 1} onClose={() => setPerson(null)} />}
    </Dialog>}
  </div>;
}

function Measurements({ me, person, canEdit, onClose }: { me: Me; person: Person; canEdit: boolean; onClose: () => void }) {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [warnings, setWarnings] = useState<{ field: string; message: string }[]>([]);
  const [mode, setMode] = useState<'preset' | 'measured'>('preset');
  const [unit, setUnit] = useState<'inch' | 'cm'>('inch');
  const [upper, setUpper] = useState('');
  const [lower, setLower] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => masterRequest<Chart[]>(me, `/api/cus/people/${person.id}/measurements`).then(setCharts, (e: Error) => setError(e.message)), [me, person.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void masterRequest<Size[]>(me, '/api/cus/sizes').then(setSizes, (e: Error) => setError(e.message)); }, [me]);
  const sizeLabel = (id: string) => sizes.find((s) => s.id === id)?.label ?? id;
  const save = async () => {
    try {
      const saved = await masterRequest<Chart & { warnings: { field: string; message: string }[] }>(me, `/api/cus/people/${person.id}/measurements`, 'POST', { sizeMode: mode, upperSize: upper || null,
        lowerSize: lower || null, unit, values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        ...(charts.length ? { reason: reason.trim() } : {}) });
      setWarnings(saved.warnings ?? []); setError(''); setValues({}); setReason(''); await load();
    } catch (e) { setError((e as Error).message); }
  };
  return <Panel title={`Measurements · ${person.full_name}`}><Button onClick={onClose}>Close</Button>
    {charts.some((c) => c.status === 'active') && <Button onClick={() => void openServerPrint(me, '/api/prt/reports/sizing-profile', { personId: person.id })}>Print sizing profile</Button>}
    {charts.map((c) => <div key={c.id} className="border-b py-2 text-sm"><b>Revision {c.revision_no}</b> · {c.status} · {c.measured_on} · {c.size_mode}
      {c.upper_size && ` · upper ${sizeLabel(c.upper_size)}`}{c.lower_size && ` · lower ${sizeLabel(c.lower_size)}`}
      <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-4">{Object.entries(c.values).filter(([, v]) => v != null).map(([k, v]) => <span key={k}>{label(k)}: {v} {c.unit}</span>)}</div>
      {c.reason && <p>Reason: {c.reason}</p>}</div>)}
    {canEdit && <div className="space-y-3"><h3 className="font-medium">New revision</h3><div className="grid gap-2 sm:grid-cols-3">
      <Field label="Entry type"><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="preset">Size preset</option><option value="measured">Measurements</option></select></Field>
      <Field label="Upper size"><select className={inputClass} value={upper} onChange={(e) => setUpper(e.target.value)}><option value="">None</option>{sizes.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label} ({s.category})</option>)}</select></Field>
      <Field label="Lower size"><select className={inputClass} value={lower} onChange={(e) => setLower(e.target.value)}><option value="">None</option>{sizes.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label} ({s.category})</option>)}</select></Field></div>
      {mode === 'measured' && <><Field label="Unit"><select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}><option value="inch">Inches</option><option value="cm">Centimetres</option></select></Field>
        <div className="grid gap-3 sm:grid-cols-3">{measures.map((m) => <Field key={m} label={label(m)} hint={charts[0]?.values[m] != null ? `Previous: ${charts[0].values[m]} ${charts[0].unit}` : undefined}>
          <input type="number" min="0" step="any" inputMode="decimal" className={`${inputClass} text-lg`} value={values[m] ?? ''} onChange={(e) => setValues({ ...values, [m]: e.target.value })} /></Field>)}</div></>}
      {charts.length > 0 && <Field label="Reason for new revision" required><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {warnings.length > 0 && <Notice tone="warning">Saved with measurement warnings: {warnings.map((w) => w.message).join(' ')}</Notice>}
      {error && <Notice>{error}</Notice>}<Button tone="primary" disabled={charts.length > 0 && reason.trim().length < 3} onClick={() => void save()}>Save revision</Button>
    </div>}
  </Panel>;
}

type Order = { kind: 'job_order' | 'quick_sale'; docType: string; id: string; number: string; date: string; dueDate: string | null; totalCents: number; stage: string | null; balanceDueCents: number };
/** Everything the customer has ordered, newest first: job orders with their stage, and quick sales. A row opens the document. */
function CustomerOrders({ me, customerId }: { me: Me; customerId: string }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setOrders(null);
    masterRequest<Order[]>(me, `/api/jo/customers/${encodeURIComponent(customerId)}/orders`).then((o) => { setOrders(o); setError(''); }, (e: Error) => setError(e.message));
  }, [me, customerId]);
  const owing = orders?.reduce((n, o) => n + o.balanceDueCents, 0) ?? 0;
  return <Panel title={`Orders${orders ? ` (${orders.length})` : ''}`}>
    {error && <Notice>{error}</Notice>}
    {!orders && !error && <p className="text-sm text-slate-500">Loading…</p>}
    {orders?.length === 0 && <p className="text-sm text-muted">No orders yet.</p>}
    {orders && orders.length > 0 && <>
      {owing > 0 && <p className="text-sm">Still owing on these orders: <b>{peso(owing)}</b></p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
        <th className="py-2 pl-2">Date</th><th>Number</th><th>Type</th><th>Due</th><th>Stage</th><th className="text-right">Total</th><th className="pr-2 text-right">Balance due</th></tr></thead>
        <tbody>{orders.map((o) => <tr key={o.id} className="border-t hover:bg-indigo-50">
          <td className="py-2 pl-2 whitespace-nowrap">{o.date}</td>
          <td><Link to={docPath(o.docType, `/${o.id}`)} className="font-semibold text-indigo-700 hover:underline">{o.number}</Link></td>
          <td>{o.kind === 'job_order' ? 'Job order' : 'Quick sale'}</td><td className="whitespace-nowrap">{o.dueDate ?? '—'}</td><td>{o.stage ?? 'Sold'}</td>
          <td className="text-right tabular-nums">{peso(o.totalCents)}</td>
          <td className={`pr-2 text-right tabular-nums ${o.balanceDueCents > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{o.balanceDueCents > 0 ? peso(o.balanceDueCents) : 'Paid'}</td>
        </tr>)}</tbody></table></div>
    </>}
  </Panel>;
}
