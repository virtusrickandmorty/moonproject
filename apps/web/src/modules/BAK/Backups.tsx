/**
 * Backups (PLAN C8, E13): the status and "Back up now", the recovery keys and folders, USB copies, and restore with its
 * quarterly drill. Each tab shows only with the permission its routes check.
 */
import { useEffect, useState } from 'react';
import { api, type BackupMade, type BackupStatus, type Me } from '../../api.ts';
import { Loading, Button, Field, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { RecoveryKeys } from './RecoveryKeys.tsx';
import { RestoreBackups } from './Restore.tsx';
import { TIERS, madeWords, pendingRestoreWords, runWords, staleWords, tierCount, usbWords, whenWords } from './backups.ts';

const TABS = [
  { section: '', label: 'Status', permission: 'bak.view', denied: 'You cannot view the backup status.' },
  { section: 'keys', label: 'Recovery keys and folders', permission: 'bak.manage', denied: 'Only an owner can change the recovery keys and folders.' },
  { section: 'usb', label: 'USB copy', permission: 'bak.run', denied: 'You cannot copy the backups to USB.' },
  { section: 'restore', label: 'Restore and drill', permission: 'bak.restore', denied: 'Only an owner can restore a backup or run the drill.' },
];

export function Backups({ me, params }: { me: Me; params?: Record<string, string> }) {
  const section = params?.section ?? '';
  const tab = TABS.find((t) => t.section === section);
  const allowed = (permission: string) => me.permissions.includes(permission);
  let page = <Notice>Page not found.</Notice>;
  if (tab && !allowed(tab.permission)) page = <Notice>{tab.denied}</Notice>;
  else if (section === '') page = <Status canRun={allowed('bak.run')} />;
  else if (section === 'keys') page = <RecoveryKeys />;
  else if (section === 'usb') page = <UsbCopy />;
  else if (section === 'restore') page = <RestoreBackups />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold print:hidden">Backups</h1>
      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-sm print:hidden">
        {TABS.filter((t) => allowed(t.permission)).map((t) => (
          <Link key={t.section} to={t.section ? `/bak/${t.section}` : '/bak'} className={`rounded px-3 py-1 ${t.section === section ? 'bg-indigo-50 font-medium text-indigo-800' : 'hover:bg-slate-100'}`}>{t.label}</Link>
        ))}
      </nav>
      {page}
    </div>
  );
}

function Status({ canRun }: { canRun: boolean }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [now, setNow] = useState('');
  const [error, setError] = useState('');
  const [made, setMade] = useState<BackupMade | null>(null);
  const backUp = useAction();
  const load = () => Promise.all([api.bakStatus(), api.health()]).then(([s, h]) => (setStatus(s), setNow(h.serverTime)), (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  const runNow = () => backUp.run(async () => {
    setMade(null);
    try {
      setMade(await api.bakRun());
    } finally {
      await load(); // a failed run is in the log too
    }
  });

  if (error) return <Notice>{error}</Notice>;
  if (!status) return <Loading />;
  const s = status;
  const stale = staleWords(s, now);
  const rows: [string, string][] = [
    ['Kept in the backup folder', TIERS.map((t) => tierCount(t, s.kept[t])).join(' · ')],
    ['Backup folder', s.settings.backupDir],
    ['Last off-site copy', s.settings.offsiteDir ? `${whenWords(s.lastOffsiteAt, now)}, to ${s.settings.offsiteDir}` : 'No off-site folder is set'],
    ['Last restore drill', whenWords(s.lastDrillAt, now)],
    ['Last USB copy, drive A', whenWords(s.usb.A, now)],
    ['Last USB copy, drive B', whenWords(s.usb.B, now)],
  ];
  return (
    <div className="space-y-4">
      {s.pendingRestore && <Notice tone="warning">{pendingRestoreWords(s.pendingRestore)}</Notice>}
      {s.issues.map((i) => <Notice key={i.code} tone={i.level === 'error' ? 'error' : 'warning'}>{i.message}</Notice>)}
      <Panel title="Last good backup">
        {stale && <Notice>{stale}</Notice>}
        <p className="text-sm">{s.lastOk ? <>{whenWords(s.lastOk.at, now)} <span className="text-slate-500">{s.lastOk.file}</span></> : 'No backup has worked yet.'}</p>
        {canRun && <Button tone="primary" disabled={backUp.busy} onClick={runNow}>{backUp.busy ? 'Backing up…' : 'Back up now'}</Button>}
        {made && <Notice tone="success">{madeWords(made)}</Notice>}
        {backUp.error && <Notice>{backUp.error}</Notice>}
      </Panel>
      <Panel title="Copies">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {rows.map(([label, value]) => <div key={label} className="contents"><dt className="text-slate-500">{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </Panel>
      <Panel title="Last runs">
        {s.runs.length === 0 ? <p className="text-sm text-slate-500">No backup has run yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="pr-3">When</th><th className="pr-3">Why</th><th className="pr-3">Tier</th><th>Result</th></tr></thead>
              <tbody>
                {s.runs.map((r) => {
                  const w = runWords(r);
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap py-1 pr-3">{w.when}</td>
                      <td className="whitespace-nowrap py-1 pr-3">{w.reason}</td>
                      <td className="py-1 pr-3">{w.tier}</td>
                      <td className={`py-1 ${w.ok ? '' : 'text-red-700'}`}>{w.result}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function UsbCopy() {
  const [drive, setDrive] = useState<'A' | 'B'>('A');
  const [dir, setDir] = useState('');
  const [result, setResult] = useState('');
  const copy = useAction();
  const run = () => copy.run(async () => {
    setResult('');
    setResult(usbWords(await api.bakUsb(drive, dir.trim())));
  });
  return (
    <Panel title="Copy the backups to a USB drive">
      <p className="text-sm text-slate-600">
        Two drives, A and B, are swapped every week, and one of them is always away from the shop. Each copy adds the daily, monthly and yearly backups the
        drive does not have yet.
      </p>
      <div className="max-w-lg space-y-3">
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">Drive</legend>
          <div className="flex gap-4">
            {(['A', 'B'] as const).map((d) => (
              <label key={d} className="flex items-center gap-2"><input type="radio" name="drive" checked={drive === d} onChange={() => (setDrive(d), setResult(''))} />Drive {d}</label>
            ))}
          </div>
        </fieldset>
        <Field label="Folder on the drive" required>
          <input className={inputClass} placeholder="E:\Virtus-Backups" value={dir} onChange={(e) => (setDir(e.target.value), setResult(''))} />
        </Field>
        <Button tone="primary" disabled={!dir.trim() || copy.busy} onClick={run}>{copy.busy ? 'Copying…' : `Copy to drive ${drive}`}</Button>
        {result && <Notice tone="success">{result}</Notice>}
        {copy.error && <Notice>{copy.error}</Notice>}
      </div>
    </Panel>
  );
}
