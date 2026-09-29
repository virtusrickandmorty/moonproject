/**
 * Import old data (PLAN E13 MIG-01): the uploads so far, and the form that stages a new CSV from the old Google sheet.
 * Nothing is imported here: an upload only stages its rows for the review.
 */
import { useEffect, useState } from 'react';
import { api, type Me, type MigUpload } from '../../api.ts';
import { Button, Field, Notice, Panel, inputClass, manilaTime, useAction } from '../../components/ui.tsx';
import { Link, navigate } from '../../router.tsx';
import { KINDS, SHEET_TABS, fileLooksLike, fileProblem, isOpen, sheetTabOf, headerOf, uploadRequest, uploadStatusWords, type MigKind } from './importer.ts';

function UploadForm() {
  const [kind, setKind] = useState<MigKind | ''>('');
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [readError, setReadError] = useState('');
  const send = useAction();
  const problem = fileProblem(kind, file?.name ?? '', file?.csv ?? '');
  const pick = async (f: File | undefined) => {
    setReadError('');
    if (!f) return setFile(null);
    try {
      const csv = await f.text();
      setFile({ name: f.name, csv });
      // A tab downloaded from the old sheet says what it holds: pick it for the owner if nothing is picked yet.
      const tab = sheetTabOf(headerOf(csv));
      if (tab) setKind((k) => k || SHEET_TABS[tab].kind);
    } catch { setFile(null); setReadError('The file could not be read.'); }
  };
  const submit = () => file && send.run(async () => {
    const r = await api.migUpload(file.name, uploadRequest(file.name, file.csv).csv);
    navigate(`/mig/${encodeURIComponent(r.uploadId)}`);
  });
  const wanted = KINDS.find((k) => k.kind === kind);
  return (
    <Panel title="Upload a file from the old sheet">
      <p className="text-sm text-slate-600">Download each tab of the old Google sheet as a CSV file (File, Download, Comma-separated values) and upload one file at a time, as it is: no renaming of columns is needed. The rows are only staged: you review them before anything goes in.</p>
      <div className="max-w-xl space-y-3">
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">What is in the file?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {KINDS.map((k) => (
              <label key={k.kind} className="flex items-center gap-2"><input type="radio" name="kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} />{k.label}</label>
            ))}
          </div>
          {wanted && <p className="text-xs text-slate-500">First line of the file: {wanted.columns}.</p>}
        </fieldset>
        <Field label="CSV file" required>
          <input type="file" accept=".csv,text/csv" className={inputClass} onChange={(e) => void pick(e.target.files?.[0])} />
        </Field>
        {readError && <Notice>{readError}</Notice>}
        {file && fileLooksLike(file.csv) && <p className="text-sm text-slate-700">This file looks like {fileLooksLike(file.csv)}.</p>}
        {file && problem && <Notice tone="warning">{problem}</Notice>}
        <Button tone="primary" disabled={!!problem || send.busy} onClick={() => void submit()}>{send.busy ? 'Uploading…' : 'Upload and stage the rows'}</Button>
        {send.error && <Notice>{send.error}</Notice>}
      </div>
    </Panel>
  );
}

function UploadsList({ uploads }: { uploads: MigUpload[] }) {
  return (
    <Panel title="Uploads">
      {uploads.length === 0 ? <p className="text-sm text-slate-500">Nothing has been uploaded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="pr-3">File</th><th className="pr-3">Uploaded</th><th className="pr-3">Status</th><th /></tr></thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{u.filename}</td>
                  <td className="whitespace-nowrap py-1 pr-3">{manilaTime(u.uploadedAt)}</td>
                  <td className="py-1 pr-3">{uploadStatusWords(u.status)}</td>
                  <td className="py-1 text-right"><Link to={`/mig/${encodeURIComponent(u.id)}`} className="underline">{isOpen(u) ? 'Review' : 'See the result'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function ImportOldData({ me }: { me: Me }) {
  const allowed = me.permissions.includes('mig.run');
  const [uploads, setUploads] = useState<MigUpload[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => void (allowed && api.migUploads().then(setUploads, (e: Error) => setError(e.message))), [allowed]);
  if (!allowed) return <Notice>You cannot import old data.</Notice>;
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Import old data</h1>
      <p className="text-sm text-slate-600">Bring customers, measurements, employees and piece rates in from the old Google sheet. Upload, review every row, run a dry run to check the totals, then commit.</p>
      <UploadForm />
      {error && <Notice>{error}</Notice>}
      {!uploads && !error && <p className="text-slate-500">Loading…</p>}
      {uploads && <UploadsList uploads={uploads} />}
    </div>
  );
}
