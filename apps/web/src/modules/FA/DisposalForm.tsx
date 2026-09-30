/**
 * Asset disposal form (PLAN D5 FA-DISP, E10), opened from "+ New": pick the asset from the register (no id to type; the asset
 * screen's own "Dispose of this asset" opens it with the asset picked, ?asset=<id>), say why, and record the retirement. A sale
 * cannot be recorded yet (it needs an invoice record), so the kind is fixed. Also the Edit of a recorded disposal (cancel + reissue, NR-4).
 */
import { useEffect, useState } from 'react';
import { api, type AssetRow, type DocTypeInfo } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass } from '../../components/ui.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { useRecord } from '../../generic/record.tsx';
import { Errors, useLive } from '../COL/parts.tsx';
import { canDispose, disposalInput } from './register.ts';

export function DisposalForm({ type, mode }: { type: DocTypeInfo; mode: FormMode }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetId, setAssetId] = useState(new URLSearchParams(location.search).get('asset') ?? '');
  const [reason, setReason] = useState('');
  const r = useRecord(type, mode, (d) => (setAssetId(String(d.input.assetId ?? '')), setReason(String(d.input.reason ?? ''))));
  useEffect(() => void api.assets().then(setAssets, r.fail), []);

  const { input, errors: typed } = disposalInput(assetId, reason);
  const errors = [...(assetId ? [] : ['Pick the asset.']), ...typed];
  const live = useLive(JSON.stringify(input), errors.length === 0, () => r.preview(input));
  // The asset being edited is already off the books, so it is listed too.
  const choices = assets.filter((a) => canDispose(a) || a.id === assetId);

  if (r.gate) return r.gate;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{r.title('Take an asset off the books')}</h1>
        {r.top}
        <Panel title="Which asset, and why?">
          <p className="text-sm text-slate-700">Only a retirement (nothing received for it) can be recorded now. Run the month’s depreciation first: the book value left is charged as a loss.</p>
          <Field label="Asset" required>
            <select className={inputClass} value={assetId} disabled={!!r.original} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">{assets.length ? 'Pick the asset' : 'Loading…'}</option>
              {choices.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.description}</option>)}
            </select>
          </Field>
          {assets.length > 0 && choices.length === 0 && <Notice tone="info">No asset is in service, so there is nothing to take off the books.</Notice>}
          <Field label="Why is it being taken off?" required>
            <textarea rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Panel>
        <Errors list={errors} show={r.touched} />
        <div className="flex gap-2">
          <Button tone="primary" disabled={!type.canPost} onClick={() => r.ask(input, errors)}>Record</Button>
          <Button onClick={() => history.back()}>Back</Button>
        </div>
      </div>
      <Panel title="So far">
        {live ? <p className="text-sm">{live.summary}</p> : <p className="text-sm text-slate-500">Pick the asset and say why to see what comes off the books.</p>}
        {live?.issues.map((i) => <Notice key={i.code + i.field} tone={i.level}>{i.message}</Notice>)}
      </Panel>
      {r.dialog}
    </form>
  );
}
