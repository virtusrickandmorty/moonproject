/**
 * Owner money (PLAN E10 OWN-, D5 OWN-IN) and officer transactions (OFC-, D5 OFC-OUT and OFC-IN): the person from the
 * register of stockholders and officers, in or out, the cash place, the amount and a note. Owner money is always in and
 * recorded as an advance until the accountant classifies it; an officer's money goes out (taken, or their advance paid
 * back) or comes in (paid back). Never an expense and never revenue. Also their Edit (NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type CashPlace, type DocTypeInfo, type EqPerson, type Me } from '../../api.ts';
import { Field, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { MoneyForm, PlacePicker, useList, useMoneyForm } from '../AP/parts.tsx';
import { forReplacement } from '../AP/payables.ts';
import { OFFICER_KINDS, classificationsFor, emptyEq, eqValues, officerInput, ownerMoneyInput, personLabel, type EqValues } from './eq.ts';

/** The person a form was opened for, from a person's page (?person=<id>); the pick list still decides if it is valid. */
const askedPerson = () => new URLSearchParams(location.search).get('person') ?? '';

function PersonSelect({ people, v, set }: { people: EqPerson[]; v: EqValues; set: (p: Partial<EqValues>) => void }) {
  return (
    <select aria-label="Person" className={inputClass} value={v.personId} onChange={(e) => set({ personId: e.target.value })}>
      <option value="">Pick from the register</option>
      {people.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
    </select>
  );
}

const Amount = ({ v, set, label = 'Amount' }: { v: EqValues; set: (p: Partial<EqValues>) => void; label?: string }) => (
  <Field label={label} required><input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
);

type Parsed = Parameters<typeof eqValues>[0];

export function OwnerMoneyForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const people = useList(api.eqPeople);
  const places = useList<CashPlace>(api.cashPlaces);
  const [v, setV] = useState(() => ({ ...emptyEq('advance'), personId: askedPerson() }));
  const f = useMoneyForm(type, mode, (d) => setV(eqValues(d.input as Parsed)));
  const set = (patch: Partial<EqValues>) => setV({ ...v, ...patch });
  const canClassify = me.permissions.includes('eq.own.classify');
  const choices = classificationsFor(people.find((p) => p.id === v.personId), canClassify, v.kind);
  const { input, errors } = ownerMoneyInput(v);

  return (
    <MoneyForm type={type} f={f} title="New owner money" input={input} errors={errors}>
      <Panel title="Whose money came in?">
        <PersonSelect people={people} v={v} set={set} />
      </Panel>
      <Panel title="Where did the money go?">
        <PlacePicker places={places} value={v.cashPlaceId} onChange={(cashPlaceId) => set({ cashPlaceId })} question="Where did the money go?" />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Amount v={v} set={set} />
        <Field label="What is it?" required hint={canClassify ? undefined : 'Recorded as an advance. The accountant classifies it as capital or a deposit for stock by editing it.'}>
          <select className={inputClass} value={v.kind} onChange={(e) => set({ kind: e.target.value })}>
            {choices.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </Field>
        {v.kind === 'capital_stock' && (
          <Field label="Par value of the shares issued" required hint="The rest is paid-in capital in excess of par.">
            <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={v.parValue} onChange={(e) => set({ parValue: e.target.value })} />
          </Field>
        )}
      </div>
      <Field label="Note"><textarea rows={2} className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
    </MoneyForm>
  );
}

export function OfficerForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const people = useList(api.eqPeople);
  const places = useList<CashPlace>(api.cashPlaces);
  const [v, setV] = useState(() => ({ ...emptyEq(''), personId: askedPerson() }));
  const [orig, setOrig] = useState<Parsed>();
  const [owed, setOwed] = useState<{ dueFromCents: number; dueToCents: number } | null>(null);
  const f = useMoneyForm(type, mode, (d) => (setOrig(d.input as Parsed), setV(eqValues(d.input as Parsed))));
  const set = (patch: Partial<EqValues>) => setV({ ...v, ...patch });
  useEffect(() => {
    setOwed(null);
    if (v.personId && me.permissions.includes('eq.ledger.view')) api.officerBalances(v.personId).then(setOwed, () => undefined);
  }, [v.personId]);
  const { input, errors } = officerInput(v);
  const kind = OFFICER_KINDS.find(([k]) => k === v.kind);
  // An edit's preview still sees the original: paying back up to what was owed before it is not too much.
  const fits = (field: string) =>
    field === 'amountCents' && !!owed && orig?.personId === v.personId && orig.kind === v.kind &&
    input.amountCents <= orig.amountCents + (v.kind === 'returned' ? owed.dueFromCents : owed.dueToCents);

  return (
    <MoneyForm type={type} f={f} title="New officer transaction" input={input} errors={errors} adjust={(p, n) => forReplacement(p, n, fits)}>
      <Panel title="Who?">
        <PersonSelect people={people} v={v} set={set} />
        {owed && <p className="text-sm text-slate-600">Owes the company {peso(owed.dueFromCents)} · the company owes them {peso(owed.dueToCents)}</p>}
      </Panel>
      <Panel title="In or out?">
        <div role="radiogroup" aria-label="In or out?" className="grid gap-2 sm:grid-cols-3">
          {OFFICER_KINDS.map(([k, words]) => (
            <button key={k} type="button" role="radio" aria-checked={v.kind === k} onClick={() => set({ kind: k })}
              className={`rounded-lg p-2 text-left text-sm ring-1 ${v.kind === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'}`}>{words}</button>
          ))}
        </div>
      </Panel>
      {kind && (
        <Panel title={kind[2]}>
          <PlacePicker places={places} value={v.cashPlaceId} onChange={(cashPlaceId) => set({ cashPlaceId })} question={kind[2]} />
        </Panel>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Amount v={v} set={set} />
        <Field label="What was it for?" required><input className={inputClass} value={v.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
    </MoneyForm>
  );
}
