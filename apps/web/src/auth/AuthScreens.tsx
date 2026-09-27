/** Sign in, first owner and change password (PLAN C6, E13). Passphrases of 15+ characters (OWN-14). */
import { useState } from 'react';
import { api, type Me } from '../api.ts';
import { Button, Field, Notice, inputClass, useAction } from '../components/ui.tsx';

type Box = [name: string, label: string, type: 'text' | 'password', autoComplete: string, hint?: string];
const HINT = 'At least 15 characters, for example three or four words.';

function AuthForm(p: { title: string; intro?: string; boxes: Box[]; submitLabel: string; onSubmit: (v: Record<string, string>) => Promise<unknown> }) {
  const [v, setV] = useState<Record<string, string>>({});
  const a = useAction();
  return (
    <form onSubmit={(e) => (e.preventDefault(), void a.run(() => p.onSubmit(v)))} className="mx-auto mt-16 max-w-sm space-y-4 rounded-lg bg-white p-6 shadow ring-1 ring-slate-200">
      <p className="text-sm font-semibold tracking-wide text-indigo-700">MOONPROJECT</p>
      <h1 className="text-xl font-semibold">{p.title}</h1>
      {p.intro && <p className="text-sm text-slate-600">{p.intro}</p>}
      {p.boxes.map(([name, label, type, autoComplete, hint], i) => (
        <Field key={name} label={label} hint={hint}>
          <input autoFocus={i === 0} type={type} autoComplete={autoComplete} className={inputClass} value={v[name] ?? ''} onChange={(e) => setV({ ...v, [name]: e.target.value })} />
        </Field>
      ))}
      {a.error && <Notice>{a.error}</Notice>}
      <Button type="submit" tone="primary" className="w-full" disabled={a.busy}>{p.submitLabel}</Button>
    </form>
  );
}

function same(a = '', b = '') {
  if (a !== b) throw new Error('The two passphrases are not the same.');
}

export function LoginScreen({ message, onSignedIn }: { message?: string; onSignedIn: (me: Me) => Promise<void> }) {
  const boxes: Box[] = [['username', 'Username', 'text', 'username'], ['password', 'Password', 'password', 'current-password']];
  return <AuthForm title="Sign in" intro={message} boxes={boxes} submitLabel="Sign in" onSubmit={async (v) => (await api.login(v.username ?? '', v.password ?? ''), onSignedIn(await api.me()))} />;
}

export function FirstOwnerScreen({ onSignedIn }: { onSignedIn: (me: Me) => Promise<void> }) {
  const boxes: Box[] = [
    ['displayName', 'Your name', 'text', 'name'],
    ['username', 'Username', 'text', 'username'],
    ['password', 'Passphrase', 'password', 'new-password', HINT],
    ['repeat', 'Type the passphrase again', 'password', 'new-password'],
  ];
  const submit = async ({ displayName = '', username = '', password = '', repeat }: Record<string, string>) => {
    same(password, repeat);
    await api.firstOwner({ displayName, username, password });
    await onSignedIn(await api.me());
  };
  const intro = 'Nobody has set up Moonproject yet. The first person becomes an Owner and adds everyone else.';
  return <AuthForm title="Create the first owner" intro={intro} boxes={boxes} submitLabel="Create owner and sign in" onSubmit={submit} />;
}

export function ChangePasswordScreen({ forced, onDone }: { forced: boolean; onDone: (me: Me) => Promise<void> }) {
  const boxes: Box[] = [
    ['current', forced ? 'Temporary password' : 'Current password', 'password', 'current-password'],
    ['next', 'New passphrase', 'password', 'new-password', HINT],
    ['repeat', 'Type the new passphrase again', 'password', 'new-password'],
  ];
  const submit = async ({ current = '', next = '', repeat }: Record<string, string>) => {
    same(next, repeat);
    await api.changePassword(current, next);
    await onDone(await api.me());
  };
  const intro = forced ? 'Please set your own passphrase before you continue.' : 'Your other devices will be signed out.';
  return <AuthForm title="Change password" intro={intro} boxes={boxes} submitLabel="Save new passphrase" onSubmit={submit} />;
}
