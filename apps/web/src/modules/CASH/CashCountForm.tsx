import { useEffect, useState } from 'react';
import { api, ApiError, type CashAccount, type DocHeader, type DocTypeInfo, type Preview } from '../../api.ts';
import { Button, Field, Notice, Panel, ReasonDialog, inputClass, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { DENOMINATIONS, countLines, type Quantities } from './rules.ts';

type Stored = { cashPlaceId: number; lines: { denominationCents: number; qty: number }[]; note?: string };

export function CashCountForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [places, setPlaces] = useState<CashAccount[]>([]);
  const [placeId, setPlaceId] = useState('');
  const [quantities, setQuantities] = useState<Quantities>({});
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [live, setLive] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = (e: Error) => setError(e.message);
  const modeKey = mode.kind === 'edit' ? mode.id : mode.draftId ?? '';

  useEffect(() => {
    api.cashAccounts().then((all) => setPlaces(all.filter((p) => p.kind === 'cash' && p.balanceCents !== null)), fail);
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => {
      const saved = d.input as Stored;
      setOriginal(d.header);
      setPlaceId(String(saved.cashPlaceId));
      setQuantities(Object.fromEntries(saved.lines.map((line) => [line.denominationCents, String(line.qty)])));
      setNote(saved.note ?? '');
    }, fail);
    else if (mode.draftId) api.drafts(type.key).then((all) => {
      const found = all.find((d) => d.id === mode.draftId);
      if (!found) return setError('That draft was already recorded or discarded.');
      const values = found.payload.values ?? {};
      setDraft({ id: found.id, version: found.version });
      setPlaceId(values.cashPlaceId ?? '');
      setNote(values.note ?? '');
      setQuantities(Object.fromEntries(DENOMINATIONS.map((d) => [d, values[`qty${d}`] ?? ''])));
    }, fail);
  }, [type.key, modeKey]);

  const count = countLines(quantities);
  const errors = [
    ...(!placeId ? ['Pick the cash box you counted.'] : []),
    ...count.errors,
    ...(note.trim().length > 500 ? ['Keep the note within 500 characters.'] : []),
  ];
  const input = { cashPlaceId: Number(placeId), lines: count.lines, ...(note.trim() ? { note: note.trim() } : {}) };
  const inputKey = JSON.stringify(input);
  useEffect(() => {
    if (errors.length) { setLive(null); return; }
    let stale = false;
    const timer = setTimeout(() => api.preview(type.key, input).then((p) => { if (!stale) setLive(p); }, () => { if (!stale) setLive(null); }), 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [type.key, inputKey, errors.length]);

  const openConfirm = () => {
    setTouched(true);
    if (!errors.length) api.preview(type.key, input).then(setConfirm, fail);
  };
  const record = async (key: string) => {
    try {
      const result = original ? await api.reissue(type.key, original.id, input, confirm!.totalCents, reason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      if (draft) await api.discardDraft(draft.id).catch(() => undefined);
      navigate(docPath(type.key, `/${result.id}?recorded=1`));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await api.preview(type.key, input));
      throw e;
    }
  };
  const saveDraft = async () => {
    setBusy(true); setError('');
    try {
      const values = { cashPlaceId: placeId, note, ...Object.fromEntries(DENOMINATIONS.map((d) => [`qty${d}`, quantities[d] ?? ''])) };
      const result = draft ? await api.saveDraft(draft.id, draft.version, { values }) : await api.createDraft(type.key, { values });
      setDraft(result);
      setMessage('Draft saved. It has no number and records nothing until you press Record.');
    } catch (e) { fail(e as Error); }
    finally { setBusy(false); }
  };
  if (original && !reason) return original.status !== 'posted' ? <Notice>{original.number} is already cancelled.</Notice> : <ReasonDialog title={`Edit ${original.number}`} explain="The original will be cancelled and a new count issued with a new number. Nothing changes until you record the replacement." confirmLabel="Continue to edit" onConfirm={setReason} onClose={() => navigate(docPath(type.key, `/${original.id}`))} />;

  return <form onSubmit={(e) => e.preventDefault()} className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold">{original ? `Edit ${original.number}` : `New ${type.title}`}</h1>
    {original && <Notice tone="info">{original.number} will be cancelled when you record its replacement. Reason: {reason}</Notice>}
    {error && <Notice>{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <Panel title="Which cash box did you count?">
      <Field label="Cash box" required><select className={inputClass} value={placeId} onChange={(e) => setPlaceId(e.target.value)}><option value="">Pick one</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      {places.length === 0 && <Notice tone="info">No cash box balance is visible to you.</Notice>}
    </Panel>
    <Panel title="Bills and coins">
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>Denomination</th><th>Quantity</th><th className="text-right">Amount</th></tr></thead><tbody>
        {DENOMINATIONS.map((denom) => {
          const qty = Number(quantities[denom] ?? 0);
          return <tr key={denom} className="border-t border-slate-100"><td className="py-2">{peso(denom)}</td><td><input aria-label={`${peso(denom)} quantity`} type="number" min="0" max="100000" step="1" className={`${inputClass} max-w-36`} value={quantities[denom] ?? ''} onChange={(e) => setQuantities((old) => ({ ...old, [denom]: e.target.value }))} /></td><td className="text-right tabular-nums">{Number.isInteger(qty) && qty > 0 && qty <= 100_000 ? peso(denom * qty) : '—'}</td></tr>;
        })}
      </tbody></table></div>
      <p className="border-t border-slate-300 pt-2 text-right text-lg font-semibold">Counted total: <span className="tabular-nums">{peso(count.totalCents)}</span></p>
    </Panel>
    <Field label="Note"><textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    {live && <p className="text-sm">{live.summary}</p>}
    {live?.issues.map((issue) => <Notice key={issue.code + issue.field} tone={issue.level}>{issue.message}</Notice>)}
    {touched && errors.map((e) => <Notice key={e}>{e}</Notice>)}
    <div className="flex gap-2"><Button tone="primary" disabled={!type.canPost} onClick={openConfirm}>Record</Button>{mode.kind === 'new' && <Button disabled={busy} onClick={saveDraft}>Save draft</Button>}<Button onClick={() => history.back()}>Back</Button></div>
    {confirm && <RecordDialog type={type} preview={confirm} original={original} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
  </form>;
}
