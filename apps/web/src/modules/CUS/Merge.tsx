/**
 * Merging a duplicate customer (the owner's request, 26 Oct 2026): the owner picks the record to keep, sees what moves to
 * it (contact numbers, wearers and their measurements, groups, contacts, sub-customers) and what stops the merge for now
 * (a job order not yet released, money owed or held), types why, and merges. The duplicate is switched off and points to
 * the record kept; its past documents stay with it. "Possible duplicates" lists the customers that look like the same one.
 */
import { useEffect, useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { masterRequest } from './http.ts';

interface Preview {
  from: { id: string; code: string; name: string }; into: { id: string; code: string; name: string };
  moves: { contacts: number; phones: number; groups: number; people: number; subCustomers: number };
  sameGroups: string[]; blockers: string[];
}
interface Found { id: string; code: string; display_name: string; is_active: number }
interface DuplicateGroup { reason: string; customers: { id: string; code: string; name: string; createdAt: string }[] }

const words = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Merge `fromId` into another customer: `intoId` when the pair is known (Possible duplicates), else picked here. */
export function MergeDialog({ me, fromId, intoId, onClose, onMerged }: { me: Me; fromId: string; intoId?: string; onClose: () => void; onMerged: (keptId: string) => void }) {
  const [from, setFrom] = useState(fromId);
  const [into, setInto] = useState(intoId ?? '');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (into || search.trim().length < 2) return setFound([]);
    const t = setTimeout(() => void masterRequest<Found[]>(me, `/api/cus/customers?${new URLSearchParams({ search: search.trim(), limit: '200' })}`)
      .then((rows) => setFound(rows.filter((r) => r.is_active === 1 && r.id !== from)), () => setFound([])), 250);
    return () => clearTimeout(t);
  }, [search, into, from]);
  useEffect(() => {
    setPreview(null);
    if (!into) return;
    masterRequest<Preview>(me, `/api/cus/customers/${from}/merge-preview?into=${into}`).then(setPreview, (e: Error) => setError(e.message));
  }, [from, into]);

  const blocked = !preview || preview.blockers.length > 0 || preview.sameGroups.length > 0;
  const merge = async () => {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      // Both records as they are now: the server refuses if either changed meanwhile.
      const [a, b] = await Promise.all([masterRequest<{ version: number }>(me, `/api/cus/customers/${from}`), masterRequest<{ version: number }>(me, `/api/cus/customers/${into}`)]);
      await masterRequest(me, `/api/cus/customers/${from}/merge`, 'POST', { intoCustomerId: into, reason: reason.trim() }, a.version, { 'x-target-version': String(b.version) });
      onMerged(into);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog wide title="Merge a duplicate customer" onClose={onClose}>
      <div className="space-y-4">
        {error && <Notice>{error}</Notice>}
        {!into && (
          <Panel title="Which customer to keep?">
            <Field label="Search the customer to keep" hint="Type 2 or more letters of the name or code">
              <input className={inputClass} value={search} autoFocus onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto overscroll-contain text-sm">
              {found.map((c) => <li key={c.id}><button type="button" className="w-full py-2 text-left hover:bg-indigo-50" onClick={() => setInto(c.id)}><b>{c.code}</b> {c.display_name}</button></li>)}
            </ul>
          </Panel>
        )}
        {into && !preview && !error && <p className="text-sm text-slate-500">Checking the two records…</p>}
        {preview && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="rounded-lg bg-red-50 p-3 ring-1 ring-red-100"><p className="text-xs font-semibold uppercase tracking-wide text-red-700">Duplicate: switched off</p><p className="font-semibold">{preview.from.code}</p><p className="text-sm">{preview.from.name}</p></div>
              <div className="text-center"><Button onClick={() => { setFrom(preview.into.id); setInto(preview.from.id); }}>⇄ Keep the other one</Button></div>
              <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-100"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Kept: everything moves here</p><p className="font-semibold">{preview.into.code}</p><p className="text-sm">{preview.into.name}</p></div>
            </div>
            <Panel title="What moves to the record kept">
              <ul className="list-disc pl-5 text-sm">
                <li>{words(preview.moves.phones, 'contact number', 'contact numbers')}</li>
                <li>{words(preview.moves.people, 'wearer', 'wearers')}, with their measurements</li>
                <li>{words(preview.moves.groups, 'group', 'groups')} · {words(preview.moves.contacts, 'contact person', 'contact people')} · {words(preview.moves.subCustomers, 'sub-customer', 'sub-customers')}</li>
              </ul>
              <p className="text-xs text-slate-500">Past quotations, job orders, invoices and payments stay with {preview.from.code}, which shows that it was merged into {preview.into.code}.</p>
              <p className="text-xs font-medium text-amber-800">Check they are really the same customer: a merge cannot be undone from the app. Two customers can share a phone number (a staff member's, say).</p>
            </Panel>
            {preview.blockers.length > 0 && <Notice tone="warning">Not yet: {preview.blockers.join(' ')}</Notice>}
            {preview.sameGroups.length > 0 && <Notice tone="warning">Both have a group called {preview.sameGroups.join(', ')}: rename one first.</Notice>}
            {!blocked && (
              <Field label="Why merge them" required hint="10 characters or more, kept in the audit log">
                <input className={inputClass} value={reason} placeholder="e.g. The same club, typed twice" onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button tone="danger" disabled={blocked || busy || reason.trim().length < 10} onClick={() => void merge()}>{busy ? 'Merging…' : `Merge ${preview.from.code} into ${preview.into.code}`}</Button>
              {!intoId && <Button onClick={() => { setInto(''); setPreview(null); }}>Pick another</Button>}
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The customers that look like the same one (same name, email or phone), each with Merge: the newest into the oldest. */
export function PossibleDuplicates({ me, refreshKey, onMerged }: { me: Me; refreshKey: unknown; onMerged: (keptId: string) => void }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [merging, setMerging] = useState<{ from: string; into: string } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => void masterRequest<DuplicateGroup[]>(me, '/api/cus/duplicates').then(setGroups, () => setGroups([])), [refreshKey]);
  if (!groups || groups.length === 0) return null;
  return (
    <section aria-label="Possible duplicates" className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm font-semibold text-amber-900">{words(groups.length, 'possible duplicate', 'possible duplicates')}: the same name, email or phone on more than one customer.</p>
        <Button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show them'}</Button>
      </div>
      {open && (
        <ul className="mt-3 divide-y divide-amber-200 text-sm">
          {groups.map((g) => {
            const [oldest, ...newer] = g.customers;
            return (
              <li key={g.customers.map((c) => c.id).join()} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{g.reason}</span>
                <span className="flex-1">{g.customers.map((c) => `${c.code} ${c.name}`).join(' · ')}</span>
                {newer.map((n) => <Button key={n.id} onClick={() => setMerging({ from: n.id, into: oldest!.id })}>Merge {n.code} into {oldest!.code}</Button>)}
              </li>
            );
          })}
        </ul>
      )}
      {merging && <MergeDialog me={me} fromId={merging.from} intoId={merging.into} onClose={() => setMerging(null)} onMerged={(kept) => { setMerging(null); onMerged(kept); }} />}
    </section>
  );
}
