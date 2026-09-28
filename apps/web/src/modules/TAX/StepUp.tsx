import { useState } from 'react';
import { api, ApiError } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, useAction } from '../../components/ui.tsx';

function StepUpDialog({ purpose, onClose, onConfirm }: { purpose: string; onClose: () => void; onConfirm: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const action = useAction();
  return <Dialog title="Confirm with your password" onClose={onClose}>
    <p className="text-sm text-slate-700">Enter your current password to continue {purpose}.</p>
    <form onSubmit={(e) => { e.preventDefault(); void action.run(() => onConfirm(password)); }} className="space-y-3">
      <Field label="Password" required><input autoFocus type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {action.error && <Notice>{action.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button tone="primary" type="submit" disabled={!password || action.busy}>Continue</Button></div>
    </form>
  </Dialog>;
}

/** Runs a change that needs a fresh password; the box asks for it only when the server does. `purpose` ends "to continue …". */
export function useStepUpAction(purpose = 'changing the booklet register') {
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await task(); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'STEP_UP_REQUIRED') setPending(() => task);
      else setError((e as Error).message);
    } finally { setBusy(false); }
  };
  const dialog = pending && <StepUpDialog purpose={purpose} onClose={() => setPending(null)} onConfirm={async (password) => {
    await api.stepUp(password);
    const retry = pending;
    setPending(null);
    await run(retry);
  }} />;
  return { run, busy, error, dialog };
}
