/**
 * What a module form does around its own fields (PLAN H2, NR-4): load the document being edited and ask the reason
 * first, confirm with the server's preview, then record (or cancel and reissue), asking again if the total changed.
 * A form that may be backdated passes the date with the input; the client sends no other date.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ReasonDialog } from './ReasonDialog.tsx';
import type { Issue } from '@moonproject/shared';
import { api, ApiError, type DocDetail, type DocHeader, type DocTypeInfo, type Preview } from '../../api.ts';
import { navigate } from '../../router.tsx';
import { Notice } from '../../components/ui.tsx';
import { docPath } from '../../shell/menu.ts';
import { RecordDialog, type FormMode } from '../../generic/DocForm.tsx';

import { boxRefusals, generalRefusal, issueFields, type BoxErrors } from './boxes.ts';

interface Asked { preview: Preview; input: unknown; businessDate?: string }

/** `onRecorded` runs after the server recorded it and before the view opens (e.g. discard the form's draft). */
export function useRecord(type: DocTypeInfo, mode: FormMode, prefill: (d: DocDetail) => void, onRecorded?: () => Promise<unknown>) {
  const [original, setOriginal] = useState<DocHeader>();
  const [reason, setReason] = useState('');
  const [asked, setAsked] = useState<Asked | null>(null);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [refusedInput, setRefusedInput] = useState('');
  const [refused, setRefused] = useState<BoxErrors>({});
  const fail = (e: Error) => { setRefused(boxRefusals(e)); setError(generalRefusal(e)); };
  const editId = mode.kind === 'edit' ? mode.id : '';
  useEffect(() => {
    if (editId) api.get(type.key, editId).then((d) => (prefill(d), setOriginal(d.header)), fail);
  }, [type.key, editId]);

  /**
   * A replacement is previewed while the original still stands, so the server may object to the original itself
   * ("already paid by LPAY-000001"). Its reissue cancels first and checks everything again, so those errors are dropped.
   */
  const preview = (input: unknown, businessDate?: string) =>
    api.preview(type.key, input, businessDate).then((p) => {
      const shown = original ? { ...p, issues: withoutOriginal(p.issues, original.number) } : p;
      setRefusedInput(JSON.stringify(input)); setRefused(issueFields(shown.issues));
      return shown;
    }).catch((e) => { setRefusedInput(JSON.stringify(input)); fail(e); throw e; });

  /** Record pressed: show the typing slips, or the server's preview to confirm. */
  const ask = (input: unknown, errors: string[], businessDate?: string) => {
    setTouched(true);
    if (errors.length === 0) preview(input, businessDate).then((p) => Object.keys(issueFields(p.issues)).length ? setAsked(null) : setAsked({ preview: p, input, businessDate }), fail);
  };
  const record = async (key: string) => {
    const { preview: shown, input, businessDate } = asked!;
    try {
      const r = original
        ? await api.reissue(type.key, original.id, input, shown.totalCents, reason, key, businessDate)
        : await api.post(type.key, input, shown.totalCents, key, businessDate);
      await onRecorded?.().catch(() => undefined);
      navigate(docPath(type.key, `/${r.id}?recorded=1`));
    } catch (e) {
      setRefusedInput(JSON.stringify(input)); fail(e as Error);
      if (Object.keys(boxRefusals(e)).length) setAsked(null);
      if (e instanceof ApiError && e.code === 'TOTALS_CHANGED') setAsked({ ...asked!, preview: await preview(input, businessDate) });
      throw e;
    }
  };

  /** Shown instead of the form: loading the original, already cancelled, or the reason not given yet. */
  let gate: ReactNode = null;
  if (editId && !original) gate = error ? <Notice>{error}</Notice> : <p className="text-slate-500">Loading…</p>;
  else if (original && original.status !== 'posted') gate = <Notice>{original.number} is already cancelled.</Notice>;
  else if (original && !reason) {
    const explain = `A recorded document is never changed. ${original.number} will be cancelled and a new one issued with a new number. Nothing changes until you record the replacement.`;
    gate = <ReasonDialog title={`Edit ${original.number}`} explain={explain} confirmLabel="Continue to edit" onConfirm={setReason} onClose={() => navigate(docPath(type.key, `/${original.id}`))} />;
  }
  const top = (
    <>
      {original && <Notice tone="info">When you record, {original.number} is cancelled and the replacement gets a new number. Reason: {reason}</Notice>}
      {error && <Notice>{error}</Notice>}
    </>
  );
  const dialog = asked && <RecordDialog type={type} preview={asked.preview} original={original} reason={reason} onRecord={record} onClose={() => setAsked(null)} />;
  const title = (fresh: string) => (original ? `Edit ${original.number}` : fresh);
  return { original, touched, refused, refusedInput, fail, ask, preview, gate, top, dialog, title };
}

/** A replacement's preview without the errors that only name the document it replaces. */
export const withoutOriginal = (issues: Issue[], number: string) => issues.filter((i) => i.level !== 'error' || !i.message.includes(number));

/** The server's date (Manila), '' until it answers. */
export function useToday(): string {
  const [today, setToday] = useState('');
  useEffect(() => void api.health().then((h) => setToday(h.serverTime.slice(0, 10)), () => undefined), []);
  return today;
}
