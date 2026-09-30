/**
 * Release slip form (PLAN E4, D3): pick the job order, tick the lines and pieces going out (only what is left), who claimed
 * it and the ID seen, the credit note and due days when a balance is still due (owner and accountant), and the owner's
 * reason when it goes out before it is ready. The booklet invoice number is recorded in the same action, unless the
 * invoice is to follow. The balance due and "write these on the booklet" come from the server's preview.
 * A recorded release is corrected by cancelling it and releasing again, so this form has no Edit.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, newIdempotencyKey, type DocTypeInfo, type JoStatus, type Me, type ReleasePreview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Button, Dialog, Field, JournalTable, Notice, Panel, inputClass, peso, useAction } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { docPath } from '../../shell/menu.ts';
import { Errors, Figures, useLive } from '../COL/parts.tsx';
import { Booklet, JoPicker } from './parts.tsx';
import { ID_SEEN, allLeft, emptyRelease, releaseInput, type ReleaseValues } from './forms.ts';

const money = `${inputClass} text-right tabular-nums`;
const READY = ['ready', 'partially_released'];

function ConfirmDialog(p: { preview: ReleasePreview; invoiceNumber: string | null; onRecord: (key: string) => Promise<unknown>; onClose: () => void }) {
  const key = useMemo(newIdempotencyKey, [p.preview]); // same key when a click is retried, a new one after a new preview
  const a = useAction();
  const r = p.preview.release;
  const errors = r.issues.filter((i) => i.level === 'error');
  return (
    <Dialog title="Record this release?" onClose={p.onClose}>
      <p>{r.summary}</p>
      {p.invoiceNumber ? <Booklet b={p.preview.booklet} depositAppliedCents={p.preview.depositAppliedCents} /> : <Notice tone="warning">Invoice to follow: the release waits on the exceptions list until its invoice is recorded.</Notice>}
      {p.invoiceNumber && <p className="text-sm">Invoice no. <b>{p.invoiceNumber}</b> is recorded with it.</p>}
      {r.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      {r.journal && r.journal.length > 0 && <Panel title="Behind the scenes"><JournalTable lines={r.journal} /></Panel>}
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={p.onClose}>Go back</Button>
        <Button tone="primary" autoFocus disabled={a.busy || errors.length > 0} onClick={() => a.run(() => p.onRecord(key))}>{a.busy ? 'Recording…' : 'Record'}</Button>
      </div>
    </Dialog>
  );
}

export function ReleaseForm({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const [v, setV] = useState<ReleaseValues>(emptyRelease);
  const [jo, setJo] = useState<{ id: string; label: string } | null>(null);
  const [status, setStatus] = useState<JoStatus | null>(null);
  const [confirm, setConfirm] = useState<ReleasePreview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const fail = (e: Error) => setError(e.message);
  const can = (key: string) => me.permissions.includes(key);

  const choose = (id: string) =>
    api.joStatus(id).then((s) => {
      setJo({ id, label: `${s.jobOrder.number} · ${s.jobOrder.customerName}` });
      setStatus(s);
      setV((old) => ({ ...emptyRelease(id), claimedBy: old.claimedBy, idSeen: old.idSeen, qtys: allLeft(s.lines) }));
    }, fail);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('jo');
    if (mode.kind === 'new' && id) void choose(id);
  }, []);

  const set = (patch: Partial<ReleaseValues>) => setV((old) => ({ ...old, ...patch }));
  const typed = releaseInput(v, status?.lines ?? []);
  const live = useLive(JSON.stringify(typed.release), typed.releaseErrors.length === 0, () => api.joReleasePreview(typed.release));
  const balance = live?.release.doc.balanceDueCents ?? status?.money.balanceDueCents ?? 0;
  const ready = status ? READY.includes(status.stage) : true;

  const openConfirm = () => {
    setTouched(true);
    if (typed.errors.length === 0) api.joReleasePreview(typed.release).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const r = await api.joRelease({ release: typed.release, invoice: typed.invoice }, confirm!.release.totalCents, key);
      navigate(docPath(type.key, `/${r.release.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.joReleasePreview(typed.release));
      throw e;
    }
  };

  if (mode.kind === 'edit') return <Notice tone="info">A recorded release is not edited: cancel it (and its invoice record first, if any), then release again.</Notice>;
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">New release slip</h1>
        {error && <Notice>{error}</Notice>}
        <Panel title="Job order">
          <JoPicker value={jo} onChange={(x) => (x ? void choose(x.id) : (setJo(null), setStatus(null), setV(emptyRelease())))} />
          {status && <p className="text-sm text-slate-600">{status.stageLabel} · due {status.jobOrder.dueDate} · balance due <b className="tabular-nums text-slate-900">{peso(status.money.balanceDueCents)}</b></p>}
        </Panel>
        {status && (
          <Panel title="What goes out">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="w-8" /><th>Line</th><th className="text-right">Ordered</th><th className="text-right">Released</th><th className="w-28 text-right">Pieces now</th></tr></thead>
              <tbody>
                {status.lines.map((l) => {
                  const typedQty = v.qtys[l.lineNo] ?? '';
                  const ticked = !!typedQty.trim() && typedQty.trim() !== '0';
                  return (
                    <tr key={l.lineNo} className={`border-t border-slate-100 ${l.leftQty === 0 ? 'text-slate-400' : ''}`}>
                      <td className="py-1">
                        <input type="checkbox" aria-label={`Release line ${l.lineNo}`} disabled={l.leftQty === 0} checked={ticked}
                          onChange={(e) => set({ qtys: { ...v.qtys, [l.lineNo]: e.target.checked ? String(l.leftQty) : '' } })} />
                      </td>
                      <td className="py-1">{l.lineNo}. {l.description}</td>
                      <td className="py-1 text-right tabular-nums">{l.qty}</td>
                      <td className="py-1 text-right tabular-nums">{l.releasedQty}</td>
                      <td className="py-1">
                        {l.leftQty > 0 ? <input aria-label={`Pieces of line ${l.lineNo}`} inputMode="numeric" className={money} value={typedQty} onChange={(e) => set({ qtys: { ...v.qtys, [l.lineNo]: e.target.value } })} /> : <span className="block text-right">All out</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}
        <Panel title="Who claimed it">
          <Field label="Claimed by" required>
            <input className={inputClass} value={v.claimedBy} onChange={(e) => set({ claimedBy: e.target.value })} />
          </Field>
          <div role="radiogroup" aria-label="ID seen" className="flex flex-wrap gap-2">
            {ID_SEEN.map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={v.idSeen === k} onClick={() => set({ idSeen: k })}
                className={`rounded-full px-3 py-1 text-sm ring-1 ${v.idSeen === k ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">Only the kind of ID is kept, never its number.</p>
        </Panel>
        {status && !ready && (
          <Panel title="Not ready yet">
            <Notice tone="warning">{status.jobOrder.number} is {status.stageLabel}. Mark it Ready for release first{can('jo.release_override') ? ', or release it anyway with a reason.' : ', or ask the owner to release it.'}</Notice>
            {can('jo.release_override') && (
              <Field label="Owner's reason to release it now" required hint="At least 10 characters">
                <input className={inputClass} value={v.overrideReason} onChange={(e) => set({ overrideReason: e.target.value })} />
              </Field>
            )}
          </Panel>
        )}
        {status && balance > 0 && (
          <Panel title="Still to be paid">
            <p className="text-sm">{peso(balance)} is still due.</p>
            {can('jo.release_with_balance') ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Field label="Why it goes out before it is paid" required>
                  <input className={inputClass} value={v.creditNote} onChange={(e) => set({ creditNote: e.target.value })} />
                </Field>
                <Field label="Pay within (days)" required>
                  <input inputMode="numeric" className={money} value={v.creditDueInDays} onChange={(e) => set({ creditDueInDays: e.target.value })} />
                </Field>
              </div>
            ) : (
              <Notice tone="warning">Only the owner or the accountant can release it before it is paid. Take the payment first.</Notice>
            )}
          </Panel>
        )}
        <Panel title="Invoice">
          <Field label="Invoice number (from the booklet)" required={!v.invoiceToFollow} hint="VAT sellers write an invoice for every sale.">
            <input inputMode="numeric" disabled={v.invoiceToFollow} className={`${inputClass} max-w-40`} value={v.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.invoiceToFollow} onChange={(e) => set({ invoiceToFollow: e.target.checked })} />
            Invoice to follow (the booklet is not at hand)
          </label>
        </Panel>
        <Errors list={typed.errors} show={touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        <Figures items={[['Released now', live?.release.totalCents ?? 0, 'text-lg font-semibold'], ['Balance due', balance, 'font-semibold']]} />
        {live && <Booklet b={live.booklet} depositAppliedCents={live.depositAppliedCents} />}
        {live && <p className="text-sm">{live.release.summary}</p>}
        {live?.release.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <ConfirmDialog preview={confirm} invoiceNumber={typed.invoice?.invoiceNumber ?? null} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
