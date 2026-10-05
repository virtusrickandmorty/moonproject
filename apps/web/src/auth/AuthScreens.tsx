/** Sign in, first owner and change password (PLAN C6, E13). Passphrases of 15+ characters (OWN-14). */
import { useEffect, useState } from 'react';
import { api, type Me } from '../api.ts';
import { Button, Field, Notice, inputClass, useAction } from '../components/ui.tsx';
import { PrivacyNotice } from './PrivacyNotice.tsx';

type Box = [name: string, label: string, type: 'text' | 'password', autoComplete: string, hint?: string];
const HINT = 'At least 15 characters, for example three or four words.';

/** `page`: a whole page of its own before sign-in (logo, centred, privacy notice); otherwise a card inside the shell. */
function AuthForm(p: { title: string; intro?: string; boxes: Box[]; submitLabel: string; page?: boolean; onSubmit: (v: Record<string, string>) => Promise<unknown> }) {
  const [v, setV] = useState<Record<string, string>>({});
  const a = useAction();
  const form = (
    <form onSubmit={(e) => (e.preventDefault(), void a.run(() => p.onSubmit(v)))} className={`w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow ring-1 ring-slate-200 ${p.page ? '' : 'mx-auto mt-16'}`}>
      <h1 className={`text-xl font-semibold ${p.page ? 'text-center' : ''}`}>{p.title}</h1>
      {p.intro && <p className={`text-sm text-slate-600 ${p.page ? 'text-center' : ''}`}>{p.intro}</p>}
      {p.boxes.map(([name, label, type, autoComplete, hint], i) => (
        <Field key={name} label={label} hint={hint}>
          <input autoFocus={i === 0} type={type} autoComplete={autoComplete} {...(name === 'username' ? { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } : {})} className={inputClass} value={v[name] ?? ''} onChange={(e) => setV({ ...v, [name]: e.target.value })} />
        </Field>
      ))}
      {a.error && <Notice>{a.error}</Notice>}
      <Button type="submit" tone="primary" className="w-full" disabled={a.busy}>{p.submitLabel}</Button>
    </form>
  );
  if (!p.page) return form;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <img src="/virtus-logo.png" alt="Virtus" className="mb-8 h-28 w-auto" />
      {form}
      <PrivacyNotice />
      <p className="mt-6 text-center text-xs tracking-wide text-slate-400">VIRTUS GARMENTS, INC.</p>
    </main>
  );
}

function same(a = '', b = '') {
  if (a !== b) throw new Error('The two passphrases are not the same.');
}

export function LoginScreen({ message, onSignedIn }: { message?: string; onSignedIn: (me: Me) => Promise<void> }) {
  const boxes: Box[] = [['username', 'Username', 'text', 'username'], ['password', 'Password', 'password', 'current-password']];
  // Staff only: the tab says so, and search engines leave the page out.
  useEffect(() => {
    document.title = 'Sign in · Virtus';
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    robots.content = 'noindex, nofollow';
  }, []);
  return <AuthForm page title="Sign in" intro={message} boxes={boxes} submitLabel="Sign in" onSubmit={async (v) => (await api.login(v.username ?? '', v.password ?? ''), onSignedIn(await api.me()))} />;
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
  const intro = 'Nobody has set up Virtus yet. The first person becomes an Owner and adds everyone else.';
  return <AuthForm page title="Create the first owner" intro={intro} boxes={boxes} submitLabel="Create owner and sign in" onSubmit={submit} />;
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
  return <AuthForm page={forced} title="Change password" intro={intro} boxes={boxes} submitLabel="Save new passphrase" onSubmit={submit} />;
}
