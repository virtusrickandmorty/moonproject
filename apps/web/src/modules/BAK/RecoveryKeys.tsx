/**
 * Recovery keys and folders (PLAN C8, E13). The two recovery keys are made here, in the browser, with age: each secret
 * key is shown on a sheet to print, typed back (its last 8 characters), and forgotten when the screen closes. Only the
 * public keys (age1…) go to the server. The secret keys are never sent and never stored, not even in browser storage.
 */
import { useEffect, useState } from 'react';
import { api, type BackupSettings } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, longDate, useAction, usePasswordPrompt } from '../../components/ui.tsx';
import { TYPED_BACK, bothTypedBack, typedBackOk } from './backups.ts';

type Letter = 'a' | 'b';
type Key = { secret: string; recipient: string };

/** age is loaded only here, when keys are made, so other screens do not carry it. */
async function newKey(): Promise<Key> {
  const { generateX25519Identity, identityToRecipient } = await import('age-encryption');
  const secret = await generateX25519Identity();
  return { secret, recipient: await identityToRecipient(secret) };
}

export function RecoveryKeys() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const [backupDir, setBackupDir] = useState('');
  const [offsiteDir, setOffsiteDir] = useState('');
  const [keys, setKeys] = useState<Record<Letter, Key> | null>(null);
  const [typed, setTyped] = useState<Record<Letter, string>>({ a: '', b: '' });
  const [printing, setPrinting] = useState<Letter | null>(null);
  const [saved, setSaved] = useState('');
  const making = useAction();
  const save = useAction();
  const password = usePasswordPrompt();

  useEffect(() => {
    Promise.all([api.bakStatus(), api.health()]).then(([s, h]) => {
      setSettings(s.settings);
      setBackupDir(s.settings.backupDir);
      setOffsiteDir(s.settings.offsiteDir ?? '');
      setToday(h.serverTime.slice(0, 10));
    }, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!printing) return;
    window.print(); // only the chosen sheet is visible to the printer
    setPrinting(null);
  }, [printing]);

  if (error) return <Notice>{error}</Notice>;
  if (!settings) return <p className="text-slate-500">Loading…</p>;

  const hasKeys = settings.recipients.length === 2;
  const make = () => making.run(async () => {
    setSaved('');
    setTyped({ a: '', b: '' });
    setKeys({ a: await newKey(), b: await newKey() });
  });
  const ready = !!backupDir.trim() && (keys ? bothTypedBack({ a: keys.a.secret, b: keys.b.secret }, typed) : hasKeys);
  const doSave = () => save.run(async () => {
    const recipients = keys ? [keys.a.recipient, keys.b.recipient] : settings.recipients;
    const s = await api.bakSaveSettings(settings.version, { backupDir: backupDir.trim(), offsiteDir: offsiteDir.trim() || null, recipients });
    setSettings(s);
    setKeys(null);
    setTyped({ a: '', b: '' });
    setSaved(keys ? 'Saved. New backups are locked with the new recovery keys.' : 'Saved.');
  });

  return (
    <div className="space-y-4">
      <div className="space-y-4 print:hidden">
        <Panel title="Folders">
          <div className="max-w-lg space-y-3">
            <Field label="Backup folder" required hint="On this PC, for example D:\Virtus-Backups.">
              <input className={inputClass} value={backupDir} onChange={(e) => (setBackupDir(e.target.value), setSaved(''))} />
            </Field>
            <Field label="Off-site folder" hint="The Google Drive for desktop folder. The daily, monthly and yearly backups are copied there. Leave it blank for none.">
              <input className={inputClass} value={offsiteDir} onChange={(e) => (setOffsiteDir(e.target.value), setSaved(''))} />
            </Field>
          </div>
        </Panel>
        <Panel title="Recovery keys">
          <p className="text-sm text-slate-700">
            Every backup is locked with two recovery keys, A and B, and either one opens it. Virtus keeps only their public halves, so nobody can open a
            backup without one of the printed keys.
          </p>
          {hasKeys ? (
            <p className="text-sm">Set: key A <span className="font-mono">{settings.recipients[0]}</span>, key B <span className="font-mono">{settings.recipients[1]}</span></p>
          ) : <Notice>No recovery keys yet, so backups are off.</Notice>}
          {!keys && <Button disabled={making.busy} onClick={make}>Make new recovery keys</Button>}
          {making.error && <Notice>{making.error}</Notice>}
          {keys && hasKeys && (
            <Notice tone="warning">
              Backups made before you save open only with the old keys, and yearly backups are kept forever. Keep the old sheets as long as those backups are kept.
            </Notice>
          )}
        </Panel>
      </div>
      {keys && (
        <>
          <p className="text-sm text-slate-700 print:hidden">Print both sheets, or write the keys down exactly. These keys are shown only now: they are never saved in Virtus.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {(['a', 'b'] as const).map((l) => <KeySheet key={l} letter={l} secret={keys[l].secret} date={today} hidden={!!printing && printing !== l} onPrint={() => setPrinting(l)} />)}
          </div>
          <div className="print:hidden">
            <Panel title="Type the keys back">
              <p className="text-sm text-slate-700">From the printed sheets, type the last {TYPED_BACK} characters of each key.</p>
              <div className="grid max-w-lg gap-3 sm:grid-cols-2">
                {(['a', 'b'] as const).map((l) => (
                  <Field key={l} label={`Last ${TYPED_BACK} characters of key ${l.toUpperCase()}`} required
                    error={typed[l].trim().length >= TYPED_BACK && !typedBackOk(keys[l].secret, typed[l]) ? 'This does not match the key.' : undefined}>
                    <input className={`${inputClass} font-mono`} autoComplete="off" spellCheck={false} value={typed[l]} onChange={(e) => setTyped({ ...typed, [l]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <Button onClick={() => (setKeys(null), setTyped({ a: '', b: '' }))}>Throw these keys away</Button>
            </Panel>
          </div>
        </>
      )}
      <div className="space-y-2 print:hidden">
        {!ready && !keys && !hasKeys && <p className="text-sm text-slate-500">Make the recovery keys first.</p>}
        {save.error && <Notice>{save.error}</Notice>}
        {saved && <Notice tone="success">{saved}</Notice>}
        <Button tone="primary" disabled={!ready || save.busy} onClick={() => password.ask('Save the backup settings', doSave)}>{keys ? 'Save the folders and the new keys' : 'Save the folders'}</Button>
      </div>
      {password.dialog}
    </div>
  );
}

function KeySheet({ letter, secret, date, hidden, onPrint }: { letter: Letter; secret: string; date: string; hidden: boolean; onPrint: () => void }) {
  return (
    <section className={`space-y-4 rounded-lg border-2 border-dashed border-slate-400 bg-white p-6 print:break-after-page print:border-0 ${hidden ? 'print:hidden' : ''}`}>
      <h2 className="text-2xl font-bold">Recovery key {letter.toUpperCase()}</h2>
      <p className="break-all font-mono text-2xl leading-relaxed">{secret}</p>
      <p className="text-sm">Made on {date ? longDate(date) : '…'}</p>
      <p className="font-medium">Keep A with the owner; seal B somewhere else. Without one of them no backup can be opened.</p>
      <Button className="print:hidden" onClick={onPrint}>Print key {letter.toUpperCase()}</Button>
    </section>
  );
}
