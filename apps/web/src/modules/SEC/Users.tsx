/**
 * Admin › Users (PLAN C6): every login with its roles, adding a user with a temporary password they must change at
 * first sign-in, changing roles, resetting a password, deactivating and activating. The owner's password is asked
 * again (step-up) wherever the server asks for it; every refusal shows the server's own plain message.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ROLES } from '@moonproject/shared';
import { api, type Me, type UserRow } from '../../api.ts';
import { Loading, Button, Dialog, Field, Notice, inputClass } from '../../components/ui.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { ROLE_HINTS, canDeactivate, newUserInput, rolesInput, rolesWords, roleLabel, sortRoles } from './users.ts';

type Dialogs = { kind: 'add' } | { kind: 'roles' | 'password' | 'active'; user: UserRow };

export function Users({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserRow[]>();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [open, setOpen] = useState<Dialogs | null>(null);
  const load = () => api.users().then(setUsers, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (!me.permissions.includes('sec.users.manage')) return <Notice>You do not have permission to manage users.</Notice>;
  const finished = (message: string) => { setOpen(null); setDone(message); void load(); };
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Users</h1>
        <span className="flex-1" />
        <Button tone="primary" onClick={() => { setDone(''); setOpen({ kind: 'add' }); }}>Add a user</Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {!users && !error && <Loading />}
      {users && <UserTable users={users} meId={me.userId} onOpen={(kind, user) => { setDone(''); setOpen({ kind, user }); }} />}
      <p className="text-sm text-slate-500">Changes here ask for your password again. A deactivated user is signed out at once and keeps their history: nothing is ever deleted.</p>
      {open?.kind === 'add' && <AddUser onClose={() => setOpen(null)} onDone={(name) => finished(`Added ${name}. Give them the temporary password: they must change it the first time they sign in.`)} />}
      {open?.kind === 'roles' && <ChangeRoles user={open.user} onClose={() => setOpen(null)} onDone={() => finished(`Saved the roles of ${open.user.displayName}.`)} />}
      {open?.kind === 'password' && <ResetPassword user={open.user} onClose={() => setOpen(null)} onDone={() => finished(`Reset the password of ${open.user.displayName}. They are signed out and must choose a new one at their next sign-in.`)} />}
      {open?.kind === 'active' && <ToggleActive user={open.user} onClose={() => setOpen(null)} onDone={() => finished(open.user.isActive ? `Deactivated ${open.user.displayName}.` : `Activated ${open.user.displayName}.`)} />}
    </div>
  );
}

export function UserTable({ users, meId, onOpen }: { users: UserRow[]; meId: string; onOpen: (kind: 'roles' | 'password' | 'active', user: UserRow) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="p-2">Name</th><th className="p-2">Username</th><th className="p-2">Roles</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={`border-t border-slate-100 align-top ${u.isActive ? '' : 'text-slate-500'}`}>
              <td className="p-2 font-medium">{u.displayName}{u.id === meId && <span className="ml-1 font-normal text-slate-500">(you)</span>}</td>
              <td className="p-2">{u.username}</td>
              <td className="p-2">{rolesWords(u.roles)}</td>
              <td className="p-2">
                {u.isActive ? 'Active' : 'Deactivated'}
                {u.mustChangePassword && <span className="block text-xs text-amber-700">Must choose a new password at next sign-in</span>}
              </td>
              <td className="space-x-2 whitespace-nowrap p-2 text-right">
                <Button onClick={() => onOpen('roles', u)}>Change roles</Button>
                <Button onClick={() => onOpen('password', u)}>Reset password</Button>
                {canDeactivate(meId, u.id) && <Button onClick={() => onOpen('active', u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleBoxes({ value, onChange }: { value: string[]; onChange: (roles: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Roles</legend>
      {sortRoles([...ROLES]).map((r) => (
        <label key={r} className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          <span><span className="font-medium">{roleLabel(r)}</span> <span className="text-slate-500">{ROLE_HINTS[r]}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

function PasswordBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} required hint="At least 15 characters, for example three or four words, not containing the username. They must change it at first sign-in.">
      <div className="flex gap-2">
        <input type={shown ? 'text' : 'password'} autoComplete="new-password" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
        <Button onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</Button>
      </div>
    </Field>
  );
}

function Actions({ onClose, busy, label, tone = 'primary', disabled }: { onClose: () => void; busy: boolean; label: string; tone?: 'primary' | 'danger'; disabled?: boolean }) {
  return <div className="flex justify-end gap-2"><Button onClick={onClose}>Go back</Button><Button type="submit" tone={tone} disabled={busy || disabled}>{label}</Button></div>;
}

function Form({ title, onClose, onSubmit, children, errors, action, label, tone, disabled }: {
  title: string; onClose: () => void; onSubmit: () => void; children: ReactNode; errors?: string[]; action: ReturnType<typeof useStepUpAction>; label: string; tone?: 'primary' | 'danger'; disabled?: boolean;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        {children}
        {errors && errors.length > 0 && <Notice><ul className="list-disc pl-5">{errors.map((m) => <li key={m}>{m}</li>)}</ul></Notice>}
        {action.error && <Notice>{action.error}</Notice>}
        <Actions onClose={onClose} busy={action.busy} label={label} tone={tone} disabled={disabled} />
      </form>
      {action.dialog}
    </Dialog>
  );
}

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [v, setV] = useState({ username: '', displayName: '', roles: [] as string[], temporaryPassword: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const action = useStepUpAction('adding the user');
  const submit = () => {
    const checked = newUserInput(v);
    setErrors(checked.errors);
    if (checked.body) { const body = checked.body; void action.run(async () => { await api.addUser(body); onDone(body.displayName); }); }
  };
  return (
    <Form title="Add a user" onClose={onClose} onSubmit={submit} errors={errors} action={action} label="Add user">
      <Field label="Name to show" required><input autoFocus className={inputClass} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></Field>
      <Field label="Username" required hint={v.username.trim() ? `They sign in by typing: ${v.username.trim()}` : 'One word they type to sign in, in small letters, like juan or maria.s'}>
        <input autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={inputClass} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></Field>
      <RoleBoxes value={v.roles} onChange={(roles) => setV({ ...v, roles })} />
      <PasswordBox label="Temporary password" value={v.temporaryPassword} onChange={(temporaryPassword) => setV({ ...v, temporaryPassword })} />
    </Form>
  );
}

function ChangeRoles({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState(user.roles);
  const action = useStepUpAction('changing the roles');
  const none = roles.length === 0;
  return (
    <Form title={`Roles of ${user.displayName}`} onClose={onClose} action={action} label="Save roles" disabled={none}
      onSubmit={() => void action.run(async () => { await api.setUserRoles(user.id, rolesInput(roles)); onDone(); })}>
      <RoleBoxes value={roles} onChange={setRoles} />
      {none && <p className="text-sm text-red-700">Give the user at least one role.</p>}
    </Form>
  );
}

function ResetPassword({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const action = useStepUpAction('resetting the password');
  return (
    <Form title={`Reset the password of ${user.displayName}`} onClose={onClose} action={action} label="Reset password" disabled={!password}
      onSubmit={() => void action.run(async () => { await api.resetUserPassword(user.id, password); onDone(); })}>
      <p className="text-sm text-slate-700">They are signed out everywhere and must choose a new password the next time they sign in.</p>
      <PasswordBox label="New temporary password" value={password} onChange={setPassword} />
    </Form>
  );
}

function ToggleActive({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const action = useStepUpAction(user.isActive ? 'deactivating the user' : 'activating the user');
  return (
    <Form title={`${user.isActive ? 'Deactivate' : 'Activate'} ${user.displayName}?`} onClose={onClose} action={action} label={user.isActive ? 'Deactivate' : 'Activate'} tone={user.isActive ? 'danger' : 'primary'}
      onSubmit={() => void action.run(async () => { await api.setUserActive(user.id, !user.isActive); onDone(); })}>
      <p className="text-sm text-slate-700">
        {user.isActive ? 'They are signed out at once and cannot sign in until you activate them again. Their history stays.' : 'They can sign in again with their current password.'}
      </p>
    </Form>
  );
}
