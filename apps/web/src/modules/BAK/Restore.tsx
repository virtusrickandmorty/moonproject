/**
 * Restore and the quarterly drill (PLAN C8 "Restore", N-15). Pick a backup and type recovery key A or B: the server opens
 * the copy and checks it. A drill stops there and is recorded. A restore shows what the live data would lose, asks for
 * RESTORE to be typed, and is finished when Virtus next starts. The key is kept only in this screen's memory, and
 * each step asks for the password first.
 */
import { useEffect, useState } from 'react';
import { api, type BackupCheck, type BackupFile } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, manilaTime, useAction, usePasswordPrompt } from '../../components/ui.tsx';
import { cleanKey, factRows, lostWords, restoreConfirmed, reusedSeries, reusedWords, sizeWords, sourceWords, tierWords } from './backups.ts';

type Purpose = 'drill' | 'restore';

export function RestoreBackups() {
  const [list, setList] = useState<BackupFile[] | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<{ backup: BackupFile; purpose: Purpose } | null>(null);
  useEffect(() => void api.bakBackups().then(setList, (e: Error) => setError(e.message)), []);

  if (error) return <Notice>{error}</Notice>;
  if (!list) return <p className="text-slate-500">Loading…</p>;
  if (picked) return <OpenBackup backup={picked.backup} purpose={picked.purpose} onBack={() => setPicked(null)} />;
  return (
    <Panel title="Backups">
      <p className="text-sm text-slate-600">
        Run the drill every quarter: it opens a backup with a recovery key and proves it is sound, and changes nothing. A restore puts a backup back in place
        of the live data.
      </p>
      {list.length === 0 ? <p className="text-sm text-slate-500">No backups found in the backup folder or the off-site folder.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">Made</th><th className="pr-3">Tier</th><th className="pr-3">Where</th><th className="pr-3 text-right">Size</th><th /></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={`${b.source} ${b.file}`} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-2 pr-3">{manilaTime(b.at)}</td>
                  <td className="py-2 pr-3">{tierWords(b.tier)}</td>
                  <td className="py-2 pr-3">{sourceWords(b.source)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{sizeWords(b.bytes)}</td>
                  <td className="space-x-2 whitespace-nowrap py-2 text-right">
                    <Button onClick={() => setPicked({ backup: b, purpose: 'drill' })}>Run drill</Button>
                    <Button tone="danger" onClick={() => setPicked({ backup: b, purpose: 'restore' })}>Restore</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function OpenBackup({ backup, purpose, onBack }: { backup: BackupFile; purpose: Purpose; onBack: () => void }) {
  const [key, setKey] = useState('');
  const [check, setCheck] = useState<BackupCheck | null>(null);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState('');
  const opening = useAction();
  const applying = useAction();
  const password = usePasswordPrompt();
  const open = () => opening.run(async () => {
    setCheck(await api.bakCheck({ source: backup.source, file: backup.file, key: cleanKey(key), purpose }));
    setKey(''); // on a failure it stays, to fix a typo
  });
  const apply = () => applying.run(async () => setMessage((await api.bakApply(check!.stagedId!)).message));
  const title = `${purpose === 'drill' ? 'Restore drill' : 'Restore'}: the ${tierWords(backup.tier).toLowerCase()} backup of ${manilaTime(backup.at)}, ${backup.source === 'local' ? 'on this PC' : 'off-site'}`;

  return (
    <div className="space-y-4">
      <Panel title={title}>
        {!check && (
          <form className="max-w-lg space-y-3" onSubmit={(e) => (e.preventDefault(), key.trim() && password.ask('Open the backup', open))}>
            <p className="text-sm text-slate-700">
              {purpose === 'drill' ? 'The drill opens the backup and checks it; nothing is changed.' : 'First the backup is opened and checked; nothing is changed until you confirm.'}
            </p>
            <Field label="Recovery key A or B" required hint="As printed: AGE-SECRET-KEY-1 and 58 more characters. It is not saved anywhere.">
              <input type="password" autoComplete="off" spellCheck={false} className={`${inputClass} font-mono`} value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Button type="submit" tone="primary" disabled={!key.trim() || opening.busy}>{opening.busy ? 'Opening…' : 'Open the backup'}</Button>
          </form>
        )}
        {opening.error && <Notice>{opening.error}</Notice>}
        {check && (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            {factRows(check).map(([label, value]) => <div key={label} className="contents"><dt className="text-slate-500">{label}</dt><dd>{value}</dd></div>)}
          </dl>
        )}
        {check?.drill === 'passed' && <Notice tone="success">Drill passed. It is recorded as the latest restore drill.</Notice>}
        {check?.stagedId && !message && (
          <div className="max-w-lg space-y-3">
            <Notice tone="warning">{lostWords(check)}</Notice>
            <Notice tone={reusedSeries(check).length ? 'warning' : 'note'}>{reusedWords(check)}</Notice>
            {reusedSeries(check).length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="pr-3">Series</th><th className="pr-3">Last number now</th><th className="pr-3">Last in the backup</th><th className="text-right">Issued again</th></tr></thead>
                <tbody>
                  {reusedSeries(check).map((r) => (
                    <tr key={r.series} className="border-t border-slate-100"><td className="py-1 pr-3">{r.series}</td><td className="pr-3">{r.liveLast}</td><td className="pr-3">{r.backupLast}</td><td className="text-right tabular-nums">{r.reused}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-sm text-slate-700">The current data is kept next to the restored one. Restore within 30 minutes, or open the backup again.</p>
            <Field label="Type RESTORE to go ahead" required>
              <input className={inputClass} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
            <Button tone="danger" disabled={!restoreConfirmed(typed) || applying.busy} onClick={() => password.ask('Restore this backup', apply)}>Restore this backup</Button>
          </div>
        )}
        {applying.error && <Notice>{applying.error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
      </Panel>
      <Button onClick={onBack}>Back to the list</Button>
      {password.dialog}
    </div>
  );
}
