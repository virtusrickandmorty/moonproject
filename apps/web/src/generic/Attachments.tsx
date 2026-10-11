/**
 * The Attachments panel on every document view (PLAN H2): the design mock-ups on a quotation, a job order's pictures,
 * the 2307 received, a receipt photo. Add (on a phone, straight from the camera), list with who and when, open, remove
 * with a reason. A removed file stays listed. Attachments never change what the document recorded, so a cancelled
 * document takes them too. The server checks each file's type and size again (engine/attachments.ts).
 */
import { useLiveChange } from '../live.ts';
import { useCallback, useEffect, useState } from 'react';
import { api, attachmentUrl, type Attachment, type DocTypeInfo } from '../api.ts';
import { Notice, Panel, ReasonDialog, manilaTime, useAction } from '../components/ui.tsx';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';
const KIND: Record<Attachment['contentType'], string> = { 'image/jpeg': 'JPEG picture', 'image/png': 'PNG picture', 'image/webp': 'WebP picture', 'application/pdf': 'PDF' };
const size = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);
const pick = 'cursor-pointer rounded-md bg-white px-3 py-2 text-sm font-medium ring-1 ring-slate-300 hover:bg-indigo-50 focus-within:ring-2 focus-within:ring-indigo-500';

/** A phone or tablet: offer the camera as well. */
const onPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function AttachmentsPanel({ type, id }: { type: DocTypeInfo; id: string }) {
  const [rows, setRows] = useState<Attachment[] | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const adding = useAction();
  const load = useCallback(() => api.attachments(type.key, id).then(setRows, (e: Error) => setError(e.message)), [type.key, id]);
  useEffect(() => void load(), [load]);
  useLiveChange(() => void load(), [type.key]); // attachments are logged under their document's type

  const add = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // the same file can be picked again after a refusal
    void adding.run(async () => {
      try {
        for (const f of files) {
          if (f.size > MAX_BYTES) throw new Error(`${f.name} is bigger than 10 MB. Attach a smaller picture or PDF.`);
          await api.addAttachment(type.key, id, f);
        }
      } finally {
        await load();
      }
    });
  };
  const remove = async (reason: string) => {
    await api.removeAttachment(type.key, id, removing!.id, reason);
    setRemoving(null);
    await load();
  };

  const active = rows?.filter((r) => !r.removedAt).length ?? 0;
  const pictures = rows?.filter((r) => !r.removedAt && r.contentType.startsWith('image/')) ?? [];
  return (
    <Panel title="Attachments">
      {error && <Notice>{error}</Notice>}
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">No files attached.</p>}
      {/* The pictures themselves (a job order's design), each opening full size; a removed one is not shown. */}
      {pictures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pictures.map((r, i) => (
            <a key={r.id} href={attachmentUrl(type.key, id, r.id)} target="_blank" rel="noopener noreferrer" title={`Open ${r.fileName}`} aria-label={`View picture ${i + 1} full size`}
              className="group block overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 hover:ring-indigo-300">
              <img src={attachmentUrl(type.key, id, r.id)} alt={r.fileName} loading="lazy" className="aspect-[4/3] w-full object-contain transition-transform group-hover:scale-[1.02]" />
              <span className="block truncate px-2 py-1 text-xs text-slate-600">{r.fileName}</span>
            </a>
          ))}
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <a href={attachmentUrl(type.key, id, r.id)} target="_blank" rel="noopener noreferrer" className={`font-medium text-indigo-700 hover:underline ${r.removedAt ? 'line-through' : ''}`}>
                {r.fileName}
              </a>
              <span className="text-slate-500">{KIND[r.contentType]} · {size(r.bytes)} · added by {r.addedByName} {manilaTime(r.addedAt)}</span>
              {r.removedAt
                ? <span className="w-full text-slate-600">Removed by {r.removedByName} {manilaTime(r.removedAt)}: {r.removedReason}</span>
                : type.canCreate && (
                  <button type="button" className="ml-auto text-sm text-red-700 hover:underline" aria-label={`Remove ${r.fileName}`} onClick={() => setRemoving(r)}>Remove</button>
                )}
            </li>
          ))}
        </ul>
      )}
      {type.canCreate && (
        <div className="flex flex-wrap items-center gap-2">
          <label className={pick}>
            {adding.busy ? 'Adding…' : 'Add a file'}
            <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={adding.busy} onChange={(e) => add(e.currentTarget)} />
          </label>
          {onPhone() && (
            <label className={pick}>
              Take a photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={adding.busy} onChange={(e) => add(e.currentTarget)} />
            </label>
          )}
          <span className="text-xs text-slate-500">JPEG, PNG, WebP or PDF, up to 10 MB each; {active} of 10 attached.</span>
        </div>
      )}
      {adding.error && <Notice>{adding.error}</Notice>}
      {removing && (
        <ReasonDialog
          title={`Remove ${removing.fileName}?`}
          explain="It stays on file, listed as removed with your reason, and can still be opened. Nothing the document recorded changes."
          confirmLabel="Remove"
          danger
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </Panel>
  );
}
