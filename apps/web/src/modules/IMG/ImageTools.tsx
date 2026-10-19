/**
 * Image tools (the owner's request, Oct 2026): remove a picture's background (an AI cut-out, or one colour made clear) and
 * upscale it 2x or 4x, on the shop PC's own graphics card (no charge per picture). The result shows before/after over a
 * checkerboard, then downloads as a PNG or goes on a job order as a design picture.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type Me, type NavResult } from '../../api.ts';
import { Button, Field, Notice, inputClass } from '../../components/ui.tsx';
import { removeColour, toHex, type Rgb } from './colour.ts';

type Background = 'keep' | 'object' | 'design' | 'colour';
type Status = { upscale: boolean; background: boolean; waiting: number };
const MAX_SIDE = 8000; // the largest side a result may have

const checker = { backgroundImage: 'conic-gradient(#e2e8f0 25%, #fff 0 50%, #e2e8f0 0 75%, #fff 0)', backgroundSize: '18px 18px' };

export function ImageTools({ me }: { me: Me }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [file, setFile] = useState<{ blob: Blob; name: string; url: string; w: number; h: number } | null>(null);
  const [bg, setBg] = useState<Background>('keep');
  const [colour, setColour] = useState<Rgb>([255, 255, 255]);
  const [tolerance, setTolerance] = useState(20);
  const [scale, setScale] = useState<0 | 2 | 4>(0);
  const [kind, setKind] = useState<'artwork' | 'photo'>('artwork');
  const [result, setResult] = useState<{ blob: Blob; url: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [split, setSplit] = useState(50);
  const pickCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => void fetch('/api/img/status', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() as Promise<Status> : Promise.reject(new Error())))
    .then(setStatus, () => setStatus({ upscale: false, background: false, waiting: 0 })), []);

  const open = async (f: File | Blob, name: string) => {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError('Pick a JPEG, PNG or WebP picture.');
    const bmp = await createImageBitmap(f);
    const c = document.createElement('canvas');
    Object.assign(c, { width: bmp.width, height: bmp.height });
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    pickCanvas.current = c;
    const [r, g, b] = c.getContext('2d')!.getImageData(0, 0, 1, 1).data; // the corner's colour: usually the background
    setColour([r!, g!, b!]);
    setFile({ blob: f, name: name.replace(/\.\w+$/, ''), url: URL.createObjectURL(f), w: bmp.width, h: bmp.height });
    setResult(null); setError('');
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files ?? [])][0]; if (f) void open(f, 'pasted'); };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  /** Click on the picture: that point's colour is the one made clear. */
  const pick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (bg !== 'colour' || !pickCanvas.current || !file) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * file.w), y = Math.floor(((e.clientY - box.top) / box.height) * file.h);
    const [r, g, b] = pickCanvas.current.getContext('2d')!.getImageData(x, y, 1, 1).data;
    setColour([r!, g!, b!]);
  };

  const send = async (blob: Blob, query: string): Promise<Blob> => {
    const res = await fetch(`/api/img/run?${query}`, { method: 'POST', credentials: 'same-origin', body: blob, headers: { 'x-csrf-token': me.csrfToken, 'content-type': 'application/octet-stream' } });
    const body = await res.json().catch(() => null) as { url?: string; message?: string } | null;
    if (!res.ok || !body?.url) throw new Error(body?.message ?? 'The picture could not be done.');
    return (await fetch(body.url, { credentials: 'same-origin' })).blob();
  };

  const run = async () => {
    if (!file) return;
    if (scale && Math.max(file.w, file.h) * scale > MAX_SIDE) return setError(`At ${scale}× the picture would be over ${MAX_SIDE} pixels wide. Use 2× or a smaller picture.`);
    setError(''); setResult(null);
    try {
      let out: Blob = file.blob;
      if (bg === 'colour') { setBusy('Making the colour clear…'); out = await removeColour(out, colour, tolerance); }
      if (bg === 'object' || bg === 'design') { setBusy(bg === 'object' ? 'Cutting out the object (about 6 seconds)…' : 'Cutting out the design…'); out = await send(out, `op=background&cutout=${bg}`); }
      if (scale) { setBusy(`Upscaling ${scale}× (a few seconds)…`); out = await send(out, `op=upscale&scale=${scale}&kind=${kind}`); }
      const bmp = await createImageBitmap(out);
      setResult({ blob: out, url: URL.createObjectURL(out), w: bmp.width, h: bmp.height }); setSplit(50);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  const nothing = bg === 'keep' && !scale;
  const fileName = file ? `${file.name}${bg !== 'keep' ? '-clear' : ''}${scale ? `-x${scale}` : ''}.png` : 'picture.png';
  const choice = (on: boolean) => `rounded-full px-3 py-1.5 text-sm ring-1 ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'} disabled:opacity-40`;

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Image tools</h1>
        <p className="text-sm text-slate-600">Remove a picture's background and make it bigger and sharper. It runs on the shop PC's own graphics card: no charge per picture, and the picture never leaves the shop.</p>
      </div>
      {status && (!status.upscale || !status.background) && <Notice tone="warning">{!status.upscale && !status.background ? 'The image tools are not installed on the shop PC yet' : !status.upscale ? 'The upscaler is not installed on the shop PC yet' : 'The AI background remover is not installed on the shop PC yet'}. Ask whoever looks after the shop PC to run tools/img/install.ps1. Removing one colour works without it.</Notice>}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <label className="block cursor-pointer rounded-lg border-2 border-dashed border-slate-300 p-4 text-center text-sm text-slate-600 hover:border-indigo-400"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void open(f, f.name); }}>
            <b className="text-indigo-700">Choose a picture</b>, drop it here, or paste it (Ctrl+V)
            <span className="block text-xs text-slate-500">JPEG, PNG or WebP, up to 15 MB</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose a picture" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void open(f, f.name); }} />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">1. Background</legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={choice(bg === 'keep')} onClick={() => setBg('keep')}>Keep it</button>
              <button type="button" className={choice(bg === 'object')} disabled={status?.background === false} onClick={() => setBg('object')}>Object or person</button>
              <button type="button" className={choice(bg === 'design')} disabled={status?.background === false} onClick={() => setBg('design')}>Whole design</button>
              <button type="button" className={choice(bg === 'colour')} onClick={() => setBg('colour')}>Remove a colour</button>
            </div>
            <p className="text-xs text-slate-500">
              {bg === 'object' ? 'AI, best detail: products, garments and people. About 6 seconds.'
                : bg === 'design' ? 'AI, fast: keeps a whole design with its text.'
                : bg === 'colour' ? 'Exact, no AI: for a logo or design on a plain background. Click the picture to pick the colour.'
                : 'The background stays as it is.'}
            </p>
            {bg === 'colour' && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-2">Colour <span className="inline-block size-6 rounded ring-1 ring-slate-300" style={{ background: toHex(colour) }} /> <code className="text-xs">{toHex(colour)}</code></span>
                <label className="flex items-center gap-2">How close <input type="range" min={0} max={100} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} aria-label="How close a colour counts" /> {tolerance}</label>
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">2. Make it bigger</legend>
            <div className="flex flex-wrap gap-2">
              {([0, 2, 4] as const).map((s) => <button key={s} type="button" className={choice(scale === s)} disabled={s > 0 && status?.upscale === false} onClick={() => setScale(s)}>{s ? `${s}×` : 'Same size'}</button>)}
            </div>
            {scale > 0 && <div className="flex flex-wrap gap-2">
              <button type="button" className={choice(kind === 'artwork')} onClick={() => setKind('artwork')}>Artwork or logo</button>
              <button type="button" className={choice(kind === 'photo')} onClick={() => setKind('photo')}>Photo</button>
            </div>}
            {file && scale > 0 && <p className="text-xs text-slate-500">{file.w} × {file.h} becomes {file.w * scale} × {file.h * scale} pixels.</p>}
          </fieldset>

          <Button tone="primary" disabled={!file || nothing || !!busy} onClick={() => void run()}>{busy ? 'Working…' : 'Do it'}</Button>
          {busy && <p role="status" className="text-sm text-indigo-700">{busy}</p>}
          {error && <Notice>{error}</Notice>}
        </div>

        <div className="min-w-0 space-y-3">
          {!file && <div className="grid h-80 place-items-center rounded-xl bg-white text-sm text-slate-500 ring-1 ring-slate-200/70">The picture shows here.</div>}
          {file && !result && (
            <figure className="overflow-hidden rounded-xl ring-1 ring-slate-200" style={checker}>
              <img src={file.url} alt="The picture" onClick={pick} className={`mx-auto max-h-[70vh] object-contain ${bg === 'colour' ? 'cursor-crosshair' : ''}`} />
            </figure>
          )}
          {file && result && (
            <>
              {/* Before and after: drag the handle across. */}
              <figure className="relative mx-auto max-h-[70vh] max-w-full overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ ...checker, aspectRatio: `${result.w} / ${result.h}`, height: 'min(70vh, 100%)' }}>
                {/* Both in the same frame, so they line up whatever their sizes. */}
                <img src={result.url} alt="After" className="absolute inset-0 h-full w-full object-contain" />
                <img src={file.url} alt="Before" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
                <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-indigo-600" style={{ left: `${split}%` }} />
                <span className="absolute left-2 top-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white">Before</span>
                <span className="absolute right-2 top-2 rounded bg-indigo-600 px-2 py-0.5 text-xs text-white">After</span>
              </figure>
              <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Before and after" className="w-full" />
              <div className="flex flex-wrap items-center gap-3">
                <a href={result.url} download={fileName} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Download PNG</a>
                <Button onClick={() => void open(result.blob, fileName)}>Keep working on the result</Button>
                <span className="text-sm text-slate-500">{result.w} × {result.h} pixels · {(result.blob.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
              <AttachToJobOrder me={me} blob={result.blob} name={fileName} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Puts the result on a job order as a design picture: it then prints on the job ticket, a page of its own. */
function AttachToJobOrder({ me, blob, name }: { me: Me; blob: Blob; name: string }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<NavResult[]>([]);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.trim().length < 3) return setFound([]);
    const t = setTimeout(() => void api.navSearch(q.trim()).then((r) => setFound(r.filter((x) => x.kind === 'Job order').slice(0, 5)), () => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  const attach = async (jo: NavResult) => {
    setError(''); setDone('');
    const id = jo.href.split('/').pop()!;
    const res = await fetch(`/api/docs/jo.job_order/${encodeURIComponent(id)}/attachments`, { method: 'POST', credentials: 'same-origin', body: blob,
      headers: { 'x-csrf-token': me.csrfToken, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) } });
    const body = await res.json().catch(() => null) as { message?: string } | null;
    if (!res.ok) return setError(body?.message ?? 'The picture could not be attached.');
    setDone(`Attached to ${jo.label}. It prints on the job ticket.`); setQ(''); setFound([]);
  };
  return (
    <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
      <Field label="Attach to a job order"><input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job order number or customer" /></Field>
      {found.map((jo) => <button key={jo.id} type="button" onClick={() => void attach(jo)} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-indigo-50"><b>{jo.label}</b>{jo.detail ? <span className="text-slate-500"> · {jo.detail}</span> : null}</button>)}
      {done && <Notice tone="success">{done}</Notice>}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
