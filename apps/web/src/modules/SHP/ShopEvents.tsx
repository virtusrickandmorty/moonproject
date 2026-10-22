/**
 * The shop's own events for the website's decorations (the owner's request, Oct 2026: "a custom decoration for our own
 * event"): its dates, the banner's words, a colour theme, the shop's own picture or a season's drawing, what drifts over
 * the banner, the cards' doodles and the banner's button. While Decorations is Automatic, an event on today's date shows
 * instead of the season (server: SHP season-events.ts). Hidden rather than deleted.
 */
import { useState } from 'react';
import type { Me } from '../../api.ts';
import { Button, Dialog, Field, Notice, inputClass, useAction } from '../../components/ui.tsx';
import { Doodles, SEASONS, Shower, THEMES, eventLook, eventPictureUrl, type ShopEventShown } from '../../shop/seasons.tsx';
import { masterRequest } from '../CUS/http.ts';
import { MAX_PICKED_BYTES, lighterPhoto } from './photo.ts';

export type ShopEvent = ShopEventShown & { name: string; startsOn: string; endsOn: string; isActive: boolean };

const ARTS: [ShopEventShown['art'], string][] = [
  ['picture', 'Our own picture'], ['none', 'No picture (a garment shows)'],
  ...(Object.keys(SEASONS) as (keyof typeof SEASONS)[]).map((k) => [k, `The ${k === 'valentines' ? "Valentine's" : k === 'school' ? 'back to school' : k} drawing`] as [ShopEventShown['art'], string]),
];
const SHOWERS: [ShopEventShown['shower'], string][] = [
  ['confetti', 'Confetti falling'], ['stars', 'Stars twinkling'], ['hearts', 'Hearts rising'], ['snow', 'Snow falling'], ['bats', 'Bats flying'], ['none', 'Nothing'],
];
const DOODLE_SETS: [ShopEventShown['doodles'], string][] = [
  ['party', 'Party: stars, balloons, gifts'], ['halloween', 'Halloween'], ['christmas', 'Christmas'], ['valentines', "Valentine's"], ['summer', 'Summer'], ['school', 'Back to school'], ['none', 'No doodles'],
];
const BUTTONS: [ShopEventShown['button'], string][] = [
  ['quote', 'Ask for a quotation'], ['made', 'Made-to-order garments'], ['ready', 'Ready-to-wear garments'], ['services', 'Our services page'],
];
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const longDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

type Form = Omit<ShopEvent, 'id' | 'version' | 'hasPicture'> & { picture?: string | null };
const blank = (): Form => ({
  name: '', startsOn: manilaToday(), endsOn: manilaToday(), eyebrow: '', title: '', highlight: '', text: '', barText: '',
  theme: 'gold', art: 'none', shower: 'confetti', doodles: 'party', button: 'quote', buttonLabel: 'Get a quote', isActive: true,
});

