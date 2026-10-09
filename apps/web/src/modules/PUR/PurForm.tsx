/**
 * The frame the purchase order and receiving report forms share: the edit gate (reason first, NR-4), the checks, Record
 * with the server's confirm dialog, and "So far" from the server's own preview. The client sends only the input and the
 * total the user confirmed.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type DocDetail, type DocHeader, type DocTypeInfo, type Preview } from '../../api.ts';
import { Button, Notice, Panel, peso } from '../../components/ui.tsx';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';
import { navigate } from '../../router.tsx';
import { docPath } from '../../shell/menu.ts';
import { EditGate, Errors, useLive } from '../COL/parts.tsx';

/** On an edit, `load` fills the fields from the recorded document. */
export function usePurForm(type: DocTypeInfo, mode: FormMode, load: (d: DocDetail) => void) {
  const [original, setOriginal] = useState<DocHeader>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (mode.kind === 'edit') api.get(type.key, mode.id).then((d) => (load(d), setOriginal(d.header)), (e: Error) => setError(e.message));
  }, [type.key, mode.kind === 'edit' ? mode.id : '']);
  return { original, error, setError };
}

/** `side`: shown in So far above the checks (the purchase order's lines); `wide`: a wider right column for it. */
export function PurFrame(p: { type: DocTypeInfo; form: ReturnType<typeof usePurForm>; title: string; input: unknown; errors: string[]; showTotal: boolean; side?: ReactNode; wide?: boolean; children: ReactNode }) {
  const { type, form, input, errors } = p;
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<Preview | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const preview = () => api.preview(type.key, input);
  const live = useLive(JSON.stringify([input, form.original?.id]), errors.length === 0, preview);
  if (form.original && !reason) return <EditGate original={form.original} typeKey={type.key} onReason={setReason} />;

  const openConfirm = () => {
    setTouched(true);
    if (errors.length === 0) preview().then(setConfirm, (e: Error) => setError(e.message));
  };
  const record = async (key: string) => {
    try {
      const r = form.original ? await api.reissue(type.key, form.original.id, input, confirm!.totalCents, reason, key) : await api.post(type.key, input, confirm!.totalCents, key);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      // The server's total differs from what the user confirmed: show the new preview and ask again.
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setConfirm(await preview());
      throw e;
    }
  };
  return (
    <form onSubmit={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && openConfirm()} className={`grid items-start gap-4 ${p.wide ? 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]' : 'lg:grid-cols-[1fr_20rem]'}`}>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{form.original ? `Edit ${form.original.number}` : p.title}</h1>
        {form.original && <Notice tone="info">When you record, {form.original.number} is cancelled and the replacement gets a new number. Reason: {reason}</Notice>}
        {(form.error || error) && <Notice>{form.error || error}</Notice>}
        {p.children}
        <Errors list={errors} show={touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={openConfirm} title="Ctrl+Enter">Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {p.side}
        {live && p.showTotal && <p className="text-2xl font-semibold tabular-nums">{peso(live.totalCents)}</p>}
        {!live && <p className="text-sm text-slate-500">Fill in the required fields to see the checks{p.showTotal ? ' and the total' : ''}.</p>}
        {live && <p className="text-sm">{live.summary}</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {confirm && <RecordDialog type={type} preview={confirm} original={form.original} reason={reason} onRecord={record} onClose={() => setConfirm(null)} />}
    </form>
  );
}
