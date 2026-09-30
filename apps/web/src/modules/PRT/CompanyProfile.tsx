import { useEffect, useState } from 'react';
import { api, type CompanyProfile } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, useAction } from '../../components/ui.tsx';

const blank: CompanyProfile = { registeredName: '', tradeName: '', tin: '', registeredAddress: '', isVatRegistered: false, version: 0 };

export function CompanyProfileScreen() {
  const [profile, setProfile] = useState<CompanyProfile>(blank);
  const [history, setHistory] = useState<CompanyProfile[]>([]);
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const [paper, setPaper] = useState<'a4' | 'long'>('a4');
  const [paperSaved, setPaperSaved] = useState(false);
  const p = useAction();
  useEffect(() => { void api.looseLeafSettings().then((r) => setPaper(r.looseLeafPaper), () => undefined); }, []);
  const savePaper = () => p.run(async () => {
    await api.stepUp(password);
    setPaper((await api.saveLooseLeafPaper(paper)).looseLeafPaper);
    setPassword('');
    setPaperSaved(true);
  });
  useEffect(() => {
    Promise.all([api.companyProfile(), api.companyProfileHistory()])
      .then(([p, h]) => { setProfile(p); setHistory(h); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);
  const change = (key: keyof CompanyProfile, value: string | boolean) => setProfile((p) => ({ ...p, [key]: value }));
  const save = () => a.run(async () => {
    await api.stepUp(password);
    const next = await api.saveCompanyProfile({ registeredName: profile.registeredName, tradeName: profile.tradeName,
      tin: profile.tin, registeredAddress: profile.registeredAddress, isVatRegistered: profile.isVatRegistered }, profile.version);
    setProfile(next);
    setHistory(await api.companyProfileHistory());
    setPassword('');
    setSaved(true);
  });
  if (!loaded) return <p>Loading…</p>;
  return <div className="max-w-2xl space-y-4">
    <h1 className="text-2xl font-semibold">Company print details</h1>
    <p className="text-sm text-slate-600">These details appear on every printout. Check them against the company’s registration before saving.</p>
    <Panel title="Company profile">
      <div className="space-y-3">
        {([['registeredName', 'Registered name'], ['tradeName', 'Trade name'], ['tin', 'TIN'], ['registeredAddress', 'Registered address']] as const).map(([key, label]) =>
          <Field key={key} label={label} required><input className={inputClass} value={profile[key]} onChange={(e) => change(key, e.target.value)} /></Field>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.isVatRegistered} onChange={(e) => change('isVatRegistered', e.target.checked)} />VAT registered</label>
        <Field label="Your password to confirm this change" required><input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {a.error && <Notice>{a.error}</Notice>}
        {saved && <Notice tone="success">Company print details saved.</Notice>}
        <Button tone="primary" disabled={a.busy || !password || !profile.registeredName || !profile.tradeName || !profile.tin || !profile.registeredAddress} onClick={() => void save()}>Save details</Button>
      </div>
    </Panel>
    <Panel title="Loose-leaf books of accounts">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Paper for the loose-leaf print of the BIR books (Reports, BIR books, Print loose-leaf).</p>
        <Field label="Paper"><select className={inputClass} value={paper} onChange={(e) => { setPaper(e.target.value as 'a4' | 'long'); setPaperSaved(false); }}>
          <option value="a4">A4 portrait</option><option value="long">Long bond paper (8.5 × 13 in)</option></select></Field>
        <Field label="Your password to confirm this change" required><input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {p.error && <Notice>{p.error}</Notice>}
        {paperSaved && <Notice tone="success">Loose-leaf paper saved.</Notice>}
        <Button disabled={p.busy || !password} onClick={() => void savePaper()}>Save paper</Button>
      </div>
    </Panel>
    <Panel title="Earlier versions">
      {history.length === 0 ? <p className="text-sm text-slate-500">No earlier versions.</p> :
        <ul className="space-y-2 text-sm">{history.map((r) => <li key={r.version} className="border-b pb-2">
          Version {r.version} · replaced {r.supersededAt} · {r.registeredName} · TIN {r.tin} · {r.registeredAddress} · VAT registered: {r.isVatRegistered ? 'Yes' : 'No'}
        </li>)}</ul>}
    </Panel>
  </div>;
}
