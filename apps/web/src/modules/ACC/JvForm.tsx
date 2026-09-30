/**
 * Journal voucher form (PLAN D5 JV, E12): the one document where the accountant picks accounts. Lines of account, the
 * party the account asks for, debit or credit and a memo, with a running "debits − credits" that must be zero. Someone
 * who may backdate (acc.backdate) gives the entry date; an earlier day is a late entry and needs a reason.
 * Also the Edit of a recorded voucher (cancel + reissue, NR-4). An accrual may be marked to reverse on the first day of
 * next month; "Reverse" in Reversals due opens this form at ?reverse=<id> with the reversal filled in and dated that day.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type Account, type DocTypeInfo, type JvReversal, type Me, type PartyType } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, peso } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord, useToday } from '../../generic/record.tsx';
import { CustomerPicker, Errors, useLive } from '../COL/parts.tsx';
import { PARTY_WORDS, balanceWords, emptyRow, entryDate, jvInput, postable, rowsFromInput, totals, type JvLineInput, type JvRow } from './jv.ts';

type Option = { id: string; label: string };
const TYPE_WORDS: Record<Account['type'], string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses' };

/** The lists a line's party is picked from; customers are searched instead, and a free party is typed. */
const PARTY_LISTS: Partial<Record<PartyType, () => Promise<Option[]>>> = {
  supplier: () => api.suppliers().then((r) => r.map((s) => ({ id: s.id, label: s.name }))),
  employee: () => api.activeEmployees().then((r) => r.map((e) => ({ id: e.id, label: `${e.name} (${e.code})` }))),
  officer: () => api.eqPeople().then((r) => r.filter((p) => p.isOfficer).map((p) => ({ id: p.id, label: p.name }))),
  stockholder: () => api.eqPeople().then((r) => r.filter((p) => p.isStockholder).map((p) => ({ id: p.id, label: p.name }))),
  // Financing of an asset purchase sits on the purchase until a loan takes it over (FA-BUY, LOAN-IN).
  loan: () => Promise.all([api.loans('posted'), api.financedAssets()]).then(([loans, fa]) => [
    ...loans.map((l) => ({ id: l.id, label: `${l.number} · ${l.lender}` })),
    ...fa.map((p) => ({ id: p.id, label: `${p.number} · ${p.description}, financed by ${p.lender}` })),
  ]),
  asset: () => api.assets().then((r) => r.filter((a) => a.status !== 'cancelled').map((a) => ({ id: a.id, label: `${a.number} · ${a.description}` }))),
};

