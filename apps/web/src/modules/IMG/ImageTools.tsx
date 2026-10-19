/**
 * Image tools (the owner's request, Oct 2026), on the shop PC itself (no charge per picture):
 * - Background & size: remove a picture's background (an AI cut-out, or one colour made clear), upscale it 2x or 4x.
 * - Photo to flat art: a photo of a printed design back to clean artwork (straightened, smoothed, a few exact colours).
 * - Vectorize: SVG and PDF at the printed size, films for screen printing (one page per ink), full colour for
 *   sublimation (16 to 64 colours), outlines for a cutter.
 * - Online AI, paid per picture (owner: img.ai): redraw a jersey photo flat (Fal.ai: Nano Banana Pro or FLUX Kontext) and
 *   vectorize cleanly (Recraft), with the price shown first and a monthly limit.
 * The result shows before/after over a checkerboard, then downloads or goes on a job order.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type Me, type NavResult } from '../../api.ts';
import { Button, Field, Notice, inputClass } from '../../components/ui.tsx';
import { removeColour, toHex, type Rgb } from './colour.ts';
import { FIT, limit, zoomAt, type View } from './zoom.ts';

type Tool = 'clean' | 'flat' | 'vector';
type Background = 'keep' | 'object' | 'design' | 'colour';
type Status = { upscale: boolean; background: boolean; art: boolean; waiting: number };
type FlatColour = { hex: string; paint: string | null; share: number; background: boolean };
type VectorInfo = { width: number; height: number; widthCm: number; heightCm: number; colours: { hex: string; share: number }[]; shapes: number; warnings: string[] };
type Result =
  | { kind: 'png'; blob: Blob; url: string; w: number; h: number; colours?: FlatColour[]; label?: 'front' | 'back' | 'mockup' }
  | { kind: 'vector'; url: string; w: number; h: number; info: VectorInfo; files: { name: string; label: string; blob: Blob; url: string }[]; costPeso?: number };
type Corners = [number, number][];
type Method = 'ai-best' | 'ai-economy' | 'free';
type Sides = 'front' | 'split' | 'two' | 'aiback';
type Garment = 'jersey' | 'tshirt' | 'polo' | 'longsleeve';
type SetItem = { blob: Blob; url: string; w: number; h: number };
type JerseySet = { front?: SetItem; back?: SetItem; mockup?: SetItem };
const GARMENTS: Record<Garment, string> = { jersey: 'Basketball jersey', tshirt: 'T-shirt', polo: 'Polo shirt', longsleeve: 'Long-sleeve shirt' };
const toDataUri = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('The picture could not be read.')); r.readAsDataURL(b); });
type AiRun = { at: string; step: string; model: string; ok: boolean; peso: number; seconds: number; note: string; who: string };
type AiInfo = { keySet: boolean; capPeso: number; ratePeso: number; version: number; month: string; spentPeso: number; prices: { best: number; economy: number; vector: number }; runs: AiRun[] };
const peso = (n: number) => `₱${n.toFixed(2)}`;
const MAX_SIDE = 8000; // the largest side a result may have
const START_CORNERS: Corners = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
const LEVELS = ['None', 'Light', 'Medium', 'Strong'];
const SPECKS = ['Keep all', 'Small', 'Medium', 'Large'];

const checker = { backgroundImage: 'conic-gradient(#e2e8f0 25%, #fff 0 50%, #e2e8f0 0 75%, #fff 0)', backgroundSize: '18px 18px' };
const fraction = (n: number) => (n <= 0.0001 ? '0' : n >= 0.9999 ? '1' : n.toFixed(4));

export function ImageTools({ me }: { me: Me }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tool, setTool] = useState<Tool>('clean');
  const [file, setFile] = useState<{ blob: Blob; name: string; url: string; w: number; h: number } | null>(null);
  // Background & size
  const [bg, setBg] = useState<Background>('keep');
  const [colour, setColour] = useState<Rgb>([255, 255, 255]);
  const [tolerance, setTolerance] = useState(20);
  const [scale, setScale] = useState<0 | 2 | 4>(0);
  const [kind, setKind] = useState<'artwork' | 'photo'>('artwork');
  // Photo to flat art
  const canAi = me.permissions.includes('img.ai');
  const [ai, setAi] = useState<AiInfo | null>(null);
  const [method, setMethod] = useState<Method>(canAi ? 'ai-best' : 'free');
  const [shape, setShape] = useState<'tall' | 'square' | 'wide'>('tall');
  const [removeText, setRemoveText] = useState(true);
  const [sides, setSides] = useState<Sides>('front');
  const [backFile, setBackFile] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [backName, setBackName] = useState('');
  const [backNumber, setBackNumber] = useState('');
  const [set, setSet] = useState<JerseySet>({});
  const [garment, setGarment] = useState<Garment>('jersey');
  const [straighten, setStraighten] = useState(false);
  const [corners, setCorners] = useState<Corners>(START_CORNERS);
  const [clean, setClean] = useState(2);
  const [light, setLight] = useState(false);
  const [colours, setColours] = useState(0);
  const [specks, setSpecks] = useState(2);
  const [clearBg, setClearBg] = useState(true);
  const [paint, setPaint] = useState<(string | null)[]>([]);
  // Vectorize
  const [style, setStyle] = useState<'colour' | 'full' | 'cutter' | 'ai'>('colour');
  const [vColours, setVColours] = useState(0);
  const [fullColours, setFullColours] = useState(32);
  const [vSpecks, setVSpecks] = useState(1);
  const [edges, setEdges] = useState<'smooth' | 'sharp'>('smooth');
  const [widthCm, setWidthCm] = useState('25');
  const [invert, setInvert] = useState(false);
  const [mirror, setMirror] = useState(false);

  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [split, setSplit] = useState(50);
  const pickCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => void fetch('/api/img/status', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() as Promise<Status> : Promise.reject(new Error())))
    .then(setStatus, () => setStatus({ upscale: false, background: false, art: false, waiting: 0 })), []);
  const loadAi = () => { if (canAi) void fetch('/api/img/ai', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() as Promise<AiInfo> : null)).then((a) => a && setAi(a), () => undefined); };
  useEffect(loadAi, []);

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
    setResult(null); setError(''); setCorners(START_CORNERS); setPaint([]); setSet({});
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files ?? [])][0]; if (f) void open(f, 'pasted'); };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  /** Click on the picture: that point's colour is the one made clear. */
  const pick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (tool !== 'clean' || bg !== 'colour' || !pickCanvas.current || !file) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * file.w), y = Math.floor(((e.clientY - box.top) / box.height) * file.h);
    const [r, g, b] = pickCanvas.current.getContext('2d')!.getImageData(x, y, 1, 1).data;
    setColour([r!, g!, b!]);
  };

  const post = async <T,>(blob: Blob, query: string, path = '/api/img/run'): Promise<T & { url: string }> => {
    const res = await fetch(`${path}?${query}`, { method: 'POST', credentials: 'same-origin', body: blob, headers: { 'x-csrf-token': me.csrfToken, 'content-type': 'application/octet-stream' } });
    const body = await res.json().catch(() => null) as (T & { url?: string; message?: string }) | null;
    if (!res.ok || !body?.url) throw new Error(body?.message ?? 'The picture could not be done.');
    return body as T & { url: string };
  };
  const fetchBlob = async (url: string) => (await fetch(url, { credentials: 'same-origin' })).blob();
  const send = async (blob: Blob, query: string): Promise<Blob> => fetchBlob((await post<object>(blob, query)).url);
  const shown = async (out: Blob, colours?: FlatColour[]) => {
    const bmp = await createImageBitmap(out);
    setResult({ kind: 'png', blob: out, url: URL.createObjectURL(out), w: bmp.width, h: bmp.height, colours }); setSplit(50);
  };

  const attempt = async (work: () => Promise<void>) => {
    setError('');
    try { await work(); } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  const runClean = () => attempt(async () => {
    if (!file) return;
    if (scale && Math.max(file.w, file.h) * scale > MAX_SIDE) throw new Error(`At ${scale}× the picture would be over ${MAX_SIDE} pixels wide. Use 2× or a smaller picture.`);
    setResult(null);
    let out: Blob = file.blob;
    if (bg === 'colour') { setBusy('Making the colour clear…'); out = await removeColour(out, colour, tolerance); }
    if (bg === 'object' || bg === 'design') { setBusy(bg === 'object' ? 'Cutting out the object (about 6 seconds)…' : 'Cutting out the design…'); out = await send(out, `op=background&cutout=${bg}`); }
    if (scale) { setBusy(`Upscaling ${scale}× (a few seconds)…`); out = await send(out, `op=upscale&scale=${scale}&kind=${kind}`); }
    await shown(out);
  });

  /** Photo to flat art; with repaint, again with the colours it found, each painted as chosen. */
  const runFlat = (repaint?: { palette: string[]; paint: (string | null)[] }) => attempt(async () => {
    if (!file) return;
    setBusy(repaint ? 'Repainting the colours…' : 'Making flat art (a few seconds)…');
    const q = new URLSearchParams({ op: 'flatten', clean: String(clean), light: light ? '1' : '0', colours: String(colours), specks: String(specks), clear: clearBg ? '1' : '0' });
    if (straighten) q.set('corners', corners.flat().map(fraction).join(','));
    if (repaint) { q.set('palette', repaint.palette.join(',')); q.set('paint', repaint.paint.map((p) => p ?? '-').join(',')); }
    const body = await post<{ info: { colours: FlatColour[] } }>(file.blob, q.toString());
    await shown(await fetchBlob(body.url), body.info.colours);
    setPaint(body.info.colours.map((c) => c.paint));
  });

  const runVector = () => attempt(async () => {
    if (!file) return;
    const width = Number(widthCm);
    if (!(width >= 1 && width <= 300)) throw new Error('Type the printed width in centimetres, 1 to 300.');
    setBusy('Tracing the shapes (a few seconds)…');
    const q = new URLSearchParams({ op: 'vectorize', style, colours: String(style === 'full' ? fullColours : vColours), specks: String(vSpecks), edges, width: String(width), invert: invert ? '1' : '0', mirror: mirror ? '1' : '0' });
    const body = await post<{ info: VectorInfo; files: Record<string, string> }>(file.blob, q.toString());
    const labels: Record<string, [string, string]> = { 'design.svg': ['SVG', `${file.name}.svg`], 'design.pdf': ['PDF', `${file.name}.pdf`], 'separations.pdf': ['Films (one page per ink)', `${file.name}-films.pdf`] };
    const files = await Promise.all(Object.entries(body.files).map(async ([f, url]) => {
      const blob = await fetchBlob(url);
      return { name: labels[f]![1], label: labels[f]![0], blob, url: URL.createObjectURL(blob) };
    }));
    setResult({ kind: 'vector', url: files[0]!.url, w: body.info.width, h: body.info.height, info: body.info, files }); setSplit(50);
  });

  /** The online AI takes pictures under 5 MB and 4096 px: sent at most 2048 px a side (JPEG for a photo, PNG for art). */
  const forAi = async (blob: Blob, png: boolean): Promise<Blob> => {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    Object.assign(c, { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const as = (type: string) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('The picture could not be prepared.'))), type, 0.92));
    const out = await as(png ? 'image/png' : 'image/jpeg');
    return out.size > 4.5 * 1024 * 1024 ? as('image/jpeg') : out;
  };

  const item = async (blob: Blob): Promise<SetItem> => { const bmp = await createImageBitmap(blob); return { blob, url: URL.createObjectURL(blob), w: bmp.width, h: bmp.height }; };
  const showItem = (it: SetItem, label: 'front' | 'back' | 'mockup') => { setResult({ kind: 'png', ...it, label }); setSplit(label === 'mockup' ? 0 : 50); }; // a mockup has no 'before'

  /**
   * AI redraw: the photo laid flat as print artwork by the online AI, one side or front and back: one picture showing
   * both (each side taken out), two photos, or the back made by the AI from the redrawn front. The price was on the button.
   */
  const runAiRedraw = () => attempt(async () => {
    if (!file) return;
    if (sides === 'two' && !backFile) throw new Error('Choose the back photo too.');
    setResult(null); setSet({});
    const quality = method === 'ai-best' ? 'best' : 'economy';
    const redraw = async (blob: Blob, part: 'whole' | 'front' | 'back') => {
      const q = new URLSearchParams({ op: 'redraw', quality, shape, text: removeText ? 'remove' : 'keep', part });
      return item(await fetchBlob((await post<object>(await forAi(blob, false), q.toString(), '/api/img/ai/run')).url));
    };
    try {
      setBusy(sides === 'front' ? 'Redrawing with the online AI (about 25 seconds)…' : 'Redrawing the front (about 25 seconds)…');
      const front = await redraw(file.blob, sides === 'split' ? 'front' : 'whole');
      setSet({ front }); showItem(front, 'front');
      if (sides === 'front') return;
      let back: SetItem;
      if (sides === 'aiback') {
        setBusy('Making the back (about 25 seconds)…');
        const q = new URLSearchParams({ op: 'back', shape, name: backName.trim(), number: backNumber.trim() });
        back = await item(await fetchBlob((await post<object>(await forAi(front.blob, true), q.toString(), '/api/img/ai/run')).url));
      } else {
        setBusy('Redrawing the back (about 25 seconds)…');
        back = await redraw(sides === 'split' ? file.blob : backFile!.blob, sides === 'split' ? 'back' : 'whole');
      }
      setSet({ front, back });
    } finally { loadAi(); }
  });

  /** A mockup: the front (and back) flat artwork on a garment, front and back views side by side. */
  const runMockup = () => attempt(async () => {
    if (!set.front) return;
    setBusy('Making the mockup (about 25 seconds)…');
    try {
      const body = { front: await toDataUri(await forAi(set.front.blob, false)), ...(set.back ? { back: await toDataUri(await forAi(set.back.blob, false)) } : {}), garment };
      const res = await fetch('/api/img/ai/mockup', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => null) as { url?: string; message?: string } | null;
      if (!res.ok || !out?.url) throw new Error(out?.message ?? 'The mockup could not be made.');
      const mockup = await item(await fetchBlob(out.url));
      setSet((x) => ({ ...x, mockup })); showItem(mockup, 'mockup');
    } finally { loadAi(); }
  });

  /** AI vector (Recraft): clean shapes and gradients, an SVG. */
  const runAiVector = () => attempt(async () => {
    if (!file) return;
    setBusy('Vectorizing with the online AI (about 20 seconds)…');
    try {
      const body = await post<{ costPeso: number }>(await forAi(file.blob, true), 'op=vector', '/api/img/ai/run');
      const blob = await fetchBlob(body.url);
      const svg = new Blob([await blob.text()], { type: 'image/svg+xml' });
      const shapes = ((await svg.text()).match(/<path/g) ?? []).length;
      const url = URL.createObjectURL(svg);
      setResult({ kind: 'vector', url, w: file.w, h: file.h, costPeso: body.costPeso,
        info: { width: file.w, height: file.h, widthCm: 0, heightCm: 0, colours: [], shapes, warnings: [] },
        files: [{ name: `${file.name}-ai.svg`, label: 'SVG', blob: svg, url }] });
      setSplit(50);
    } finally { loadAi(); }
  });

  const pickTool = (t: Tool) => { setTool(t); setResult(null); setError(''); };
  const art = !!status?.art;
  const nothing = tool === 'clean' && bg === 'keep' && !scale;
  const aiFlat = tool === 'flat' && method !== 'free';
  const aiVector = tool === 'vector' && style === 'ai';
  const ready = tool === 'clean' || aiFlat || aiVector || art;
  const redrawPrice = !ai ? 0 : method === 'ai-best' ? ai.prices.best : ai.prices.economy;
  const aiPrice = !ai ? null : aiFlat ? (sides === 'front' ? redrawPrice : sides === 'aiback' ? redrawPrice + ai.prices.best : 2 * redrawPrice) : aiVector ? ai.prices.vector : null;
  const doIt = () => void (tool === 'clean' ? runClean() : aiFlat ? runAiRedraw() : tool === 'flat' ? runFlat() : aiVector ? runAiVector() : runVector());
  const fileName = !file ? 'picture.png' : result?.kind === 'png' && result.label ? `${file.name}-${result.label}.png` : aiFlat ? `${file.name}-redraw.png` : tool === 'flat' ? `${file.name}-flat.png` : `${file.name}${bg !== 'keep' ? '-clear' : ''}${scale ? `-x${scale}` : ''}.png`;
  const choice = (on: boolean) => `rounded-full px-3 py-1.5 text-sm ring-1 ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-slate-300 hover:bg-indigo-50'} disabled:opacity-40`;
  const tab = (on: boolean) => `flex-1 rounded-md px-2 py-1.5 text-sm font-medium ${on ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`;
  const choices = <T,>(values: readonly T[], value: T, set: (v: T) => void, label: (v: T) => string, disabled?: (v: T) => boolean) => (
    <div className="flex flex-wrap gap-2">{values.map((v) => <button key={String(v)} type="button" className={choice(value === v)} disabled={disabled?.(v)} onClick={() => set(v)}>{label(v)}</button>)}</div>
  );
  const flatColours = result?.kind === 'png' ? result.colours : undefined;
  const repainted = !!flatColours && paint.some((p, i) => p !== flatColours[i]?.paint);

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Image tools</h1>
        <p className="text-sm text-slate-600">Clean up, enlarge, flatten and vectorize designs. It runs on the shop PC itself, at no charge and without the picture leaving the shop{canAi ? ', except the AI choices with a price: those go to an online AI, paid per picture' : ''}.</p>
      </div>
      {status && (!status.upscale || !status.background || !status.art) && <Notice tone="warning">
        {[!status.background && 'the AI background remover', !status.upscale && 'the upscaler', !status.art && 'photo to flat art and vectorize'].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())} {(!status.upscale ? 1 : 0) + (!status.background ? 1 : 0) + (!status.art ? 1 : 0) > 1 ? 'are' : 'is'} not installed on the shop PC yet. Ask whoever looks after the shop PC to run tools/img/install.ps1. Removing one colour works without it.
      </Notice>}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <label className="block cursor-pointer rounded-lg border-2 border-dashed border-slate-300 p-4 text-center text-sm text-slate-600 hover:border-indigo-400"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void open(f, f.name); }}>
            <b className="text-indigo-700">Choose a picture</b>, drop it here, or paste it (Ctrl+V)
            <span className="block text-xs text-slate-500">JPEG, PNG or WebP, up to 15 MB</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose a picture" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void open(f, f.name); }} />
          </label>

          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Tool">
            <button type="button" className={tab(tool === 'clean')} aria-pressed={tool === 'clean'} onClick={() => pickTool('clean')}>Background &amp; size</button>
            <button type="button" className={tab(tool === 'flat')} aria-pressed={tool === 'flat'} onClick={() => pickTool('flat')}>Photo to flat art</button>
            <button type="button" className={tab(tool === 'vector')} aria-pressed={tool === 'vector'} onClick={() => pickTool('vector')}>Vectorize</button>
          </div>

          {tool === 'clean' && <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">1. Background</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={choice(bg === 'keep')} onClick={() => setBg('keep')}>Keep it</button>
                <button type="button" className={choice(bg === 'object')} disabled={!status?.background} onClick={() => setBg('object')}>Object or person</button>
                <button type="button" className={choice(bg === 'design')} disabled={!status?.background} onClick={() => setBg('design')}>Whole design</button>
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
              {choices([0, 2, 4] as const, scale, setScale, (s) => (s ? `${s}×` : 'Same size'), (s) => s > 0 && !status?.upscale)}
              {scale > 0 && <div className="flex flex-wrap gap-2">
                <button type="button" className={choice(kind === 'artwork')} onClick={() => setKind('artwork')}>Artwork or logo</button>
                <button type="button" className={choice(kind === 'photo')} onClick={() => setKind('photo')}>Photo</button>
              </div>}
              {file && scale > 0 && <p className="text-xs text-slate-500">{file.w} × {file.h} becomes {file.w * scale} × {file.h * scale} pixels.</p>}
            </fieldset>
          </>}

          {tool === 'flat' && canAi && <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">How</legend>
            {choices(['ai-best', 'ai-economy', 'free'] as const, method, (m) => { setMethod(m); setResult(null); }, (m) => (m === 'ai-best' ? `AI redraw: Best${ai ? ` (≈ ${peso(ai.prices.best)})` : ''}` : m === 'ai-economy' ? `AI redraw: Economy${ai ? ` (≈ ${peso(ai.prices.economy)})` : ''}` : 'On this PC (free)'))}
            <p className="text-xs text-slate-500">{method === 'ai-best' ? 'An online AI redraws the jersey as flat print artwork with crisp detail: no jersey shape, folds or shadows. The most detail; about 25 seconds.'
              : method === 'ai-economy' ? 'The same, with a cheaper AI: softer detail on busy art. About 20 seconds.'
              : 'Free, on this PC: straighten, clean and reduce to a few colours. Best for logos, names and numbers.'}</p>
          </fieldset>}

          {aiFlat && <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Sides</legend>
              {choices(['front', 'split', 'two', 'aiback'] as const, sides, (v) => { setSides(v); setResult(null); setSet({}); }, (v) => (v === 'front' ? 'Front only' : v === 'split' ? 'Front + back: one picture shows both' : v === 'two' ? 'Front + back: two photos' : 'Front + a back made by the AI'))}
              {sides === 'split' && <p className="text-xs text-slate-500">The picture shows the jersey's front and back: each side is taken out and redrawn (two runs).</p>}
              {sides === 'two' && <label className="block cursor-pointer rounded-lg border border-dashed border-slate-300 p-2 text-sm text-slate-600 hover:border-indigo-400">
                {backFile ? <span className="flex items-center gap-2"><img src={backFile.url} alt="The back photo" className="h-12 w-12 rounded object-cover" /> Back photo: {backFile.name} <span className="text-indigo-700">(change)</span></span> : <><b className="text-indigo-700">Choose the back photo</b> (the first picture is the front)</>}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose the back photo" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setBackFile({ blob: f, name: f.name, url: URL.createObjectURL(f) }); }} />
              </label>}
              {sides === 'aiback' && <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field label="Name on the back (optional)"><input className={inputClass} maxLength={24} value={backName} onChange={(e) => setBackName(e.target.value)} placeholder="e.g. SON-OT" /></Field>
                <Field label="Number"><input className={inputClass} inputMode="numeric" maxLength={3} value={backNumber} onChange={(e) => setBackNumber(e.target.value.replace(/\D/g, ''))} placeholder="10" /></Field>
              </div>}
              {sides === 'aiback' && <p className="text-xs text-slate-500">The AI continues the front's design over the back{backName || backNumber ? ', with the name and number' : '; leave the name and number empty for the design only'}. It always uses Best.</p>}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Shape of the artwork</legend>
              {choices(['tall', 'square', 'wide'] as const, shape, setShape, (v) => (v === 'tall' ? 'Tall (a jersey front)' : v === 'square' ? 'Square' : 'Wide'))}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removeText} onChange={(e) => setRemoveText(e.target.checked)} /> Remove names, numbers and logos</label>
              <p className="text-xs text-slate-500">The AI may still change small details: compare before and after, and try again if needed (each try is charged).</p>
            </fieldset>
          </>}

          {tool === 'flat' && !aiFlat && <>
            <p className="text-xs text-slate-500">A photo of a printed design (a shirt, a tarpaulin, paper) back to clean artwork with a few exact colours. Best for logos, names and numbers; shading in a design turns into flat bands.</p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">1. Straighten</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={straighten} onChange={(e) => { setStraighten(e.target.checked); setResult(null); }} /> The photo was taken at an angle</label>
              {straighten && <p className="text-xs text-slate-500">Drag the four dots to the corners of the design.</p>}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">2. Clean</legend>
              {choices([0, 1, 2, 3], clean, setClean, (v) => LEVELS[v]!)}
              <p className="text-xs text-slate-500">Smooths away fabric texture, print grain and camera noise.</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} /> Even out the light (a shadow across the photo)</label>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">3. Colours</legend>
              <label className="flex items-center gap-2 text-sm">How many
                <select className={`${inputClass} w-28`} value={colours} onChange={(e) => setColours(Number(e.target.value))} aria-label="How many colours">
                  <option value={0}>Auto</option>
                  {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="text-sm">Remove specks</div>
              {choices([0, 1, 2, 3], specks, setSpecks, (v) => SPECKS[v]!)}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clearBg} onChange={(e) => setClearBg(e.target.checked)} /> Make the background clear</label>
            </fieldset>
          </>}

          {tool === 'vector' && <>
            <p className="text-xs text-slate-500">Traces the picture into shapes that stay sharp at any size. Best on flat designs: run a photo through Photo to flat art first.</p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">1. Style</legend>
              {choices((canAi ? ['colour', 'full', 'cutter', 'ai'] : ['colour', 'full', 'cutter']) as ('colour' | 'full' | 'cutter' | 'ai')[], style, setStyle, (v) => (v === 'colour' ? 'Screen print (up to 12 inks)' : v === 'full' ? 'Full colour (sublimation)' : v === 'cutter' ? 'One colour (cutter)' : `Clean vector (AI${ai ? `, ≈ ${peso(ai.prices.vector)}` : ''})`))}
              <p className="text-xs text-slate-500">{style === 'ai' ? 'An online AI (Recraft) draws clean, smooth shapes with gradients, like an artist\'s vector: smaller files than tracing. SVG only.'
                : style === 'colour' ? 'Every ink as its own shapes, with films for screen printing (one page per ink).'
                : style === 'full' ? 'Detailed artwork in many colours, for sublimation and digital printing. A few seconds; files of a few MB.'
                : 'Black outlines for a vinyl or heat-transfer cutter.'}</p>
              {style === 'full' && <>
                <div className="text-sm">Colours</div>
                {choices([16, 32, 64] as const, fullColours as 16 | 32 | 64, setFullColours, (v) => (v === 16 ? '16 (smaller file)' : v === 32 ? '32' : '64 (most detail)'))}
              </>}
              {style === 'colour' && <label className="flex items-center gap-2 text-sm">Colours
                <select className={`${inputClass} w-28`} value={vColours} onChange={(e) => setVColours(Number(e.target.value))} aria-label="How many colours">
                  <option value={0}>Auto</option>
                  {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>}
              {style === 'cutter' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Cut the light parts instead of the dark</label>}
            </fieldset>
            {style !== 'ai' && <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">2. Shapes</legend>
              <div className="text-sm">Remove specks</div>
              {choices([0, 1, 2, 3], vSpecks, setVSpecks, (v) => SPECKS[v]!)}
              <div className="text-sm">Corners</div>
              {choices(['smooth', 'sharp'] as const, edges, setEdges, (v) => (v === 'smooth' ? 'Smooth curves' : 'Sharp (text, numbers)'))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">3. Print size</legend>
              <label className="flex items-center gap-2 text-sm">Width <input className={`${inputClass} w-24`} inputMode="decimal" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} aria-label="Printed width in centimetres" /> cm
                {file && Number(widthCm) > 0 && <span className="text-xs text-slate-500">× {(Number(widthCm) * file.h / file.w).toFixed(1)} cm high</span>}
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror it (heat-transfer vinyl is cut mirrored)</label>
            </fieldset>
            </>}
          </>}

          <Button tone="primary" disabled={!file || nothing || !ready || !!busy} onClick={doIt}>{busy ? 'Working…' : aiPrice !== null ? `Do it (≈ ${peso(aiPrice)})` : 'Do it'}</Button>
          {busy && <p role="status" className="text-sm text-indigo-700">{busy}</p>}
          {error && <Notice>{error}</Notice>}
        </div>

        <div className="min-w-0 space-y-3">
          {!file && <div className="grid h-80 place-items-center rounded-xl bg-white text-sm text-slate-500 ring-1 ring-slate-200/70">The picture shows here.</div>}
          {file && !result && (
            <ZoomFrame key={file.url} w={file.w} h={file.h}>
              {(layer, z) => <>
                <img src={file.url} alt="The picture" onClick={pick} style={layer} className={`absolute inset-0 h-full w-full object-contain ${tool === 'clean' && bg === 'colour' ? 'cursor-crosshair' : ''}`} />
                {tool === 'flat' && straighten && <CornerHandles layer={layer} z={z} corners={corners} onChange={setCorners} />}
              </>}
            </ZoomFrame>
          )}
          {file && result && (
            <>
              {/* Before and after: drag the handle across. The handle stays where it is while zooming. */}
              <ZoomFrame key={result.url} w={result.w} h={result.h}>
                {(layer) => <>
                  <img src={result.url} alt="After" style={layer} className="absolute inset-0 h-full w-full object-contain" />
                  {/* Both in the same frame, so they line up whatever their sizes. */}
                  <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                    <img src={file.url} alt="Before" style={layer} className="absolute inset-0 h-full w-full object-contain" />
                  </div>
                  <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-indigo-600" style={{ left: `${split}%` }} />
                  <span className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white">Before</span>
                  <span className="pointer-events-none absolute right-2 top-2 rounded bg-indigo-600 px-2 py-0.5 text-xs text-white">After</span>
                </>}
              </ZoomFrame>
              <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Before and after" className="w-full" />

              {result.kind === 'png' && <>
                <div className="flex flex-wrap items-center gap-3">
                  <a href={result.url} download={fileName} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Download PNG</a>
                  {tool === 'flat'
                    ? <Button disabled={!!busy} onClick={() => { void open(result.blob, fileName).then(() => pickTool('vector')); }}>Vectorize this</Button>
                    : <Button disabled={!!busy} onClick={() => void open(result.blob, fileName)}>Keep working on the result</Button>}
                  {aiFlat && <Button disabled={!!busy} onClick={() => { void open(result.blob, fileName).then(() => { pickTool('clean'); setBg('keep'); setScale(4); setKind('artwork'); }); }}>Make it bigger 4×</Button>}
                  {aiFlat && aiPrice !== null && <Button disabled={!!busy} onClick={() => void runAiRedraw()}>Try again (≈ {peso(aiPrice)})</Button>}
                  {tool === 'flat' && straighten && <Button disabled={!!busy} onClick={() => setResult(null)}>Move the corners</Button>}
                  <span className="text-sm text-slate-500">{result.w} × {result.h} pixels · {result.blob.size < 1024 * 1024 ? `${Math.max(1, Math.round(result.blob.size / 1024))} KB` : `${(result.blob.size / 1024 / 1024).toFixed(1)} MB`}</span>
                </div>
                {canAi && set.front && <JerseySetPanel set={set} shown={result.url} onShow={showItem} garment={garment} onGarment={setGarment}
                  mockupPrice={ai?.prices.best ?? null} busy={!!busy} onMockup={() => void runMockup()} />}
                {flatColours && <Palette colours={flatColours} paint={paint} onPaint={setPaint} />}
                {flatColours && <div className="flex flex-wrap gap-2">
                  <Button tone="primary" disabled={!repainted || !!busy} onClick={() => void runFlat({ palette: flatColours.map((c) => c.hex), paint })}>Apply the colours</Button>
                  {repainted && <Button onClick={() => setPaint(flatColours.map((c) => c.paint))}>Undo the colour changes</Button>}
                </div>}
                <AttachToJobOrder me={me} blob={result.blob} name={fileName} />
              </>}

              {result.kind === 'vector' && <>
                {result.info.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
                <div className="flex flex-wrap items-center gap-3">
                  {result.files.map((f, i) => <a key={f.name} href={f.url} download={f.name} className={i === 0 ? 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700' : 'rounded-md bg-white px-4 py-2 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50'}>Download {f.label}</a>)}
                  <span className="text-sm text-slate-500">{result.costPeso !== undefined ? `Clean vector by the online AI · ${result.info.shapes} shapes · cost ${peso(result.costPeso)}` : `${result.info.widthCm} × ${result.info.heightCm} cm · ${result.info.shapes} shapes`}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {result.info.colours.slice(0, 12).map((c, i) => <span key={c.hex} className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1 ring-1 ring-slate-200"><span className="size-4 rounded-full ring-1 ring-slate-300" style={{ background: `#${c.hex}` }} />{style === 'colour' ? `Ink ${i + 1}` : style === 'full' ? 'Colour' : 'Cut'} #{c.hex.toUpperCase()} · {c.share}%</span>)}
                  {result.info.colours.length > 12 && <span className="px-2 py-1 text-slate-500">and {result.info.colours.length - 12} more colours</span>}
                </div>
                {result.files.find((f) => f.name.endsWith('.pdf')) && <AttachToJobOrder me={me} blob={result.files.find((f) => f.name.endsWith('.pdf'))!.blob} name={result.files.find((f) => f.name.endsWith('.pdf'))!.name} />}
              </>}
            </>
          )}
        </div>
      </div>
      {canAi && ai && <AiSettingsCard me={me} ai={ai} onSaved={loadAi} />}
    </div>
  );
}

/** Front, back and mockup of one jersey: each opens in the view above, downloads, and makes a mockup from them. */
function JerseySetPanel({ set, shown, onShow, garment, onGarment, mockupPrice, busy, onMockup }: {
  set: JerseySet; shown: string; onShow: (it: SetItem, label: 'front' | 'back' | 'mockup') => void; garment: Garment; onGarment: (g: Garment) => void;
  mockupPrice: number | null; busy: boolean; onMockup: () => void;
}) {
  const parts = (['front', 'back', 'mockup'] as const).filter((k) => set[k]);
  return (
    <section className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200/70" aria-label="Front, back and mockup">
      <div className="flex flex-wrap gap-3">
        {parts.map((k) => { const it = set[k]!; return (
          <figure key={k} className={`w-36 space-y-1 rounded-lg p-1.5 ring-1 ${shown === it.url ? 'ring-indigo-500' : 'ring-slate-200'}`}>
            <button type="button" className="block w-full" onClick={() => onShow(it, k)} aria-label={`Show the ${k}`}><img src={it.url} alt={`The ${k}`} className="h-40 w-full rounded object-contain" style={checker} /></button>
            <figcaption className="flex items-center justify-between text-xs"><b className="capitalize">{k}</b><a href={it.url} download={`${k}.png`} className="text-indigo-700 hover:underline">Download</a></figcaption>
          </figure>
        ); })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Mockup on a</span>
        <select className="rounded-md border-slate-300 py-1 text-sm" value={garment} onChange={(e) => onGarment(e.target.value as Garment)} aria-label="Garment for the mockup">
          {(Object.keys(GARMENTS) as Garment[]).map((g) => <option key={g} value={g}>{GARMENTS[g]}</option>)}
        </select>
        <Button disabled={busy || mockupPrice === null} onClick={onMockup}>{`Make a mockup${mockupPrice !== null ? ` (≈ ${peso(mockupPrice)})` : ''}`}</Button>
        <span className="text-xs text-slate-500">{set.back ? 'Front and back views side by side.' : 'The front view (redraw a back too for both views).'}</span>
      </div>
    </section>
  );
}

/** The online AI's key (write-only), monthly limit and peso rate, this month's spending, and the latest runs (owner). */
function AiSettingsCard({ me, ai, onSaved }: { me: Me; ai: AiInfo; onSaved: () => void }) {
  const [cap, setCap] = useState(String(ai.capPeso));
  const [rate, setRate] = useState(String(ai.ratePeso));
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setCap(String(ai.capPeso)); setRate(String(ai.ratePeso)); }, [ai.version]);
  const save = async () => {
    setMsg(''); setErr('');
    const res = await fetch('/api/img/ai', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
      body: JSON.stringify({ capPeso: Number(cap), ratePeso: Number(rate), version: ai.version, ...(key.trim() ? { apiKey: key.trim() } : {}) }) });
    const body = await res.json().catch(() => null) as { message?: string } | null;
    if (!res.ok) return setErr(body?.message ?? 'The settings could not be saved.');
    setKey(''); setMsg('Saved.'); onSaved();
  };
  const used = ai.capPeso > 0 ? Math.min(100, (ai.spentPeso / ai.capPeso) * 100) : 100;
  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70" aria-label="Online AI settings">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Online AI (paid per picture)</h2>
        <span className="text-sm text-slate-600">This month: <b>{peso(ai.spentPeso)}</b> of {peso(ai.capPeso)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${used >= 90 ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${used}%` }} /></div>
      <p className="text-xs text-slate-500">Prices now: AI redraw Best {peso(ai.prices.best)}, Economy {peso(ai.prices.economy)}, clean vector {peso(ai.prices.vector)} a picture (Fal.ai's US$ prices at your peso rate). A run that would pass the monthly limit is refused; failed runs cost nothing.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Fal.ai key (${ai.keySet ? 'saved' : 'not set'})`}><input className={inputClass} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai.keySet ? 'Paste a new key to replace it' : 'Paste the key from fal.ai'} /></Field>
        <Field label="Monthly limit (₱)"><input className={inputClass} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
        <Field label="Pesos per US$"><input className={inputClass} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
      </div>
      <div className="flex items-center gap-3"><Button tone="primary" onClick={() => void save()}>Save</Button>{msg && <span className="text-sm text-emerald-700">{msg}</span>}</div>
      {err && <Notice>{err}</Notice>}
      {ai.runs.length > 0 && <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">What</th><th className="pr-3">AI</th><th className="pr-3 text-right">Cost</th><th>Result</th></tr></thead>
          <tbody>{ai.runs.map((r, i) => <tr key={`${r.at}-${i}`} className="border-t border-slate-100">
            <td className="py-1 pr-3 whitespace-nowrap">{r.at.slice(0, 16).replace('T', ' ')}</td><td className="pr-3">{r.who}</td><td className="pr-3">{({ redraw: 'Redraw', back: 'Back', mockup: 'Mockup', vectorize: 'Vector' } as Record<string, string>)[r.step] ?? r.step}</td><td className="pr-3">{r.model}</td>
            <td className="pr-3 text-right tabular-nums">{peso(r.peso)}</td><td className={r.ok ? 'text-emerald-700' : 'text-red-700'}>{r.ok ? `Done in ${r.seconds}s` : `Failed: ${r.note}`}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  );
}

/** The four corners of the design on the photo, dragged into place; the dots keep their size while zooming. */
function CornerHandles({ layer, z, corners, onChange }: { layer: React.CSSProperties; z: number; corners: Corners; onChange: (c: Corners) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const move = (i: number, e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onChange(corners.map((c, k) => (k === i ? [x, y] : c)) as Corners);
  };
  return (
    <div ref={box} className="absolute inset-0" style={layer}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        <polygon points={corners.map(([x, y]) => `${x},${y}`).join(' ')} fill="rgb(79 70 229 / 0.08)" stroke="#4f46e5" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      {corners.map(([x, y], i) => (
        <span key={i} role="slider" aria-label={['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'][i]} aria-valuetext={`${Math.round(x * 100)}%, ${Math.round(y * 100)}%`} tabIndex={0}
          className="absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-indigo-600 shadow"
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, scale: String(1 / z) }}
          onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(i, e); }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.02 : 0.004;
            const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
            if (!d) return;
            e.preventDefault();
            onChange(corners.map((c, k) => (k === i ? [Math.min(1, Math.max(0, c[0] + d[0])), Math.min(1, Math.max(0, c[1] + d[1]))] : c)) as Corners);
          }} />
      ))}
    </div>
  );
}

/** The colours flat art found: each kept, made exact, made clear, or merged into another. */
function Palette({ colours, paint, onPaint }: { colours: FlatColour[]; paint: (string | null)[]; onPaint: (p: (string | null)[]) => void }) {
  const set = (i: number, p: string | null) => onPaint(paint.map((x, k) => (k === i ? p : x)));
  return (
    <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
      <div className="text-sm font-semibold">Colours found</div>
      <p className="text-xs text-slate-500">Set a colour to your exact ink, make it clear, or make it the same as another (two shades of one ink). Then Apply the colours.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {colours.map((c, i) => {
          const p = paint[i] ?? null;
          const same = colours.findIndex((_, k) => k !== i && p !== null && paint[k] === p);
          return (
            <div key={c.hex + i} className="flex items-center gap-2 rounded-lg p-1.5 ring-1 ring-slate-200">
              <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-slate-300" style={p ? { background: `#${p}` } : checker} title="Set the exact colour">
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={`#${p ?? c.hex}`} onChange={(e) => set(i, e.target.value.slice(1))} aria-label={`Exact colour for #${c.hex}`} />
              </label>
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-mono">{p ? `#${p.toUpperCase()}` : 'Clear'}{p && p !== c.hex ? <span className="text-slate-400"> (was #{c.hex.toUpperCase()})</span> : null}</div>
                <div className="text-slate-500">{c.share}% of the picture{c.background ? ' · the background' : ''}</div>
              </div>
              <select className="rounded-md border-slate-300 py-1 text-xs" value={p === null ? 'clear' : same >= 0 ? `same-${same}` : 'own'} aria-label={`What #${c.hex} becomes`}
                onChange={(e) => {
                  const v = e.target.value;
                  set(i, v === 'clear' ? null : v === 'own' ? c.hex : paint[Number(v.slice(5))] ?? null);
                }}>
                <option value="own">Its own colour</option>
                <option value="clear">Clear (no ink)</option>
                {colours.map((o, k) => (k !== i && paint[k] ? <option key={k} value={`same-${k}`}>Same as #{paint[k]!.toUpperCase()}</option> : null))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The picture's frame, zoomable: scroll to zoom where the mouse points, drag to move around, double-click to zoom in or
 * back to the whole picture. children get the style that zooms a layer; what is outside it (the before/after handle,
 * the labels) stays put.
 */
function ZoomFrame({ w, h, children }: { w: number; h: number; children: (layer: React.CSSProperties, z: number) => React.ReactNode }) {
  const frame = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);
  const size = () => ({ fw: frame.current?.clientWidth ?? 1, fh: frame.current?.clientHeight ?? 1 });
  const at = (e: { clientX: number; clientY: number }) => { const r = frame.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const zoom = (factor: number, px?: number, py?: number) => {
    const { fw, fh } = size();
    setView((v) => zoomAt(v, factor, px ?? fw / 2, py ?? fh / 2, fw, fh));
  };

  // A wheel listener that may stop the page scrolling (React's is passive).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const [px, py] = at(e); zoom(Math.exp(-e.deltaY * 0.002), px, py); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const actual = () => Math.max(1, w / size().fw); // one picture pixel to one screen pixel
  const layer: React.CSSProperties = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' };
  const tool = 'rounded-md bg-white px-2.5 py-1 text-sm ring-1 ring-slate-300 hover:bg-indigo-50 disabled:opacity-40';
  return (
    <div className="space-y-2">
      <figure ref={frame} aria-label="The picture: scroll to zoom, drag to move"
        className={`relative mx-auto max-w-full touch-none select-none overflow-hidden rounded-xl ring-1 ring-slate-200 ${view.z > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        style={{ ...checker, aspectRatio: `${w} / ${h}`, width: `min(100%, calc(70vh * ${w / h}))` }}
        onPointerDown={(e) => {
          if (e.button !== 0 || view.z <= 1) return;
          const [px, py] = at(e);
          drag.current = { px, py, x: view.x, y: view.y }; moved.current = false; setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const [px, py] = at(e);
          if (Math.abs(px - d.px) + Math.abs(py - d.py) > 3) moved.current = true;
          const { fw, fh } = size();
          setView((v) => limit({ z: v.z, x: d.x + px - d.px, y: d.y + py - d.py }, fw, fh));
        }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onClickCapture={(e) => { if (moved.current) { e.stopPropagation(); moved.current = false; } }} // a drag is not a click
        onDoubleClick={(e) => { const [px, py] = at(e); if (view.z > 1) setView(FIT); else zoom(3, px, py); }}>
        {children(layer, view.z)}
      </figure>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className={tool} onClick={() => zoom(1 / 1.5)} disabled={view.z <= 1} aria-label="Zoom out">−</button>
        <span className="w-14 text-center text-sm tabular-nums text-slate-600">{Math.round(view.z * 100)}%</span>
        <button type="button" className={tool} onClick={() => zoom(1.5)} aria-label="Zoom in">+</button>
        <button type="button" className={tool} onClick={() => setView(FIT)} disabled={view.z <= 1}>Fit</button>
        <button type="button" className={tool} onClick={() => zoom(actual() / view.z)} title="One picture pixel to one screen pixel">Actual pixels</button>
        <span className="text-xs text-slate-500">Scroll to zoom, drag to move</span>
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
