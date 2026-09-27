/**
 * Start-up: first owner if nobody exists yet, else sign in, forced password change, then the shell.
 * Everything shown comes from the server on each load; nothing is kept in browser storage (NR-11).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type DocTypeInfo, type Me } from './api.ts';
import { Link, match, navigate, useLocation } from './router.tsx';
import { Notice } from './components/ui.tsx';
import { ChangePasswordScreen, FirstOwnerScreen, LoginScreen } from './auth/AuthScreens.tsx';
import { Shell } from './shell/Shell.tsx';
import { docPath, labelOf } from './shell/menu.ts';
import { DocList } from './generic/DocList.tsx';
import { DocForm, type FormMode } from './generic/DocForm.tsx';
import { DocView } from './generic/DocView.tsx';
import { FORMS, PAGES, VIEWS } from './modules/screens.ts';

type Stage = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'firstOwner' } | { kind: 'login'; message?: string } | { kind: 'ready'; me: Me; docTypes: DocTypeInfo[] };

export function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const location = useLocation();
  const signedIn = useCallback(async (me: Me) => setStage({ kind: 'ready', me, docTypes: me.mustChangePassword ? [] : await api.docTypes() }), []);

  useEffect(() => {
    api.onSignedOut((e) =>
      setStage((s) => (e.code === 'PASSWORD_CHANGE_REQUIRED' && s.kind === 'ready' ? { ...s, me: { ...s.me, mustChangePassword: true } } : { kind: 'login', message: e.message })),
    );
    (async () => ((await api.setupStatus()).needsFirstOwner ? setStage({ kind: 'firstOwner' }) : await signedIn(await api.me())))().catch((e: ApiError) =>
      setStage(e.status === 401 ? { kind: 'login' } : { kind: 'error', message: e.message }),
    );
  }, [signedIn]);

  if (stage.kind === 'loading') return <p className="p-6 text-slate-500">Loading…</p>;
  if (stage.kind === 'error') return <div className="p-6"><Notice>{stage.message}</Notice></div>;
  if (stage.kind === 'firstOwner') return <FirstOwnerScreen onSignedIn={signedIn} />;
  if (stage.kind === 'login') return <LoginScreen message={stage.message} onSignedIn={signedIn} />;
  if (stage.me.mustChangePassword) return <ChangePasswordScreen forced onDone={signedIn} />;

  const signOut = () => void api.logout().catch(() => undefined).then(() => setStage({ kind: 'login', message: 'You are signed out.' }));
  const [path = '/', query = ''] = location.split('?');
  const typeOf = (key = '') => stage.docTypes.find((d) => d.key === key);
  const routes: [string, (p: Record<string, string>, t: DocTypeInfo) => ReactNode][] = [
    ['/docs/:type', (_, t) => <DocList key={t.key} type={t} />],
    ['/docs/:type/new', (_, t) => <Form key={location} type={t} mode={{ kind: 'new', draftId: new URLSearchParams(query).get('draft') ?? undefined }} />],
    ['/docs/:type/:id/edit', (p, t) => <Form key={location} type={t} mode={{ kind: 'edit', id: p.id! }} />],
    ['/docs/:type/:id', (p, t) => <DocView key={p.id} type={t} id={p.id!} recorded={query === 'recorded=1'} parts={VIEWS[t.key]} />],
  ];
  let page: ReactNode = <Notice>Page not found. <Link to="/" className="underline">Go home</Link></Notice>;
  if (path === '/') page = <Home me={stage.me} docTypes={stage.docTypes} />;
  else if (path === '/account/password') page = <ChangePasswordScreen forced={false} onDone={(me) => signedIn(me).then(() => navigate('/'))} />;
  else {
    for (const [pattern, Page] of Object.entries(PAGES)) {
      const params = match(pattern, path);
      if (params) {
        page = <Page key={path} me={stage.me} docTypes={stage.docTypes} params={params} />;
        break;
      }
    }
  }
  for (const [pattern, render] of routes) {
    const m = match(pattern, path);
    const t = typeOf(m?.type);
    if (m && t) {
      page = render(m, t); // first match wins, so /new is never read as an id
      break;
    }
  }
  return <Shell me={stage.me} docTypes={stage.docTypes} onSignOut={signOut}>{page}</Shell>;
}

/** A module's own form when it has one (FORMS), else the generic form. */
function Form({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const Custom = FORMS[type.key];
  return Custom ? <Custom type={type} mode={mode} /> : <DocForm type={type} mode={mode} />;
}

function Home({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Hello, {me.displayName}</h1>
      <div className="flex flex-wrap gap-2">
        {docTypes.filter((d) => d.canCreate).map((d) => (
          <Link key={d.key} to={docPath(d.key, '/new')} className="rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-50">+ New {labelOf(d)}</Link>
        ))}
      </div>
      {docTypes.length === 0 && <p className="text-slate-600">Your role has no screens yet. Ask an owner.</p>}
    </div>
  );
}
