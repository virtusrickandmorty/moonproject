import { useState, type ReactNode } from 'react';
import { Button, Dialog, Field, Notice, inputClass, useAction } from '../../components/ui.tsx';
import { useBoxes } from './boxes.ts';

export function ReasonDialog(p: { title: string; explain: string; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<unknown> | void; onClose: () => void; children?: ReactNode; max?: number }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  const text = reason.trim();
  const checks = text.length < 10 ? { reason: 'Give a reason of at least 10 characters.' } : p.max && text.length > p.max ? { reason: `Use at most ${p.max} characters.` } : {};
  const boxes = useBoxes(checks as Record<string, string>, reason);
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      <p className="text-sm text-slate-700">{p.explain}</p>
      {p.children}
      <Field label="Reason (at least 10 characters)" required error={boxes.error('reason')}>
        <textarea {...boxes.box('reason')} autoFocus rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {a.error && <Notice>{a.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={p.onClose}>Go back</Button>
        <Button tone={p.danger ? 'danger' : 'primary'} disabled={reason.trim().length < 10 || a.busy} onClick={() => a.run(() => boxes.run(async () => p.onConfirm(reason.trim())))}>
          {p.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
