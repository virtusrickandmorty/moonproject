/** After the review: the dry run and its checks, the commit (with the password again), and clearing the staged values. */
import { useState } from 'react';
import { api, type DryRunResult, type MigCommitResult, type PlannedChange } from '../../api.ts';
import { Button, Dialog, Notice, Panel, peso, useAction } from '../../components/ui.tsx';
import { useStepUpAction } from '../TAX/StepUp.tsx';
import { canCommit, cellSumWords, clearedWords, commitLines, commitRequest, dryRunAddsUp, dryRunChecks, dryRunLines, priceListWords, ratesGoingDown, reviewDone, type RowCounts } from './importer.ts';

function Lines({ lines }: { lines: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {lines.map(([label, value]) => <div key={label} className="contents"><dt className="text-slate-500">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
    </dl>
  );
}

function Changes({ title, rows }: { title: string; rows: PlannedChange[] }) {
  if (rows.length === 0) return null;
  const right = { textAlign: 'right' } as const;
  return <details className="rounded-md bg-slate-50 px-3 py-2 text-sm" open={rows.length <= 30}>
    <summary className="cursor-pointer font-medium text-indigo-700">{title} ({rows.length})</summary>
    <div className="mt-2 max-h-96 overflow-auto"><table className="w-full min-w-[560px] text-sm">
      <thead><tr><th className="text-left">Row</th><th className="text-left">Item</th><th className="text-left">What</th><th style={right}>Now</th><th style={right}>Sheet</th></tr></thead>
      <tbody>{rows.map((c) => <tr key={`${c.row}-${c.what}`} className="border-t border-slate-200">
        <td className="py-1 tabular-nums">{c.row}</td><td className="py-1">{c.item}</td><td className="py-1">{c.what}</td>
        <td className="py-1 text-right tabular-nums">{c.fromCents === null ? 'None yet' : peso(c.fromCents)}</td>
        <td className={`py-1 text-right tabular-nums ${c.fromCents !== null && c.toCents < c.fromCents ? 'font-semibold text-red-700' : ''}`}>{peso(c.toCents)}</td></tr>)}</tbody>
    </table></div>
  </details>;
}

/** What a price list upload will change, before anything is imported. */
export function PriceChanges({ dry }: { dry: DryRunResult }) {
  const p = dry.priceList;
  if (!p) return null;
  const down = ratesGoingDown(dry);
  return <div className="space-y-2">
    <h3 className="text-sm font-medium">What this price list will change</h3>
    <p className="text-sm text-slate-600">{priceListWords(dry)}. New rates and prices start today; nothing recorded changes.</p>
    {down.length > 0 && <Notice tone="warning">{down.length} {down.length === 1 ? 'rate goes' : 'rates go'} down. A sheet older than a change made on the screen takes that change back. To keep a rate, exclude its row in the review.</Notice>}
    {p.clashes.length > 0 && <Notice tone="warning">{p.clashes.length} {p.clashes.length === 1 ? 'thing is' : 'things are'} said twice in this sheet with different figures; the last row is used: {p.clashes.slice(0, 5).map((c) => `${c.item}, ${c.what} (rows ${c.rows.join(', ')})`).join('; ')}{p.clashes.length > 5 ? ` and ${p.clashes.length - 5} more` : ''}. If two Upper rows of a set are its Upper and Lower, correct the Part in the sheet.</Notice>}
    {p.zeroKept.length > 0 && <p className="text-sm text-slate-600">{p.zeroKept.length} {p.zeroKept.length === 1 ? 'rate of ₱0.00 in the sheet is' : 'rates of ₱0.00 in the sheet are'} ignored, so no step stops being paid.</p>}
    {p.newItems.length > 0 && <p className="text-sm text-slate-600">New items: {p.newItems.slice(0, 8).join(', ')}{p.newItems.length > 8 ? ` and ${p.newItems.length - 8} more` : ''}. Check that none is a misspelled name.</p>}
    <Changes title="Rates" rows={p.rates} />
    <Changes title="Prices" rows={p.prices} />
  </div>;
}

export function DryRun({ uploadId, counts, dry, onDry }: { uploadId: string; counts: RowCounts; dry: DryRunResult | null; onDry: (r: DryRunResult) => void }) {
  const run = useAction();
  const ready = reviewDone(counts);
  return (
    <Panel title="Check the import">
      <p className="text-sm text-slate-600">Counts what would go in and the totals to compare with the old sheet. Nothing is imported.</p>
      {!ready && <Notice tone="warning">{counts.needsReview} {counts.needsReview === 1 ? 'row still needs' : 'rows still need'} review. Accept, fix, merge or exclude each one first.</Notice>}
      <Button tone="primary" disabled={!ready || run.busy} onClick={() => void run.run(async () => onDry(await api.migDryRun(uploadId)))}>{run.busy ? 'Checking…' : dry ? 'Check the import again' : 'Check the import'}</Button>
      {run.error && <Notice>{run.error}</Notice>}
      {dry && (
        <div className="space-y-3">
          <Lines lines={dryRunLines(dry)} />
          {dryRunAddsUp(dry) ? <Notice tone="success">Every row of the file is counted once.</Notice> : <Notice>The counts do not add up. Do not import; tell the person who looks after Virtus.</Notice>}
          <h3 className="text-sm font-medium">Totals to check against the old sheet</h3>
          <Lines lines={dryRunChecks(dry)} />
          <PriceChanges dry={dry} />
        </div>
      )}
    </Panel>
  );
}

export function Commit({ uploadId, counts, dry, mayCommit, onCommitted }: { uploadId: string; counts: RowCounts; dry: DryRunResult | null; mayCommit: boolean; onCommitted: (r: MigCommitResult) => void }) {
  const [asking, setAsking] = useState(false);
  const action = useStepUpAction('importing these approved rows');
  if (!dry) return <Panel title="Import these approved rows"><p className="text-sm text-slate-500">Check the import first. You can import the approved rows after that, and only while nothing has changed since.</p></Panel>;
  const commit = () => (setAsking(false), void action.run(async () => onCommitted(await api.migCommit(uploadId, commitRequest(dry).expectedMeasurementCellTenths))));
  return (
    <Panel title="Import these approved rows">
      <p className="text-sm text-slate-600">Creates the customers, wearers, measurements, employees, price list items (with their prices and piece rates) and sizer sets in one step, and updates the rates and prices of items already on the list. Nothing is deleted, and a row already imported from an earlier file is not created twice.</p>
      {!mayCommit && <Notice tone="warning">Only an owner can import the approved rows.</Notice>}
      <Button tone="primary" disabled={!canCommit(dry, counts, mayCommit) || action.busy} onClick={() => setAsking(true)}>{action.busy ? 'Importing…' : 'Import these approved rows'}</Button>
      {action.error && <Notice>{action.error}</Notice>}
      {asking && (
        <Dialog title="Import these approved rows?" onClose={() => setAsking(false)}>
          <p className="text-sm">The measurement cells add up to <strong>{cellSumWords(dry.checksums.measurement.cellTenths)}</strong> in the import check. If this does not match the old sheet, go back.</p>
          <p className="text-sm text-slate-600">It cannot be undone. You will be asked for your password again if it is needed.</p>
          <div className="flex justify-end gap-2"><Button onClick={() => setAsking(false)}>Go back</Button><Button tone="primary" onClick={commit}>Import these approved rows</Button></div>
        </Dialog>
      )}
      {action.dialog}
    </Panel>
  );
}

export function Committed({ uploadId, result, clearedAt, mayCommit, onCleared }: { uploadId: string; result: MigCommitResult; clearedAt: string | null; mayCommit: boolean; onCleared: (rows: number) => void }) {
  const [asking, setAsking] = useState(false);
  const [cleared, setCleared] = useState('');
  const action = useStepUpAction('clearing the staged values');
  const clear = () => (setAsking(false), void action.run(async () => { const r = await api.migClearStaging(uploadId); setCleared(clearedWords(r.rowsCleared)); onCleared(r.rowsCleared); }));
  const extra: [string, string][] = [['Measurement cells add up to', cellSumWords(result.measurementCellTenths)]];
  if (result.excluded !== undefined) extra.push(['Left out (excluded)', String(result.excluded)], ['Merged into another row', String(result.merged ?? 0)]);
  return (
    <>
      <Panel title="Imported">
        <Notice tone="success">These approved rows were imported.</Notice>
        <Lines lines={[...commitLines(result), ...extra]} />
      </Panel>
      <Panel title="Clear the staged values">
        <p className="text-sm text-slate-600">The old sheet's values stay in staging after the import. Once you have checked the result, clear them: names and rates in the staged rows are wiped. The imported records are not touched.</p>
        {clearedAt ? <Notice tone="success">Cleared on {clearedAt.slice(0, 10)}.</Notice> : cleared ? <Notice tone="success">{cleared}</Notice> : mayCommit ? (
          <Button tone="danger" disabled={action.busy} onClick={() => setAsking(true)}>Clear the staged values</Button>
        ) : <Notice tone="warning">Only an owner can clear the staged values.</Notice>}
        {action.error && <Notice>{action.error}</Notice>}
        {asking && (
          <Dialog title="Clear the staged values?" onClose={() => setAsking(false)}>
            <p className="text-sm">This wipes the staged rows' values for good. Do it only after you have checked the imported records.</p>
            <div className="flex justify-end gap-2"><Button onClick={() => setAsking(false)}>Go back</Button><Button tone="danger" onClick={clear}>Clear them</Button></div>
          </Dialog>
        )}
        {action.dialog}
      </Panel>
    </>
  );
}