export function JvForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lists, setLists] = useState<Partial<Record<PartyType, Option[]>>>({});
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState<JvRow[]>([emptyRow(), emptyRow()]);
  const [dateText, setDateText] = useState('');
  const [reason, setReason] = useState('');
  const [reverseNextMonth, setReverseNextMonth] = useState(false);
  /** The JV this one reverses and the day it is dated. */
  const [reversal, setReversal] = useState<{ id: string; number: string; date: string } | null>(null);
  const today = useToday();
  const fill = (lines: JvLineInput[]) => {
    setRows(rowsFromInput(lines));
    lines.forEach((l, i) => l.party?.type === 'customer' && api.customer(l.party.id).then((c) => setRows((old) => old.map((x, j) => (j === i ? { ...x, partyName: c.display_name } : x))), () => undefined));
  };
  const r = useRecord(type, mode, (d) => {
    const input = d.input as { memo: string; lines: JvLineInput[]; lateReason?: string; reverseNextMonth?: boolean; reversalOf?: string };
    const doc = d.doc as { reverses?: { number: string } | null };
    setMemo(input.memo);
    fill(input.lines);
    // A late entry is reissued on its own date, with its reason; a reversal on its reversal day; anything else on today.
    if (input.lateReason) (setDateText(d.header.businessDate), setReason(input.lateReason));
    setReverseNextMonth(!!input.reverseNextMonth);
    if (input.reversalOf) setReversal({ id: input.reversalOf, number: doc.reverses?.number ?? '', date: d.header.businessDate });
  });
  useEffect(() => void api.accounts().then(setAccounts, r.fail), []);
  const reverseOf = mode.kind === 'new' ? new URLSearchParams(location.search).get('reverse') : null;
  useEffect(() => {
    if (reverseOf) api.jvReversal(reverseOf).then((x: JvReversal) => (setMemo(x.input.memo), fill(x.input.lines), setReversal({ id: x.input.reversalOf, number: x.original.number, date: x.businessDate })), r.fail);
  }, [reverseOf]);

  const usable = useMemo(() => postable(accounts), [accounts]);
  const accountOf = (row: JvRow) => accounts.find((a) => String(a.id) === row.accountId);
  const needed = [...new Set(rows.map((x) => accountOf(x)?.partyType).filter((t): t is PartyType => !!t && t in PARTY_LISTS))];
  useEffect(() => {
    for (const t of needed) if (!lists[t]) PARTY_LISTS[t]!().then((o) => setLists((old) => ({ ...old, [t]: o })), r.fail);
  }, [needed.join()]);

  const mayBackdate = type.dating === 'accountant_may_backdate' && me.permissions.includes('acc.backdate');
  // A reversal is dated its original's reversal day, which is never a late entry.
  const date = reversal ? { businessDate: reversal.date !== today ? reversal.date : undefined, late: false, error: undefined } : mayBackdate ? entryDate(dateText, today, reason) : { late: false };
  const typed = jvInput(memo, rows, accounts, date.late ? reason : undefined, reversal ? { reversalOf: reversal.id } : { reverseNextMonth });
  const errors = date.error ? [...typed.errors, date.error] : typed.errors;
  const { input } = typed;
  const sums = totals(rows);
  const live = useLive(JSON.stringify([input, date.businessDate]), errors.length === 0, () => r.preview(input, date.businessDate));
  const set = (i: number, patch: Partial<JvRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const record = () => r.ask(input, errors, date.businessDate);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && record()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('New journal voucher')}</h1>
        {r.top}
        <Field label="What is the entry for?" required hint="Shown in the general journal, e.g. Accrual of September rent">
          <input className={inputClass} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <Panel title="Lines">
          {rows.map((row, i) => {
            const a = accountOf(row);
            return (
              <div key={i} className="space-y-2 rounded-md p-2 ring-1 ring-slate-200">
                <div className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
                  <select aria-label={`Line ${i + 1} account`} className={inputClass} value={row.accountId} onChange={(e) => set(i, { accountId: e.target.value, party: '', partyName: '' })}>
                    <option value="">Pick an account</option>
                    {Object.entries(TYPE_WORDS).map(([t, words]) => (
                      <optgroup key={t} label={words}>
                        {usable.filter((x) => x.type === t).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}{x.isReserved ? ' (reserved)' : ''}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="Debit" className={`${inputClass} text-right tabular-nums`} value={row.debit} onChange={(e) => set(i, { debit: e.target.value })} />
                  <input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="Credit" className={`${inputClass} text-right tabular-nums`} value={row.credit} onChange={(e) => set(i, { credit: e.target.value })} />
                  <Button disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove this line">✕</Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {a?.partyType === 'customer' && (
                    <CustomerPicker value={row.party ? { id: row.party, name: row.partyName || 'Customer on file' } : null} onChange={(c) => set(i, { party: c?.id ?? '', partyName: c?.name ?? '' })} />
                  )}
                  {a?.partyType === 'free' && <input aria-label={`Line ${i + 1} party`} placeholder="Party, if any (name or reference)" className={inputClass} value={row.party} onChange={(e) => set(i, { party: e.target.value })} />}
                  {a?.partyType && PARTY_LISTS[a.partyType] && (
                    <select aria-label={`Line ${i + 1} ${PARTY_WORDS[a.partyType]}`} className={inputClass} value={row.party} onChange={(e) => set(i, { party: e.target.value })}>
                      <option value="">Pick the {PARTY_WORDS[a.partyType]}</option>
                      {(lists[a.partyType] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      {row.party && lists[a.partyType] && !lists[a.partyType]!.some((o) => o.id === row.party) && <option value={row.party}>On file: {row.party}</option>}
                    </select>
                  )}
                  <input aria-label={`Line ${i + 1} memo`} placeholder="Line memo (optional)" className={`${inputClass} ${a?.partyType ? '' : 'sm:col-span-2'}`} value={row.memo} onChange={(e) => set(i, { memo: e.target.value })} />
                </div>
              </div>
            );
          })}
          {rows.length < 100 && <Button onClick={() => setRows([...rows, emptyRow()])}>+ Add a line</Button>}
        </Panel>
        {reversal ? (
          <Notice tone="info">This reverses {reversal.number || 'an accrual'}: its lines with debits and credits swapped, dated {reversal.date}. Record it as it is.</Notice>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reverseNextMonth} onChange={(e) => setReverseNextMonth(e.target.checked)} />
            Reverse on the first day of next month (an accrual). It shows in Reversals due from that day.
          </label>
        )}
        {mayBackdate && !reversal && (
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label="Date of the entry" hint="Empty is today">
              <input type="date" max={today || undefined} className={inputClass} value={dateText} onChange={(e) => setDateText(e.target.value)} />
            </Field>
            {date.late && (
              <Field label="Why is it recorded late?" required hint="It shows in the late-entries report">
                <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={record} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-600">Debits</dt><dd className="text-right tabular-nums">{peso(sums.debits)}</dd>
          <dt className="text-slate-600">Credits</dt><dd className="text-right tabular-nums">{peso(sums.credits)}</dd>
          <dt className="font-medium">Debits − credits</dt>
          <dd className={`text-right font-semibold tabular-nums ${sums.difference === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{peso(sums.difference)}</dd>
        </dl>
        <p className={`text-sm ${sums.difference === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{balanceWords(sums.difference)}</p>
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
