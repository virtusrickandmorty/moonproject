/**
 * Accounting & Tax › Settings (PLAN F1): every dated setting with the value in force today in plain words and its
 * history. Whoever has acc.settings.manage adds a new version from today or a later date: the new value, a reason,
 * a preview with the old value beside the new, then Save, which asks for the password again. A version is never
 * edited or removed: the next one replaces it from its date.
 */
import { useEffect, useState } from 'react';
import { api, type Me, type Setting } from '../../api.ts';
import { Button, Dialog, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import { useToday } from '../../generic/record.tsx';
import { Link } from '../../router.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { DEPOSIT_MODES, EWT_CLASS_NAMES, checkDraft, formOf, isEditable, ownScreensFor, titleOf, valueOn, wordsOf, type Checked, type Form } from './settings.ts';

export function Settings({ me }: { me: Me }) {
  const [settings, setSettings] = useState<Setting[]>();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [changing, setChanging] = useState<Setting | null>(null);
  const today = useToday();
  const load = () => api.settings().then(setSettings, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  const mayChange = me.permissions.includes('acc.settings.manage');
  const own = ownScreensFor(me.permissions);
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-slate-600">
        Each setting has the value in force today and its history. A change never rewrites the past: it starts from the date you choose, today or later, so what is already recorded keeps the setting it used.
      </p>
      {error && <Notice>{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {!settings && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {settings && <SettingList settings={settings} today={today} mayChange={mayChange && !!today} onChange={(s) => { setDone(''); setChanging(s); }} />}
      {own.length > 0 && (
        <Panel title="Settings on their own screen">
          <ul className="space-y-1 text-sm">
            {own.map((s) => <li key={s.path}><Link to={s.path} className="font-medium text-indigo-700 hover:underline">{s.label}</Link> <span className="text-slate-600">{s.text}</span></li>)}
          </ul>
        </Panel>
      )}
      {changing && <NewVersion setting={changing} today={today} onClose={() => setChanging(null)} onSaved={(w) => { setChanging(null); setDone(w); void load(); }} />}
    </div>
  );
}

export function SettingList({ settings, today, mayChange, onChange }: { settings: Setting[]; today: string; mayChange: boolean; onChange?: (s: Setting) => void }) {
  return (
    <div className="space-y-4">
      {settings.map((s) => (
        <Panel key={s.key} title={titleOf(s)}>
          <p className="text-xs text-slate-500">{s.label}</p>
          <p className="text-sm">In force today: <strong>{wordsOf(s.key, s.current)}</strong></p>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">From</th><th className="pr-3">Value</th><th>Reason</th></tr></thead>
            <tbody>
              {s.versions.map((v) => (
                <tr key={v.id} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap py-1 pr-3">{v.effectiveFrom}{today && v.effectiveFrom > today && <span className="ml-1 rounded bg-sky-100 px-1.5 text-xs text-sky-800">starts later</span>}</td>
                  <td className="py-1 pr-3">{wordsOf(s.key, v.value)}</td>
                  <td className="py-1">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mayChange && isEditable(s.key) && <Button onClick={() => onChange?.(s)}>New version from a date</Button>}
        </Panel>
      ))}
    </div>
  );
}

function pct(form: Form, set: (k: string, v: string) => void, key: string, label: string) {
  return <Field key={key} label={label} required><input inputMode="decimal" className={`${inputClass} text-right`} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} /></Field>;
}

/** The inputs of one setting's value. */
export function ValueFields({ settingKey, form, set }: { settingKey: string; form: Form; set: (k: string, v: string) => void }) {
  if (settingKey === 'sales.deposit_vat_mode') {
    return <Field label="Downpayment VAT" required><select className={inputClass} value={form.choice ?? ''} onChange={(e) => set('choice', e.target.value)}>{Object.entries(DEPOSIT_MODES).map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></Field>;
  }
  if (settingKey === 'tax.top_withholding_agent' || settingKey === 'col.forfeit_vatable') {
    return <Field label="Value" required><select className={inputClass} value={form.yes ?? 'no'} onChange={(e) => set('yes', e.target.value)}><option value="yes">Yes</option><option value="no">No</option></select></Field>;
  }
  if (settingKey === 'col.cr_mode') {
    return (
      <div className="space-y-3">
        <Field label="Collection receipts" required>
          <select className={inputClass} value={form.mode ?? 'booklet'} onChange={(e) => set('mode', e.target.value)}>
            <option value="booklet">Typed from the ATP booklet</option>
            <option value="system">Numbered and printed by the system</option>
          </select>
        </Field>
        {form.mode === 'system' && (
          <>
            <Field label="Accountant who signed off" required><input className={inputClass} value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Date of the sign-off" required><input type="date" className={inputClass} value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="Basis of the sign-off" required hint="At least 10 characters."><textarea rows={2} className={inputClass} value={form.basis ?? ''} onChange={(e) => set('basis', e.target.value)} /></Field>
          </>
        )}
      </div>
    );
  }
  if (settingKey === 'tax.ewt_rates_bp') {
    return <div className="grid gap-3 sm:grid-cols-2">{Object.entries(EWT_CLASS_NAMES).map(([k, label]) => pct(form, set, k, `${label} %`))}</div>;
  }
  return pct(form, set, 'percent', 'New rate %');
}

/** The old value beside the new, for the version being saved. */
export function ChangePreview({ checked, from }: { checked: Checked; from: string }) {
  const p = checked.preview;
  if (!p) return null;
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="pr-3">What changes</th><th className="pr-3">Now (on {from})</th><th>New</th></tr></thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.label} className={`border-t border-slate-100 ${r.changed ? 'font-medium' : 'text-slate-500'}`}>
              <td className="py-1 pr-3">{r.label}</td><td className="py-1 pr-3">{r.before}</td><td className="py-1">{r.changed ? r.after : 'no change'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.unchanged && <Notice>The setting already has this value on that date, so there is nothing to save.</Notice>}
      {p.later.length > 0 && <Notice tone="warning">Another version already starts on {p.later[0]!.effectiveFrom} ({wordsOfLater(p.later[0]!)}) and replaces this one from that date.</Notice>}
    </div>
  );
}
const wordsOfLater = (v: { key: string; value: unknown }) => wordsOf(v.key, v.value);

function NewVersion({ setting, today, onClose, onSaved }: { setting: Setting; today: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<Form>(() => formOf(setting.key, setting.current));
  const [effectiveFrom, setFrom] = useState(today);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const action = useStepUpAction('changing the setting');
  const title = titleOf(setting);
  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setChecked(null); };
  const review = () => setChecked(checkDraft(setting, { effectiveFrom, form, reason }, today));
  const save = () => {
    if (!checked?.body) return;
    const body = checked.body;
    void action.run(async () => { await api.addSetting(setting.key, body); onSaved(`Saved a new version of ${title} from ${body.effectiveFrom}.`); });
  };
  const ready = checked?.body && !checked.preview?.unchanged;
  return (
    <Dialog title={`New version: ${title}`} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) save(); else review(); }}>
        <p className="text-sm text-slate-600">In force on {effectiveFrom || 'that date'}: <strong>{wordsOf(setting.key, valueOn(setting.versions, effectiveFrom || today) ?? setting.current)}</strong></p>
        <Field label="New version from" required hint="Today or a later date."><input type="date" min={today} className={inputClass} value={effectiveFrom} onChange={(e) => { setFrom(e.target.value); setChecked(null); }} /></Field>
        <ValueFields settingKey={setting.key} form={form} set={set} />
        <Field label="Reason" required hint="At least 10 characters. It is kept with the version."><textarea rows={2} className={inputClass} value={reason} onChange={(e) => { setReason(e.target.value); setChecked(null); }} /></Field>
        {checked && checked.errors.length > 0 && <Notice><ul className="list-disc pl-5">{checked.errors.map((m) => <li key={m}>{m}</li>)}</ul></Notice>}
        {checked && <ChangePreview checked={checked} from={effectiveFrom} />}
        {action.error && <Notice>{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Go back</Button>
          {ready ? <Button type="submit" tone="primary" disabled={action.busy}>Save this version</Button> : <Button type="submit" tone="primary">Preview the change</Button>}
        </div>
      </form>
      {action.dialog}
    </Dialog>
  );
}
