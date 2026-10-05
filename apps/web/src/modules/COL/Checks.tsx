/**
 * Customer checks (PLAN E5, E10, ACC-23). Checks on hand: every check received and not yet deposited, with the days
 * since it came; tick checks and deposit them (one fund transfer from Checks on hand to the bank); record a check the bank
 * returned. Post-dated checks: a memo list (nothing is recorded in the books) until each check's date, then one button
 * opens a collection filled in from it. The server works out every figure.
 */
import { useEffect, useMemo, useState } from 'react';
import { ReasonDialog } from '../JO/ReasonDialog.tsx';
import { schemaFields, useBoxes } from '../JO/boxes.ts';
import { depositBody, returnBody, pdcInput } from './validation.ts';
import { formatPesos } from '@moonproject/shared';
import { api, ApiError, newIdempotencyKey, type CashPlace, type CheckAtBank, type ChecksOnHand as List, type Me, type PostDatedCheck, type Preview } from '../../api.ts';
import { Button, Dialog, Field, JournalTable, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { cents } from './money.ts';
import { CustomerPicker, type Picked } from './parts.tsx';
import { PDC_STATUS, checkKey, pdcActions, pdcCollectionPath, ticked } from './checks.ts';

const can = (me: Me, p: string) => me.permissions.includes(p);
const docLink = (type: string, d: { id: string; number: string }) => <Link to={docPath(type, `/${d.id}`)} className="text-indigo-700 underline">{d.number}</Link>;

export function ChecksOnHand({ me }: { me: Me }) {
  const [list, setList] = useState<List | null>(null);
  const [banks, setBanks] = useState<CashPlace[]>([]);
  const [atBank, setAtBank] = useState<CheckAtBank[]>([]);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [bank, setBank] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [returning, setReturning] = useState<CheckAtBank | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const load = () => {
    api.checksOnHand().then(setList, (e: Error) => setError(e.message));
    if (can(me, 'col.checks.return')) api.checksAtBank().then(setAtBank, (e: Error) => setError(e.message));
  };
  useEffect(() => {
    load();
    api.cashPlaces().then((all) => setBanks(all.filter((p) => p.kind === 'bank')), (e: Error) => setError(e.message));
  }, []);
  const pick = useMemo(() => ticked(list?.checks ?? [], keys), [list, keys]);
  const toggle = (k: string) => setKeys((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const boxes = useBoxes(schemaFields(depositBody, { checks: pick.refs, toCashPlaceId: Number(bank) }), JSON.stringify([pick.refs, bank]));
  const openDeposit = () => {
    boxes.submit();
    setError('');
    api.checkDepositPreview(pick.refs, Number(bank)).then((p) => { boxes.capture(new ApiError('VALIDATION', '', 422, p.issues.filter((i) => i.level === 'error'))); if (!p.issues.some((i) => i.level === 'error' && i.field)) setConfirm(p); }, (e: Error) => setError(boxes.refuse(e)));
  };
  const deposit = async (key: string) => {
    const r = await boxes.run(() => api.checkDeposit(pick.refs, Number(bank), confirm!.totalCents, key));
    if (!r) { setConfirm(null); return; }
    setConfirm(null);
    setKeys(new Set());
    setDone(`Deposited ${r.count} check${r.count === 1 ? '' : 's'}: recorded as ${r.transfer.number}.`);
    load();
  };
  const depositor = can(me, 'col.checks.deposit');
  const difference = list && list.ledgerCents !== null ? list.ledgerCents - list.totalCents : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Checks on hand</h1>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      <Panel title="Received, not yet deposited">
        {list && list.checks.length === 0 && <p className="text-sm text-slate-500">No customer check is on hand.</p>}
        {list && list.checks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>{depositor && <th />}<th className="py-1">Received</th><th className="text-right">Days</th><th>Customer</th><th>Check no.</th><th>Bank</th><th>Check date</th><th className="text-right">Amount</th><th>Collection</th></tr>
              </thead>
              <tbody>
                {list.checks.map((c) => (
                  <tr key={checkKey(c)} className="border-t border-slate-100">
                    {depositor && <td><Field label="" error={boxes.error(`checks.${pick.refs.findIndex((r) => r.collectionId === c.collectionId && r.lineNo === c.lineNo)}`, `checks.${pick.refs.findIndex((r) => r.collectionId === c.collectionId && r.lineNo === c.lineNo)}.collectionId`, `checks.${pick.refs.findIndex((r) => r.collectionId === c.collectionId && r.lineNo === c.lineNo)}.lineNo`, ...(c === list.checks[0] ? ['checks'] : []))}><input {...boxes.box('checks')} type="checkbox" aria-label={`Deposit check no. ${c.checkNumber}`} checked={keys.has(checkKey(c))} onChange={() => toggle(checkKey(c))} /></Field></td>}
                    <td className="py-1">{c.receivedOn}</td>
                    <td className="text-right tabular-nums">{c.days}</td>
                    <td>{c.customerName}</td>
                    <td>{c.checkNumber}{c.returned && <span className="block text-xs text-amber-800">Returned by the bank ({c.returned.number})</span>}</td>
                    <td>{c.bank}</td>
                    <td>{c.checkDate}</td>
                    <td className="text-right tabular-nums">{peso(c.amountCents)}</td>
                    <td>{docLink('col.collection', { id: c.collectionId, number: c.collectionNumber })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm">
            <dt className="font-medium">Total of the list</dt><dd className="text-right font-semibold tabular-nums">{peso(list.totalCents)}</dd>
            {list.ledgerCents !== null && <><dt className="text-slate-600">Checks on hand in the books</dt><dd className="text-right tabular-nums">{peso(list.ledgerCents)}</dd></>}
          </dl>
        )}
        {difference !== 0 && (
          <Notice tone="warning">The books hold {peso(Math.abs(difference))} {difference > 0 ? 'more' : 'less'} in Checks on hand than this list: an opening balance, or money moved in or out of Checks on hand other than by a collection or a deposit from this screen. Ask the accountant to look at the cash book.</Notice>
        )}
      </Panel>

      {depositor && list && list.checks.length > 0 && (
        <Panel title="Deposit">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Bank" error={boxes.error('toCashPlaceId')}>
              <select {...boxes.box('toCashPlaceId')} aria-label="Deposit to bank" className={inputClass} value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Pick the bank</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <p className="text-sm">Ticked: {pick.refs.length} · <span className="font-semibold tabular-nums">{peso(pick.totalCents)}</span></p>
            <Button tone="primary" disabled={pick.refs.length === 0 || !bank} onClick={openDeposit}>Deposit the ticked checks</Button>
          </div>
        </Panel>
      )}

      {can(me, 'col.checks.return') && atBank.length > 0 && (
        <Panel title="Deposited checks (if the bank returns one)">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-1">Deposited</th><th>Customer</th><th>Check no.</th><th>Bank</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>
              {atBank.map((c) => (
                <tr key={checkKey(c)} className="border-t border-slate-100">
                  <td className="py-1">{docLink('cash.transfer', c.deposit)} · {c.deposit.date}</td>
                  <td>{c.customerName}</td><td>{c.checkNumber}</td><td>{c.bank}</td>
                  <td className="text-right tabular-nums">{peso(c.amountCents)}</td>
                  <td className="text-right"><Button onClick={() => setReturning(c)}>Returned by the bank</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {confirm && <DepositDialog preview={confirm} onRecord={deposit} onClose={() => setConfirm(null)} />}
      {returning && <ReturnDialog check={returning} onClose={() => setReturning(null)} onDone={(text) => { setReturning(null); setDone(text); load(); }} />}
    </div>
  );
}

function DepositDialog({ preview, onRecord, onClose }: { preview: Preview; onRecord: (key: string) => Promise<unknown>; onClose: () => void }) {
  const key = useMemo(newIdempotencyKey, [preview]);
  const a = useAction();
  return (
    <Dialog title="Record this deposit?" onClose={onClose}>
      <p>{preview.summary}</p>
      <p className="text-sm text-slate-600">Total: <span className="text-lg font-semibold tabular-nums text-slate-900">{peso(preview.totalCents)}</span></p>
      {preview.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      {preview.journal && <Panel title="Behind the scenes"><JournalTable lines={preview.journal} /></Panel>}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Go back</Button>
        <Button tone="primary" autoFocus disabled={a.busy || preview.issues.some((i) => i.level === 'error')} onClick={() => a.run(() => onRecord(key))}>{a.busy ? 'Recording…' : 'Record'}</Button>
      </div>
    </Dialog>
  );
}

/** A check the bank returned: back to Checks on hand, the bank's charge, and its collection cancelled so the customer owes it again. */
export function ReturnDialog({ check, onClose, onDone }: { check: CheckAtBank; onClose: () => void; onDone: (text: string) => void }) {
  const [charge, setCharge] = useState('');
  const [cancel, setCancel] = useState(true);
  const key = useMemo(newIdempotencyKey, []);
  const chargeCents = cents(charge);
  const checks = chargeCents === undefined ? { chargeCents: 'Type the bank charge like 250.00' } : schemaFields(returnBody.pick({ chargeCents: true }), chargeCents ? { chargeCents } : {});
  const boxes = useBoxes(checks, charge);
  const explain = `Check no. ${check.checkNumber} of ${check.customerName} (${peso(check.amountCents)}) comes back from the bank into ${check.cashPlaceName}. Type what the bank wrote as the reason.`;
  return (
    <ReasonDialog max={300} title={`Check no. ${check.checkNumber} returned by the bank`} explain={explain} confirmLabel="Record the return" onClose={onClose}
      onConfirm={async (reason) => {
        boxes.submit();
        if (chargeCents === undefined) return;
        const r = await boxes.run(() => api.checkReturn({ collectionId: check.collectionId, lineNo: check.lineNo, ...(chargeCents ? { chargeCents } : {}), reason, cancelCollection: cancel }, key));
        if (!r) return;
        onDone(`${r.summary} Recorded as ${[r.transfer.number, r.charge?.number].filter(Boolean).join(' and ')}${r.cancelled ? `; ${check.collectionNumber} is cancelled, so the customer owes it again` : ''}.`);
      }}>
      <Field label="Bank charge for the returned check" error={boxes.error('chargeCents')} hint="Leave blank if none">
        <input {...boxes.box('chargeCents')} inputMode="decimal" placeholder="0.00" className={`${inputClass} max-w-40 text-right tabular-nums`} value={charge} onChange={(e) => setCharge(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
        <span>Cancel {check.collectionNumber}, so what the check paid is owed again. Untick if the customer asked to deposit it again, or if {check.collectionNumber} also took other money (then edit it without this check).</span>
      </label>
    </ReasonDialog>
  );
}

export function PostDatedChecks({ me }: { me: Me }) {
  const [rows, setRows] = useState<PostDatedCheck[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<PostDatedCheck | null>(null);
  const [error, setError] = useState('');
  const load = () => api.pdcs().then(setRows, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  const manage = can(me, 'col.pdc.manage');
  const record = can(me, 'col.post');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Post-dated checks</h1>
        <span className="flex-1" />
        {manage && !adding && <Button tone="primary" onClick={() => setAdding(true)}>+ Add a post-dated check</Button>}
      </div>
      <p className="text-sm text-slate-600">A check dated after today is not money yet: it waits here and is recorded as a collection on its date. Nothing on this list is in the books.</p>
      {error && <Notice>{error}</Notice>}
      {adding && <AddPdc onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load(); }} />}
      <Panel title="The list">
        {rows && rows.length === 0 && <p className="text-sm text-slate-500">No post-dated check is listed.</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Check date</th><th>Customer</th><th>Check no.</th><th>Bank</th><th className="text-right">Amount</th><th>For</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="py-1">{p.checkDate}</td>
                    <td>{p.customerName}{p.note && <span className="block text-xs text-slate-500">{p.note}</span>}</td>
                    <td>{p.checkNumber}</td><td>{p.bank}</td>
                    <td className="text-right tabular-nums">{peso(p.amountCents)}</td>
                    <td>{p.jobOrders.map((j) => j.number).join(', ') || 'Deposit'}</td>
                    <td>
                      {PDC_STATUS[p.status]}
                      {p.usedBy && <span className="block">{docLink('col.collection', p.usedBy)}</span>}
                      {p.voided && <span className="block text-xs text-slate-500">{p.voided.reason}</span>}
                    </td>
                    <td className="space-x-2 whitespace-nowrap text-right">
                      {record && pdcActions(p).record && <Link to={pdcCollectionPath(p.id)} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Record the collection</Link>}
                      {manage && pdcActions(p).void && <Button onClick={() => setVoiding(p)}>Void</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {voiding && (
        <ReasonDialog max={300} title={`Void check no. ${voiding.checkNumber}`} explain="The check comes off the list for good (for example the customer replaced it). To list it again, add it again." confirmLabel="Void it" danger
          onClose={() => setVoiding(null)} onConfirm={async (reason) => { await api.voidPdc(voiding.id, reason); setVoiding(null); void load(); }} />
      )}
    </div>
  );
}

export function AddPdc({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [jobOrders, setJobOrders] = useState<{ id: string; number: string; dueDate: string; balanceDueCents: number }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [f, setF] = useState({ bank: '', checkNumber: '', checkDate: '', amount: '', note: '' });
  const a = useAction();
  useEffect(() => {
    setJobOrders([]);
    setChosen([]);
    if (customer) api.openItems(customer.id).then((o) => setJobOrders(o.jobOrders), () => setJobOrders([]));
  }, [customer?.id]);
  const amountCents = cents(f.amount);
  const errors = [
    ...(customer ? [] : ['Pick the customer.']),
    ...(f.checkNumber.trim() && f.bank.trim() && f.checkDate ? [] : ['Type the check number, the bank and the date on the check.']),
    ...(amountCents && amountCents > 0 ? [] : ['Type the amount like 25,000.00']),
  ];
  const body = { customerId: customer?.id ?? '', bank: f.bank.trim(), checkNumber: f.checkNumber.trim(), checkDate: f.checkDate, amountCents: amountCents!, jobOrderIds: chosen, ...(f.note.trim() ? { note: f.note.trim() } : {}) };
  const boxes = useBoxes(schemaFields(pdcInput, body), JSON.stringify(body));
  const add = () => a.run(() => boxes.run(async () => {
    if (errors.length > 0) return;
    await api.addPdc({ customerId: customer!.id, bank: f.bank.trim(), checkNumber: f.checkNumber.trim(), checkDate: f.checkDate, amountCents: amountCents!, jobOrderIds: chosen, ...(f.note.trim() ? { note: f.note.trim() } : {}) });
    onAdded();
  }));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Panel title="Add a post-dated check">
      <CustomerPicker boxes={boxes} value={customer} onChange={setCustomer} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Check number" error={boxes.error('checkNumber')} required><input {...boxes.box('checkNumber')} className={inputClass} value={f.checkNumber} onChange={set('checkNumber')} /></Field>
        <Field label="Bank" error={boxes.error('bank')} required><input {...boxes.box('bank')} className={inputClass} value={f.bank} onChange={set('bank')} /></Field>
        <Field label="Date on the check" error={boxes.error('checkDate')} required><input {...boxes.box('checkDate')} type="date" className={inputClass} value={f.checkDate} onChange={set('checkDate')} /></Field>
        <Field label="Amount" error={boxes.error('amountCents')} required><input {...boxes.box('amountCents')} inputMode="decimal" placeholder="0.00" className={`${inputClass} text-right tabular-nums`} value={f.amount} onChange={set('amount')} /></Field>
      </div>
      {jobOrders.length > 0 && (
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">For which job orders?</legend>
          {jobOrders.map((j, i) => (
            <Field key={j.id} label="" error={boxes.error(`jobOrderIds.${chosen.indexOf(j.id)}`, ...(i === 0 ? ['jobOrderIds'] : []))}>
              <input {...boxes.box('jobOrderIds')} type="checkbox" checked={chosen.includes(j.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, j.id] : chosen.filter((x) => x !== j.id))} />
              <span>{j.number} · due {j.dueDate} · {formatPesos(j.balanceDueCents)} left to pay</span>
            </Field>
          ))}
        </fieldset>
      )}
      <Field label="Note" error={boxes.error('note')}><input {...boxes.box('note')} className={inputClass} value={f.note} onChange={set('note')} /></Field>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex gap-2">
        <Button tone="primary" disabled={a.busy} onClick={add}>Add to the list</Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Panel>
  );
}
