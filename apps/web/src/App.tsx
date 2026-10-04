/**
 * Start-up: first owner if nobody exists yet, else sign in, forced password change, then the shell.
 * Everything shown comes from the server on each load; nothing is kept in browser storage (NR-11).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type DocTypeInfo, type Me } from './api.ts';
import { Link, LinkAccess, match, navigate, useLocation } from './router.tsx';
import { Notice } from './components/ui.tsx';
import { ChangePasswordScreen, FirstOwnerScreen, LoginScreen } from './auth/AuthScreens.tsx';
import { Shell } from './shell/Shell.tsx';
import { docPath, labelOf, pagePermission } from './shell/menu.ts';
import { DocList, type ListForm, type ListView } from './generic/DocList.tsx';
import { JobOrderForm } from './modules/JO/JobOrderForm.tsx';
import { DocForm, type FormMode } from './generic/DocForm.tsx';
import { DocView } from './generic/DocView.tsx';
import { FORMS, PAGES, VIEWS } from './modules/screens.ts';
import { JOB_ORDER_LATER } from './modules/QUO/quotation.ts';
import { DashHome } from './modules/DASH/Home.tsx';
import { PracticeBanner } from './modules/PLT/PracticeBanner.tsx';
import { HealthDot } from './modules/PLT/HealthDot.tsx';
import { RestoredNotice } from './modules/BAK/RestoredNotice.tsx';
import { Site, isSitePath } from './shop/Site.tsx';
import { Toaster } from './components/Toasts.tsx';

type Stage = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'firstOwner' } | { kind: 'login'; message?: string } | { kind: 'ready'; me: Me; docTypes: DocTypeInfo[] };

/** The practice banner sits above everything, the sign-in page included (PLAN C8). */
export function App() {
  return (
    <>
      <PracticeBanner />
      <Stages />
      <Toaster />
    </>
  );
}

function Stages() {
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
  // Signed out, the home page, services and support make up the public website; any other address (a staff bookmark, an expired session) asks to sign in.
  if (stage.kind === 'login') return isSitePath(location.split('?')[0]!)
    ? <Site />
    : <LoginScreen message={stage.message} onSignedIn={(me) => { if (location.startsWith('/sign-in')) navigate('/'); return signedIn(me); }} />;
  if (stage.me.mustChangePassword) return <ChangePasswordScreen forced onDone={signedIn} />;
  if (isSitePath(location.split('?')[0]!, true)) return <Site staff />;

  const signOut = () => void api.logout().catch(() => undefined).then(() => {
    navigate('/sign-in');
    setStage({ kind: 'login', message: 'You are signed out.' });
  });
  const [path = '/', query = ''] = location.split('?');
  const fromQuotation = new URLSearchParams(query).get('from-quotation');
  const viewParam = new URLSearchParams(query).get('view');
  const typeOf = (key = '') => stage.docTypes.find((d) => d.key === key);
  const routes: [string, (p: Record<string, string>, t: DocTypeInfo) => ReactNode][] = [
    ['/docs/:type', (_, t) => <DocList key={t.key} type={t} notice={fromQuotation && t.key === 'jo.job_order' ? JOB_ORDER_LATER(fromQuotation) : undefined}
      // Job orders: 20 a page, and New opens over the list (its own address, /docs/jo.job_order/new, still opens the full page).
      {...(t.key === 'jo.job_order' ? {
        pageSize: 20,
        form: ({ draftId, close, setDirty, show }: Parameters<ListForm>[0]) => <JobOrderForm type={t} me={stage.me} mode={{ kind: 'new', draftId }} inDialog={{ close, setDirty, show }} />,
        // A job order opens over the list too (?view=<id>); its own address, /docs/jo.job_order/<id>, is still the full page.
        view: ({ id, recorded, refresh }: Parameters<ListView>[0]) => <DocView key={id} type={t} id={id} recorded={recorded} parts={VIEWS[t.key]} inDialog={{ refresh }} />,
        viewing: viewParam ? { id: viewParam, recorded: new URLSearchParams(query).get('recorded') === '1' } : undefined,
      } : {})} />],
    ['/docs/:type/new', (_, t) => !t.canCreate ? NO_ACCESS : <Form key={location} type={t} me={stage.me} mode={{ kind: 'new', draftId: new URLSearchParams(query).get('draft') ?? undefined }} />],
    ['/docs/:type/:id/edit', (p, t) => !(t.canPost && t.canCancel) ? NO_ACCESS : <Form key={location} type={t} me={stage.me} mode={{ kind: 'edit', id: p.id! }} />],
    ['/docs/:type/:id', (p, t) => <DocView key={p.id} type={t} id={p.id!} recorded={query === 'recorded=1'} parts={VIEWS[t.key]} />],
  ];
  let page: ReactNode = <Notice>Page not found. <Link to="/" className="underline">Go home</Link></Notice>;
  if (path === '/') page = <Home me={stage.me} docTypes={stage.docTypes} />;
  else if (path === '/account/password') page = <ChangePasswordScreen forced={false} onDone={(me) => signedIn(me).then(() => navigate('/'))} />;
  else {
    for (const [pattern, Page] of Object.entries(PAGES)) {
      const params = match(pattern, path);
      if (params) {
        // A page the user's role does not open shows that plainly, instead of a screen whose every call is refused.
        const needs = pagePermission(path);
        page = needs && !stage.me.permissions.includes(needs) ? NO_ACCESS : <Page key={path} me={stage.me} docTypes={stage.docTypes} params={params} />;
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
  return (
    <LinkAccess.Provider value={(to) => mayOpen(to, stage.me, stage.docTypes)}>
      <Shell me={stage.me} docTypes={stage.docTypes} onSignOut={signOut}><RestoredNotice me={stage.me} />{page}</Shell>
    </LinkAccess.Provider>
  );
}

/** Whether this user may open an address: a document page by its type's rights, any other page by its menu permission. */
function mayOpen(to: string, me: Me, docTypes: DocTypeInfo[]): boolean {
  const path = to.split(/[?#]/)[0]!;
  const doc = /^\/docs\/([^/]+)(\/.*)?$/.exec(path);
  if (doc) {
    const t = docTypes.find((d) => d.key === doc[1]);
    if (!t) return false; // not a type this user may see
    if (doc[2] === '/new') return t.canCreate;
    if (doc[2]?.endsWith('/edit')) return t.canPost && t.canCancel;
    return true;
  }
  const needs = pagePermission(path);
  return !needs || me.permissions.includes(needs);
}

/** What a page shows to someone whose role does not include it. */
const NO_ACCESS = <Notice>You do not have access to this page. Ask the owner if your work needs it. <Link to="/" className="underline">Go home</Link></Notice>;

/** A module's own form when it has one (FORMS), else the generic form. */
function Form({ type, mode, me }: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  const Custom = FORMS[type.key];
  return Custom ? <Custom type={type} mode={mode} me={me} /> : <DocForm type={type} mode={mode} />;
}

function Home({ me, docTypes }: { me: Me; docTypes: DocTypeInfo[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Hello, {me.displayName}</h1>
        {me.permissions.includes('sec.health.view') && <HealthDot />}
      </div>
      {me.permissions.includes('dash.view') && <DashHome />}
      <div className="flex flex-wrap gap-2">
        {docTypes.filter((d) => d.canCreate).map((d) => (
          <Link key={d.key} to={docPath(d.key, '/new')} className="rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-50">+ New {labelOf(d)}</Link>
        ))}
      </div>
      {docTypes.length === 0 && <p className="text-slate-600">Your role has no screens yet. Ask an owner.</p>}
    </div>
  );
}
