/**
 * Admin › Roles and permissions (PLAN C6): every permission in plain words, grouped by module, against every role. Tick
 * to grant, untick to remove, then save the role's column. Saving asks for the owner's password again, and warns
 * before taking away what the owner role needs to keep the shop running.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me, type RoleGrid } from '../../api.ts';
import { Button, Dialog, Notice } from '../../components/ui.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { changesFor, grantsOf, groupPermissions, ownerLosses } from './roles.ts';
import { roleLabel } from './users.ts';

export function Roles({ me }: { me: Me }) {
  const [grid, setGrid] = useState<RoleGrid>();
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [warn, setWarn] = useState<{ role: string; losses: string[] } | null>(null);
  const action = useStepUpAction('changing what a role may do');
  const load = () => api.roles().then((g) => { setGrid(g); setDraft(grantsOf(g)); }, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (!me.permissions.includes('sec.users.manage')) return <Notice>You do not have permission to manage roles.</Notice>;
  if (!grid) return error ? <Notice>{error}</Notice> : <p className="text-sm text-slate-500">Loading…</p>;

  const saved = grantsOf(grid);
  const keys = grid.permissions.map((p) => p.key);
  const pending = (role: string) => changesFor(saved[role]!, draft[role]!, keys);
  const tick = (role: string, key: string, on: boolean) => {
    setDone('');
    const next = new Set(draft[role]);
    if (on) next.add(key); else next.delete(key);
    setDraft({ ...draft, [role]: next });
  };
  const save = (role: string) => {
    const changes = pending(role);
    setWarn(null);
    void action.run(async () => {
      let applied = 0;
      try {
        for (const c of changes) { await api.setRolePermission(role, c.permissionKey, c.granted); applied++; } // one change at a time: each is audited
      } catch (e) {
        if (applied > 0) await load(); // a refusal half way: show what is really saved
        throw e;
      }
      setDone(`Saved ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} for the ${roleLabel(role)} role.`);
      await load();
    });
  };
  const ask = (role: string) => {
    const losses = ownerLosses(role, pending(role));
    if (losses.length) setWarn({ role, losses });
    else save(role);
  };

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Roles and permissions</h1>
      <p className="text-sm text-slate-600">A tick means everyone with that role may do it. Save each role's column when you are done: nothing changes until you save.</p>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {action.error && <Notice>{action.error}</Notice>}
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
        <PermissionGrid grid={grid} draft={draft} saved={saved} onTick={tick}
          saveFor={(r) => <Button tone="primary" disabled={action.busy || pending(r).length === 0} onClick={() => ask(r)}>{pending(r).length ? `Save (${pending(r).length})` : 'Saved'}</Button>} />
      </div>
      {warn && (
        <Dialog title={`Take this away from the ${roleLabel(warn.role)} role?`} onClose={() => setWarn(null)}>
          <Notice tone="warning">
            The owner role needs {warn.losses.length === 1 ? 'this' : 'these'} to keep the shop running: <strong>{warn.losses.join(', ')}</strong>. It is what opens the Users and Roles and permissions
            screens. Without it nobody can add a staff login, change a role or put it back.
          </Notice>
          <div className="flex justify-end gap-2"><Button onClick={() => setWarn(null)}>Go back</Button><Button tone="danger" onClick={() => save(warn.role)}>Take it away anyway</Button></div>
        </Dialog>
      )}
      {action.dialog}
    </div>
  );
}

export function PermissionGrid({ grid, draft, saved, onTick, saveFor }: { saveFor?: (role: string) => ReactNode; grid: RoleGrid; draft: Record<string, Set<string>>; saved: Record<string, Set<string>>; onTick: (role: string, key: string, on: boolean) => void }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-white text-left text-slate-500">
        <tr><th className="p-2">What they may do</th>{grid.roles.map((r) => <th key={r} className="w-24 p-2 text-center">{roleLabel(r)}</th>)}</tr>
      </thead>
      {groupPermissions(grid.permissions).map((g) => (
        <tbody key={g.module}>
          <tr className="bg-slate-50"><th colSpan={grid.roles.length + 1} className="p-2 text-left font-semibold">{g.name}</th></tr>
          {g.permissions.map((p) => (
            <tr key={p.key} className="border-t border-slate-100">
              <td className="p-2">{p.label}</td>
              {grid.roles.map((r) => {
                const on = draft[r]?.has(p.key) ?? false;
                const changed = on !== (saved[r]?.has(p.key) ?? false);
                return (
                  <td key={r} className={`p-2 text-center ${changed ? 'bg-amber-50' : ''}`}>
                    <input type="checkbox" aria-label={`${roleLabel(r)}: ${p.label}`} checked={on} onChange={(e) => onTick(r, p.key, e.target.checked)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      ))}
      {saveFor && (
        <tfoot>
          <tr className="border-t border-slate-200"><td className="p-2 text-slate-500">Save a role's column</td>{grid.roles.map((r) => <td key={r} className="p-2 text-center">{saveFor(r)}</td>)}</tr>
        </tfoot>
      )}
    </table>
  );
}
