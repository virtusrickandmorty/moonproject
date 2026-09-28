/**
 * Opening balances (PLAN D8 "Cut-over", MIG-02): one page that walks the accountant through the cut-over. Set the
 * cut-over date; record the opening documents dated on it (OB- and each module's own); read the checks (3900 at zero,
 * the trial balance on the cut-over date, each control account against its parties); then close the opening, which
 * the server records with who closed it and when. Setting the date and the close need a fresh password.
 */
import { useEffect, useState } from 'react';
import { api, type DocTypeInfo, type Me, type OpeningState } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, StatusChip, inputClass, longDate, manilaTime, peso } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { docPath, labelOf } from '../../shell/menu.ts';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { FORMS } from '../screens.ts';
import { closeBlockers, cutoverError, equityWords, openingForms } from './opening.ts';

const num = 'whitespace-nowrap py-1 pl-3 text-right tabular-nums';
const tone = (ok: boolean) => (ok ? 'text-emerald-700' : 'font-semibold text-red-700');

function CutoverDate({ s, mayPost, onChange }: { s: OpeningState; mayPost: boolean; onChange: (s: OpeningState) => void }) {
  const [typed, setTyped] = useState(s.cutoverDate ?? '');
  const action = useStepUpAction('setting the cut-over date');
  const problem = cutoverError(typed, s.cutoverDate);
  return (
    <Panel title="1. The cut-over date">
      <p className="text-sm">
        {s.cutoverDate ? <>The books open on <strong>{longDate(s.cutoverDate)}</strong>. Every opening document is dated that day.</> : 'No cut-over date yet. Pick the last day the old books cover, usually a month end.'}
      </p>
      {mayPost && !s.closed && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={s.cutoverDate ? 'Move it to' : 'Cut-over date'}><input type="date" className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
          <Button tone="primary" disabled={!!problem || action.busy} onClick={() => void action.run(async () => onChange(await api.setCutoverDate(typed)))}>
            {s.cutoverDate ? 'Move the cut-over date' : 'Set the cut-over date'}
          </Button>
        </div>
      )}
      {s.cutoverDate && !s.closed && <p className="text-xs text-slate-500">It moves only while no opening document is recorded on it: cancel them first.</p>}
      {action.error && <Notice>{action.error}</Notice>}
      {action.dialog}
    </Panel>
  );
}