export function ShopEvents({ me, events, today, onSaved }: { me: Me; events: ShopEvent[]; today: string | null; onSaved: () => void }) {
  const [open, setOpen] = useState<ShopEvent | 'new' | null>(null);
  const can = me.permissions.includes('shp.manage');
  const day = manilaToday();
  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70" aria-label="Your own events">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Your own events</h2>
          <p className="text-sm text-slate-600">A shop anniversary, a sale weekend, a school's intramurals: while its dates are on and Decorations is <b>Automatic</b>, the event shows instead of the season.</p>
        </div>
        {can && <Button tone="primary" onClick={() => setOpen('new')}>New event</Button>}
      </div>
      {events.length === 0
        ? <p className="text-sm text-slate-500">No events yet.</p>
        : (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {events.map((e) => {
              const look = eventLook(e);
              const now = e.isActive && e.startsOn <= day && e.endsOn >= day;
              return (
                <li key={e.id} className={`flex flex-wrap items-center gap-3 p-3 ${e.isActive ? '' : 'text-slate-400'}`}>
                  <span className={`size-10 shrink-0 rounded-lg bg-gradient-to-br ${look.tone}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{e.name}
                      {now && today === e.name && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Showing now</span>}
                      {now && today !== e.name && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">On today, not shown: Decorations is not Automatic</span>}
                      {!e.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Hidden</span>}</p>
                    <p className="text-xs text-slate-500">{longDay(e.startsOn)} to {longDay(e.endsOn)} · {e.barText}</p>
                  </div>
                  <Button onClick={() => setOpen(e)}>{can ? 'Edit' : 'View'}</Button>
                </li>
              );
            })}
          </ul>)}
      {open && <EventDialog me={me} event={open === 'new' ? null : open} readOnly={!can} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onSaved(); }} />}
    </section>
  );
}

function EventDialog({ me, event, readOnly, onClose, onSaved }: { me: Me; event: ShopEvent | null; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(() => {
    if (!event) return blank();
    const { id: _id, version: _version, hasPicture: _has, ...rest } = event;
    return rest;
  });
  const { busy, error, run } = useAction();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const hasPicture = f.picture === undefined ? !!event?.hasPicture : !!f.picture;
  const pictureSrc = f.picture ?? (f.picture === undefined && event?.hasPicture ? eventPictureUrl(event) : null);
  const pick = (file: File | undefined) => void run(async () => {
    if (!file) return;
    if (file.size > MAX_PICKED_BYTES) throw new Error('The picture is bigger than 25 MB. Use a smaller one.');
    const light = await lighterPhoto(file);
    if (light.size > 1_500_000) throw new Error('The picture is too big even made lighter. Use one under 1.5 MB.');
    const uri = await new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(new Error('Could not read the picture.')); r.readAsDataURL(light); });
    setF((x) => ({ ...x, picture: uri, art: 'picture' }));
  });
  const save = () => run(async () => {
    const body = { ...f, picture: f.picture };
    if (event) await masterRequest(me, `/api/shp/season/events/${event.id}`, 'PUT', body, event.version);
    else await masterRequest(me, '/api/shp/season/events', 'POST', body);
    onSaved();
  });
  const ready = f.name.trim() && f.eyebrow.trim() && f.title.trim() && f.barText.trim() && f.buttonLabel.trim() && f.endsOn >= f.startsOn && (f.art !== 'picture' || hasPicture);
  const text = (k: 'name' | 'eyebrow' | 'title' | 'highlight' | 'barText' | 'buttonLabel', max: number, placeholder: string) =>
    <input className={inputClass} maxLength={max} value={f[k]} disabled={readOnly} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />;
  const select = <K extends 'theme' | 'art' | 'shower' | 'doodles' | 'button'>(k: K, options: [Form[K], string][]) =>
    <select className={inputClass} value={f[k]} disabled={readOnly} onChange={(e) => set(k, e.target.value as Form[K])}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;

  return (
    <Dialog title={event ? event.name : 'New event'} onClose={onClose} wide>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-3">
          <Field label="Event name (staff only)" required>{text('name', 60, 'Like: Shop anniversary 2026')}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" required><input type="date" className={inputClass} value={f.startsOn} disabled={readOnly} onChange={(e) => set('startsOn', e.target.value)} /></Field>
            <Field label="Last day" required error={f.endsOn < f.startsOn ? 'The last day cannot be before the first.' : undefined}><input type="date" className={inputClass} value={f.endsOn} disabled={readOnly} onChange={(e) => set('endsOn', e.target.value)} /></Field>
          </div>
          <Field label="Small words above the title" required>{text('eyebrow', 40, 'Like: 4th anniversary')}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title" required>{text('title', 40, 'Like: Thank you,')}</Field>
            <Field label="Second line, in colour">{text('highlight', 40, 'Like: Silang!')}</Field>
          </div>
          <Field label="What to say">
            <textarea className={inputClass} rows={2} maxLength={220} value={f.text} disabled={readOnly} placeholder="Like: 10% off made-to-order jerseys this weekend." onChange={(e) => set('text', e.target.value)} />
          </Field>
          <Field label="Line in the top bar" required>{text('barText', 90, 'Like: Anniversary weekend: 10% off jerseys')}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Colours">{select('theme', Object.entries(THEMES).map(([k, t]) => [k as Form['theme'], t.label]))}</Field>
            <Field label="Picture on the banner">{select('art', ARTS)}</Field>
          </div>
          {f.art === 'picture' && !readOnly && (
            <Field label="Our picture" required hint="JPEG, PNG or WebP; shown in a circle. A square picture fits best.">
              <div className="flex flex-wrap items-center gap-2">
                <input type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => pick(e.target.files?.[0])} />
                {hasPicture && <Button onClick={() => setF((x) => ({ ...x, picture: null, art: 'none' }))}>Take the picture away</Button>}
              </div>
            </Field>)}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Over the banner">{select('shower', SHOWERS)}</Field>
            <Field label="Doodles on the cards">{select('doodles', DOODLE_SETS)}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="The button opens">{select('button', BUTTONS)}</Field>
            <Field label="Button words" required>{text('buttonLabel', 30, 'Like: Get a quote')}</Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} disabled={readOnly} onChange={(e) => set('isActive', e.target.checked)} /> Show on its dates (untick to hide it)</label>
        </div>
        <Preview f={f} pictureSrc={f.art === 'picture' ? pictureSrc : null} />
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && <Button tone="primary" disabled={busy || !ready} onClick={() => void save()}>{event ? 'Save' : 'Add event'}</Button>}
      </div>
    </Dialog>
  );
}

/** How the website will look: the top bar, the banner slide and a card with its doodles. */
function Preview({ f, pictureSrc }: { f: Form; pictureSrc: string | null }) {
  const look = eventLook({ ...f, id: '', version: 0, hasPicture: false });
  const art = f.art === 'picture'
    ? (pictureSrc ? <div className="size-full overflow-hidden rounded-full bg-white ring-4 ring-white/15"><img src={pictureSrc} alt="" className="size-full object-cover" /></div> : null)
    : look.art();
  return (
    <div className="space-y-2" aria-label="Preview">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        <p className={`px-3 py-1.5 text-center text-xs font-medium ${look.bar}`}>{f.barText || 'The line in the top bar'}</p>
        <div className={`relative overflow-hidden bg-gradient-to-br ${look.tone} text-white`}>
          {look.shower && <Shower kind={look.shower} />}
          <div className="relative grid grid-cols-[1.3fr_1fr] items-center gap-3 p-5">
            <div>
              <p className="inline-flex rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/15">{f.eyebrow || 'Small words'}</p>
              <p className="mt-3 text-2xl font-extrabold leading-tight tracking-tight">{f.title ? look.title : 'The title'}</p>
              {f.text && <p className="mt-2 text-xs text-white/70">{f.text}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-900">{f.buttonLabel || 'Button'}</span>
                <span className="rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-white/30">{look.ghost[1]}</span>
              </div>
            </div>
            <div className="aspect-square w-full">{art}</div>
          </div>
        </div>
        {f.doodles !== 'none' && (
          <div className="relative h-24 bg-slate-50">
            <div className="relative mx-auto mt-3 h-20 w-40 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
              <Doodles set={f.doodles} seed={3} spots={['tr', 'bl']} size="size-8" />
              <p className="absolute inset-x-0 bottom-2 text-center text-[10px] text-slate-400">A garment card</p>
            </div>
          </div>)}
      </div>
    </div>
  );
}
