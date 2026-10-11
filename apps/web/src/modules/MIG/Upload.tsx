/** One upload: its review (accept, fix, merge, exclude), then the dry run and the commit; a committed upload shows its result. */
import { useEffect, useState } from 'react';
import { api, type DryRunResult, type Me, type MigCommitResult, type MigRow, type MigUpload } from '../../api.ts';
import { Loading, Notice } from '../../components/ui.tsx';
import { Link } from '../../router.tsx';
import { Commit, Committed, DryRun } from './Finish.tsx';
import { Review, type RowDoers } from './Review.tsx';
import { isOpen, rowCounts, startFilter, uploadStatusWords, type StatusFilter } from './importer.ts';

export function ImportUpload({ me, params }: { me: Me; params?: Record<string, string> }) {
  const id = params?.uploadId ?? '';
  const allowed = me.permissions.includes('mig.run');
  const mayCommit = me.permissions.includes('mig.commit');
  const [upload, setUpload] = useState<MigUpload | null>(null);
  const [rows, setRows] = useState<MigRow[] | null>(null);
  const [done, setDone] = useState<{ result: MigCommitResult; clearedAt: string | null } | null>(null);
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    void (async () => {
      const found = (await api.migUploads()).find((u) => u.id === id);
      if (!found) throw new Error('This upload was not found.');
      setUpload(found);
      if (isOpen(found)) {
        const listed = await api.migReview(id);
        setRows(listed);
        setFilter(startFilter(rowCounts(listed)));
      } else {
        const r = await api.migCommitted(id);
        setDone({ result: { counts: r.counts, measurementCellTenths: r.checksums.measurementCellTenths }, clearedAt: r.clearedAt });
      }
    })().catch((e: Error) => setError(e.message));
  }, [allowed, id]);

  if (!allowed) return <Notice>You cannot import old data.</Notice>;
  /** A change to any row ends the dry run: what it counted is no longer what would go in. The rows are read again from the server. */
  const changed = async () => { setDry(null); setRows(await api.migReview(id)); };
  const doers: RowDoers = {
    accept: async (row) => { await api.migAccept(row.id); await changed(); },
    fix: async (row, manualData) => { await api.migFix(row.id, manualData); await changed(); },
    merge: async (row, into) => { await api.migMerge(row.id, into.id); await changed(); },
    exclude: async (row, reason) => {
      await api.migExclude(row.id, reason);
      setReasons((r) => ({ ...r, [row.id]: reason }));
      await changed();
    },
  };
  const counts = rowCounts(rows ?? []);
  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm"><Link to="/mig" className="underline">← Import old data</Link></p>
      <h1 className="text-2xl font-semibold">{upload && upload.filename !== 'cleared' ? upload.filename : 'Import'}</h1>
      {upload && <p className="text-sm text-slate-600">{uploadStatusWords(upload.status)}</p>}
      {error && <Notice>{error}</Notice>}
      {!upload && !error && <Loading />}
      {rows && !done && (
        <>
          <Review uploadId={id} rows={rows} onChanged={changed} filter={filter} onFilter={setFilter} reasons={reasons} doers={doers} counts={counts} />
          <DryRun uploadId={id} counts={counts} dry={dry} onDry={setDry} />
          <Commit uploadId={id} counts={counts} dry={dry} mayCommit={mayCommit} onCommitted={(result) => { setDone({ result, clearedAt: null }); setRows(null); }} />
        </>
      )}
      {done && <Committed uploadId={id} result={done.result} clearedAt={done.clearedAt} mayCommit={mayCommit} onCleared={() => undefined} />}
    </div>
  );
}