function Documents({ s, docTypes }: { s: OpeningState; docTypes: DocTypeInfo[] }) {
  const title = (key: string) => {
    const t = docTypes.find((d) => d.key === key);
    return t ? labelOf(t) : key;
  };
  const links = s.closed ? [] : openingForms(docTypes, Object.keys(FORMS));
  return (
    <Panel title="2. Opening documents">
      <p className="text-sm text-slate-600">Cash, inventories, prepayments and the equity breakdown go on Opening Balances (OB-). Balances kept per customer, supplier, person, loan or asset open with their own documents.</p>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => <Link key={l.key} to={l.path} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">{l.label}</Link>)}
        </div>
      )}
      {s.documents.length === 0 ? <p className="text-sm text-slate-500">No opening document recorded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">Document</th><th className="pr-3">Number</th><th className="pr-3">Status</th><th className="pl-3 text-right">Total</th><th className="pl-3">Summary</th></tr></thead>
            <tbody>
              {s.documents.map((d) => (
                <tr key={d.id} className={`border-t border-slate-100 align-top ${d.status === 'cancelled' ? 'text-slate-500' : ''}`}>
                  <td className="py-1 pr-3">{title(d.docType)}</td>
                  <td className="py-1 pr-3"><Link to={docPath(d.docType, `/${d.id}`)} className="underline">{d.number}</Link></td>
                  <td className="py-1 pr-3"><StatusChip status={d.status} /></td>
                  <td className={num}>{peso(d.totalCents)}</td>
                  <td className="py-1 pl-3">{d.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Checks({ s }: { s: OpeningState }) {
  return (
    <Panel title="3. The checks">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>Opening balance equity (3900)</dt>
        <dd className={`text-right tabular-nums ${tone(s.openingEquityCents === 0)}`}>{equityWords(s.openingEquityCents)}</dd>
        <dt>Trial balance on the cut-over date</dt>
        <dd className={`text-right ${tone(!!s.trialBalance?.balanced)}`}>
          {s.trialBalance ? `${s.trialBalance.balanced ? 'Balances' : 'Does not balance'}: debits ${peso(s.trialBalance.totalDebitCents)}, credits ${peso(s.trialBalance.totalCreditCents)}` : 'No cut-over date yet'}
        </dd>
      </dl>
      <h3 className="pt-2 text-sm font-medium">Each account kept per customer, supplier or person against the sum of its parties</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="pr-3">Account</th><th className="pr-3">Kept per</th><th className="pl-3 text-right">Account total</th><th className="pl-3 text-right">Sum of parties</th><th className="pl-3">Tied</th></tr></thead>
          <tbody>
            {s.checks.map((c) => (
              <tr key={c.code} className={`border-t border-slate-100 ${c.ok ? '' : 'bg-red-50 text-red-800'}`}>
                <td className="py-1 pr-3">{c.code} {c.name}</td>
                <td className="py-1 pr-3">{c.partyType}</td>
                <td className={num}>{peso(c.controlCents)}</td>
                <td className={num}>{peso(c.partiesCents)}</td>
                <td className={`py-1 pl-3 ${tone(c.ok)}`}>{c.ok ? 'Tied' : `Off by ${peso(c.controlCents - c.partiesCents)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Close({ s, mayPost, onChange }: { s: OpeningState; mayPost: boolean; onChange: (s: OpeningState) => void }) {
  const [asking, setAsking] = useState(false);
  const action = useStepUpAction('closing the opening');
  if (s.closed) {
    return (
      <Panel title="4. Close the opening">
        <Notice tone="success">
          Closed by {s.closed.closedByName} on {manilaTime(s.closed.closedAt)}, with the trial balance on {s.closed.cutoverDate} at debits {peso(s.closed.totalDebitCents)} and credits {peso(s.closed.totalCreditCents)}.
          Correct opening balances from now on with a journal voucher.
        </Notice>
      </Panel>
    );
  }
  const blockers = closeBlockers(s);
  const close = () => (setAsking(false), void action.run(async () => onChange(await api.closeOpening())));
  return (
    <Panel title="4. Close the opening">
      <p className="text-sm text-slate-600">The accountant signs off the opening trial balance. After the close no opening document is recorded, edited or cancelled, and the cut-over date no longer moves.</p>
      {blockers.map((b) => <Notice key={b} tone="warning">{b}</Notice>)}
      {mayPost && <Button tone="primary" disabled={blockers.length > 0 || action.busy} onClick={() => setAsking(true)}>Close the opening</Button>}
      {action.error && <Notice>{action.error}</Notice>}
      {asking && (
        <Dialog title="Close the opening?" onClose={() => setAsking(false)}>
          <p className="text-sm">This signs off the opening on {s.cutoverDate}. It cannot be undone: later corrections are journal vouchers.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAsking(false)}>Go back</Button>
            <Button tone="primary" onClick={close}>Close the opening</Button>
          </div>
        </Dialog>
      )}
      {action.dialog}
    </Panel>
  );
}

export function OpeningBalances({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  const allowed = me.permissions.includes('acc.opening.view');
  const mayPost = me.permissions.includes('acc.opening.post');
  const [s, setS] = useState<OpeningState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void (allowed && api.opening().then(setS, (e: Error) => setError(e.message))), [allowed]);
  if (!allowed) return <Notice>You cannot view the opening balances.</Notice>;
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Opening balances</h1>
      <p className="text-sm text-slate-600">
        The balances Virtus had on the cut-over date, recorded against opening balance equity (3900). Close the opening once 3900 is zero, the trial balance balances and every check is tied.
      </p>
      {error && <Notice>{error}</Notice>}
      {!s && !error && <p className="text-slate-500">Loading…</p>}
      {s && (
        <>
          <CutoverDate key={s.cutoverDate ?? ''} s={s} mayPost={mayPost} onChange={setS} />
          <Documents s={s} docTypes={docTypes} />
          <Checks s={s} />
          <Close s={s} mayPost={mayPost} onChange={setS} />
        </>
      )}
    </div>
  );
}
