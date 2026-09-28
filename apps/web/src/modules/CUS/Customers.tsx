import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { masterRequest } from './http.ts';

type Customer = { id: string; code: string; kind: 'person' | 'organization'; display_name: string; registered_name: string | null;
  tin: string | null; is_vat_registered: number; billing_address: string | null; email: string | null; notes: string | null;
  is_active: number; version: number };
type Group = { id: string; name: string; is_active: number; version: number };
type Person = { id: string; full_name: string; group_id: string | null; is_active: number; version: number };
type Detail = Customer & { groups: Group[]; people: Person[] };
type DuplicateWarning = { id: string; reason: string };
type Size = { id: string; label: string; category: 'adult' | 'kids'; is_active: number };
type Chart = { id: string; revision_no: number; status: string; size_mode: 'preset' | 'measured'; upper_size: string | null;
  lower_size: string | null; unit: 'inch' | 'cm'; values: Record<string, number | null>; remarks: string | null; measured_on: string; reason: string | null };
const measures = ['shoulder', 'chest', 'upperWaist', 'collar', 'bustPoint', 'figurePoint', 'bustDistance', 'armHole', 'sleeveHole',
  'sleeveLength', 'upperLength', 'lowerWaist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lowerLength'] as const;
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
    {saveWarnings.length > 0 && <Notice tone="warning">Possible duplicate customer: {saveWarnings.map((w) => `${w.reason} matches customer ${rows.find((r) => r.id === w.id)?.code ?? w.id}`).join('; ')}. Review before creating another record.</Notice>}
    <input aria-label="Search customers" placeholder="Search name or code" className={`${inputClass} max-w-md`} value={search}
      onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
    <Panel title="Customer list"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500">
      <th>Code</th><th>Name</th><th>Kind</th><th>Status</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id} className="border-t">
        <td className="py-2">{r.code}</td><td><button className="text-indigo-700 underline" onClick={() => void open(r.id)}>{r.display_name}</button></td>
        <td>{r.kind}</td><td>{r.is_active ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table>
      {rows.length === 0 && <p className="py-3 text-sm text-slate-500">No customers found.</p>}</div>
      <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</Button>
        <Button disabled={rows.length < 25} onClick={() => setOffset(offset + 25)}>Next</Button></div></Panel>
    {selected && <CustomerDetail me={me} data={selected} canManage={canManage} onRefresh={refreshed}
      onEdit={() => { setSaveWarnings([]); setEditing(selected); }} onClose={() => setSelected(null)} />}
    {editing && <CustomerEditor me={me} row={editing} onClose={() => setEditing(null)} onSaved={async (id, warnings) => {
      setEditing(null); await load(); await open(id);
      setSaveWarnings(warnings);
    }} />}
  </div>;
}

function CustomerEditor({ me, row, onClose, onSaved }: { me: Me; row: Customer | 'new'; onClose: () => void; onSaved: (id: string, warnings: DuplicateWarning[]) => Promise<void> }) {
  const old = row === 'new' ? null : row;
  const [v, setV] = useState({ kind: old?.kind ?? 'organization', displayName: old?.display_name ?? '',
    registeredName: old?.registered_name ?? '', tin: old?.tin ?? '', isVatRegistered: Boolean(old?.is_vat_registered),
    billingAddress: old?.billing_address ?? '', email: old?.email ?? '', notes: old?.notes ?? '' });
  const [error, setError] = useState('');
  const save = async () => {
    try {
      const body = { ...v, registeredName: v.registeredName || null, tin: v.tin || null, billingAddress: v.billingAddress || null,
        email: v.email || null, notes: v.notes || null };
      const saved = await masterRequest<Customer & { duplicateWarnings: DuplicateWarning[] }>(me, old ? `/api/cus/customers/${old.id}` : '/api/cus/customers',
        old ? 'PUT' : 'POST', body, old?.version);
      await onSaved(saved.id, saved.duplicateWarnings ?? []);
    } catch (e) { setError((e as Error).message); }
  };
  return <Panel title={old ? `Edit ${old.display_name}` : 'New customer'}><div className="grid gap-3 sm:grid-cols-2">
    <Field label="Kind" required><select className={inputClass} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}>
      <option value="organization">Organization</option><option value="person">Person</option></select></Field>
    <Field label="Display name" required><input className={inputClass} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></Field>
    <Field label="Registered name"><input className={inputClass} value={v.registeredName} onChange={(e) => setV({ ...v, registeredName: e.target.value })} /></Field>
    <Field label="TIN"><input className={inputClass} value={v.tin} onChange={(e) => setV({ ...v, tin: e.target.value })} /></Field>
    <Field label="Billing address"><input className={inputClass} value={v.billingAddress} onChange={(e) => setV({ ...v, billingAddress: e.target.value })} /></Field>
    <Field label="Email"><input type="email" className={inputClass} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
    <Field label="Notes"><input className={inputClass} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
    <Field label="VAT registered"><input type="checkbox" checked={v.isVatRegistered} onChange={(e) => setV({ ...v, isVatRegistered: e.target.checked })} /></Field>
  </div>{error && <Notice>{error}</Notice>}<div className="flex gap-2"><Button tone="primary" disabled={!v.displayName.trim()} onClick={() => void save()}>Save</Button>
    <Button onClick={onClose}>Cancel</Button></div></Panel>;
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
  const [error, setError] = useState('');
  const action = async (path: string, body: unknown) => {
    try { await masterRequest(me, path, 'POST', body); setError(''); await onRefresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };
  const update = async (path: string, body: unknown, version: number) => {
    try { await masterRequest(me, path, 'PUT', body, version); setError(''); await onRefresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
  };
  return <div className="space-y-4"><Panel title={`${data.display_name} · ${data.code}`}>
    <p className="text-sm text-slate-600">{data.kind} · {data.is_active ? 'Active' : 'Inactive'}{data.tin ? ` · TIN ${data.tin}` : ''}</p>
    {data.registered_name && <p>Registered name: {data.registered_name}</p>}
    {data.billing_address && <p>Billing address: {data.billing_address}</p>}
    {canManage && data.is_active === 1 && <Button onClick={onEdit}>Edit customer</Button>} <Button onClick={onClose}>Close</Button>
  </Panel>
    {error && <Notice>{error}</Notice>}
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
    {person && canManage && person.is_active === 1 && <Panel title={`Edit wearer · ${person.full_name}`}><div className="grid gap-2 sm:grid-cols-2">
      <Field label="Name"><input className={inputClass} value={personName} onChange={(e) => setPersonName(e.target.value)} /></Field>
      <Field label="Group"><select className={inputClass} value={personGroup} onChange={(e) => setPersonGroup(e.target.value)}>
        <option value="">No group</option>{data.groups.filter((g) => g.is_active).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      </div><Button disabled={!personName.trim()} onClick={() => void update(`/api/cus/people/${person.id}`,
        { fullName: personName.trim(), groupId: personGroup || null }, person.version).then((ok) => { if (ok) setPerson(null); })}>Save wearer</Button></Panel>}
    {person && me.permissions.includes('cus.measure.view') && <Measurements key={person.id} me={me} person={person} canEdit={me.permissions.includes('cus.measure') && person.is_active === 1} onClose={() => setPerson(null)} />}
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
