/**
 * Cash advance repayment (CAR-) and write-off (CAW-) forms (PLAN D5 CA-REPAY, CA-WO, E11): who, from the employees who
 * owe (separated ones too), what they owe now, and the amount. Opened from the employee's cash advance view with
 * ?employee=<id>. Also their Edit (cancel and reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { formatPesos } from '@moonproject/shared';
import { api, type CaOwing, type CaStatus, type CashPlace, type DocTypeInfo, type Preview } from '../../api.ts';
import { Button, CashPlaceButtons, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { emptyRepayment, emptyWriteoff, repaymentInput, writeoffInput } from './settle.ts';

const asked = () => new URLSearchParams(location.search).get('employee') ?? '';

/** The employee picker with what they owe now; an edited document's employee stays listed though its amount still counts. */
function Who({ question, employeeId, onPick, onStatus }: { question: string; employeeId: string; onPick: (id: string) => void; onStatus?: (s: CaStatus | null) => void }) {
  const [owing, setOwing] = useState<CaOwing[]>([]);
  const [status, setStatus] = useState<CaStatus | null>(null);
  useEffect(() => void api.caOwing().then(setOwing, () => undefined), []);
  useEffect(() => {
    setStatus(null);
    if (employeeId) api.caStatus(employeeId).then(setStatus, () => undefined);
  }, [employeeId]);
  useEffect(() => onStatus?.(status), [status]);
  const people = owing.some((o) => o.employeeId === employeeId) || !employeeId ? owing : [...owing, { employeeId, name: status?.name ?? '…', owedCents: status?.outstandingCents ?? 0 }];
  return (
    <Panel title={question}>
      <select aria-label="Employee" className={inputClass} value={employeeId} onChange={(e) => onPick(e.target.value)}>
        <option value="">Pick the employee</option>
        {people.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.name} · owes {peso(p.owedCents)}</option>)}
      </select>
      {owing.length === 0 && !employeeId && <p className="text-sm text-slate-500">Nobody owes on cash advances.</p>}
      {status && <p className="text-sm text-slate-600">{status.name}{status.active ? '' : ' (separated)'} owes {peso(status.outstandingCents)} now{status.installmentCents ? `, ${peso(status.installmentCents)} deducted each payroll` : ''}.</p>}
    </Panel>
  );
}

function Live({ live }: { live: Preview | null }) {
  return (
    <>
      {live && <p className="text-sm">{live.summary}</p>}
      {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
    </>
  );
}

export function RepaymentForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [places, setPlaces] = useState<CashPlace[]>([]);
  const [status, setStatus] = useState<CaStatus | null>(null);
  const [v, setV] = useState(() => emptyRepayment(mode.kind === 'new' ? asked() : ''));
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { employeeId: string; cashPlaceId: number; amountCents: number; reference?: string; note?: string };
    setV({ employeeId: s.employeeId, cashPlaceId: String(s.cashPlaceId), amount: formatPesos(s.amountCents), reference: s.reference ?? '', note: s.note ?? '' });
  });
  useEffect(() => void api.cashPlaces().then(setPlaces, r.fail), []);
  const { input, errors } = repaymentInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title('Cash advance paid back')}</h1>
      {r.top}
      <Who question="Who pays back?" employeeId={v.employeeId} onPick={(employeeId) => setV({ ...v, employeeId })} onStatus={setStatus} />
      <Panel title="Where did the money go?">
        <CashPlaceButtons label="Where did the money go?" places={places} value={v.cashPlaceId} onChange={(cashPlaceId) => setV({ ...v, cashPlaceId })} />
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" required hint={status && status.outstandingCents > 0 ? `All of it is ${peso(status.outstandingCents)}` : undefined}>
          <input inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Reference (bank or GCash)"><input className={inputClass} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
      </div>
      {status && status.outstandingCents > 0 && <Button onClick={() => setV({ ...v, amount: formatPesos(status.outstandingCents) })}>All of it</Button>}
      <Field label="Note"><input className={inputClass} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      <Live live={live} />
      <Errors list={errors} show={r.touched} />
      <div className="flex gap-2">
        <Button tone="primary" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Record</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}

export function WriteoffForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [accounts, setAccounts] = useState<{ id: number; code: string; name: string }[]>([]);
  const [v, setV] = useState(() => emptyWriteoff(mode.kind === 'new' ? asked() : ''));
  const r = useRecord(type, mode, (d) => {
    const s = d.input as { employeeId: string; amountCents: number; accountId: number; reason: string };
    setV({ employeeId: s.employeeId, amount: formatPesos(s.amountCents), accountId: String(s.accountId), reason: s.reason });
  });
  useEffect(() => void api.caWriteoffAccounts().then(setAccounts, r.fail), []);
  const { input, errors } = writeoffInput(v);
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{r.title('Write off a cash advance')}</h1>
      {r.top}
      <Who question="Whose cash advance is forgiven?" employeeId={v.employeeId} onPick={(employeeId) => setV({ ...v, employeeId })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" hint="Leave it blank to write off all that is owed.">
          <input inputMode="decimal" placeholder="All that is owed" className={`${inputClass} text-right`} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </Field>
        <Field label="Charge to" required hint="Usually 6990 Miscellaneous, or salaries when it is treated as pay.">
          <select aria-label="Expense account" className={inputClass} value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
            <option value="">Pick the expense account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Why is it written off? (at least 10 characters)" required>
        <textarea rows={2} className={inputClass} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Field>
      <Live live={live} />
      <Errors list={errors} show={r.touched} />
      <div className="flex gap-2">
        <Button tone="danger" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Write off</Button>
        <Button onClick={() => history.back()}>Back</Button>
      </div>
      {r.dialog}
    </form>
  );
}
