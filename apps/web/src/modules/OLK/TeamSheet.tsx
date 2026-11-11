/**
 * The team list in Excel (the owner's request, Nov 2026): a coach with a long list downloads the shop's template (the
 * players already typed come filled in), lists every player in Excel or Google Sheets, and uploads it; the players then
 * fill the form's cards to check before sending. Works on a computer and a phone. A row with something the form cannot
 * take (a size not on the list, a number with letters) is still added, with a note to fix it on the form.
 */
import { useState } from 'react';
import type { OlkGender } from '../../api.ts';
import { readSheetFile, xlsx, type SheetSpec } from '../../generic/xlsx.ts';
import type { LinkPage, PersonForm } from './OrderLinkPage.tsx';

const BACK = 'Name on the back', NUMBER = 'Number', FULL = 'Full name (optional)', GENDER = 'Gender (Female or Male)';
const CUSTOM_WORDS = 'Custom fit';
const MAX_PLAYERS = 500;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The template's columns: the player, then each item's how many and size, then the measurements custom fits and made-to-measure items need. */
function columns(link: LinkPage) {
  const names = link.items.map((it) => it.name);
  const label = (it: LinkPage['items'][number]) => (names.filter((n) => n === it.name).length > 1 ? `${it.name} (item ${it.lineNo})` : it.name);
  const need = new Set(link.items.filter((it) => it.sizing === 'measure' || it.customFit).flatMap((it) => it.fields));
  return {
    items: link.items.map((it) => ({ it, qty: `${label(it)}: how many`, size: it.sizing === 'size' ? `${label(it)}: size` : null })),
    measures: link.guide.filter((g) => need.has(g.key)).map((g) => ({ g, head: `${g.label} (inches)` })),
  };
}

/** The template for this link: the players already on the form (with a name on the back) come filled in. */
export function teamSheet(link: LinkPage, people: PersonForm[], custom: string): SheetSpec {
  const cols = columns(link);
  const header = [BACK, NUMBER, FULL, GENDER, ...cols.items.flatMap((c) => (c.size ? [c.qty, c.size] : [c.qty])), ...cols.measures.map((m) => m.head)];
  const rows = people.filter((p) => p.backName.trim()).map((p) => [
    p.backName.trim().toUpperCase(), p.number, p.name, p.gender === 'female' ? 'Female' : p.gender === 'male' ? 'Male' : '',
    ...cols.items.flatMap(({ it, size }) => {
      const pc = p.pieces[it.lineNo] ?? { qty: '', size: '' };
      return size ? [pc.qty, pc.size === custom ? CUSTOM_WORDS : pc.size] : [pc.qty];
    }),
    ...cols.measures.map((m) => p.measures[m.g.key] ?? ''),
  ]);
  const sizeChoices = (it: LinkPage['items'][number]) => [...link.sizes.map((s) => s.label), ...(it.customFit ? [CUSTOM_WORDS] : [])];
  let col = 4;
  const lists = [{ col: 3, choices: ['Female', 'Male'] }];
  for (const c of cols.items) { col++; if (c.size) { lists.push({ col, choices: sizeChoices(c.it) }); col++; } }
  return {
    name: 'Players', header, rows, listRows: MAX_PLAYERS, lists,
    widths: header.map((h) => Math.min(30, Math.max(12, h.length + 2))),
  };
}

/** The players in an uploaded sheet, with a note for each row to fix on the form; or what is wrong with the file. */
export function peopleFromRows(link: LinkPage, rows: string[][], blank: (row: number) => PersonForm, custom: string): { people: PersonForm[]; notes: string[] } | { problem: string } {
  const at = rows.findIndex((r) => r.some((c) => norm(c) === norm(BACK)));
  if (at < 0) return { problem: "This file is not the shop's template. Download the template, list the players in it, then upload it." };
  const head = rows[at]!.map(norm);
  const find = (h: string) => head.indexOf(norm(h));
  const cols = columns(link);
  const [iBack, iNumber, iFull, iGender] = [find(BACK), find(NUMBER), find(FULL), find(GENDER)];
  const notes: string[] = [];
  const people: PersonForm[] = [];
  rows.slice(at + 1).forEach((r, i) => {
    const line = at + i + 2; // the row number Excel shows
    const get = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    if (!r.some((c) => c.trim())) return;
    if (people.length >= MAX_PLAYERS) { if (people.length === MAX_PLAYERS) notes.push(`Only the first ${MAX_PLAYERS} players were added.`); return; }
    const p = blank(people.length + 1);
    p.backName = get(iBack).toUpperCase().slice(0, 40);
    if (!p.backName) notes.push(`Row ${line} has no name on the back: type it on the form.`);
    const number = get(iNumber).replace(/\.0+$/, '');
    if (/^\d{1,3}$/.test(number)) p.number = number;
    else if (number) notes.push(`Row ${line}: "${number}" is not a number of up to 3 digits.`);
    p.name = get(iFull).slice(0, 120);
    const g = norm(get(iGender));
    const gender: OlkGender | '' = ['f', 'female', 'babae', 'woman', 'women', 'girl'].includes(g) ? 'female' : ['m', 'male', 'lalaki', 'man', 'men', 'boy'].includes(g) ? 'male' : '';
    if (g && !gender) notes.push(`Row ${line}: pick Female or Male on the form ("${get(iGender)}" is neither).`);
    p.gender = gender;
    for (const { it, qty, size } of cols.items) {
      const q = get(find(qty)).replace(/\.0+$/, '');
      const n = q === '' ? '1' : /^\d{1,3}$/.test(q) ? q : '1';
      if (q !== '' && !/^\d{1,3}$/.test(q)) notes.push(`Row ${line}: "${q}" for how many ${it.name} is not a number; 1 was put.`);
      let s = '';
      if (size) {
        const typed = get(find(size));
        const hit = link.sizes.find((x) => norm(x.label) === norm(typed));
        if (hit) s = hit.label;
        else if (typed && it.customFit && ['custom fit', 'custom'].includes(norm(typed))) s = custom;
        else if (typed) notes.push(`Row ${line}: size "${typed}" for ${it.name} is not on the shop's list; pick it on the form.`);
      }
      p.pieces[it.lineNo] = { qty: n, size: s };
    }
    for (const m of cols.measures) { const v = get(find(m.head)); if (v) p.measures[m.g.key] = v; }
    people.push(p);
  });
  if (!people.length) return { problem: 'The file has no players yet. List them under the headings, one player per row, then upload it.' };
  return { people, notes };
}

const FILE_WORDS: Record<string, string> = {
  OLD_XLS: 'This is an old Excel file (.xls). In Excel, choose Save As, then Excel Workbook (.xlsx), and upload that.',
  NOT_ZIP: 'This file could not be read. Save it as an Excel Workbook (.xlsx), or download it as .csv from Google Sheets, and upload again.',
  NO_SHEET: 'This file has no sheet with players. Use the template and upload again.',
};

export function TeamSheet({ link, people, blank, custom, onLoad }: { link: LinkPage; people: PersonForm[]; blank: (row: number) => PersonForm; custom: string; onLoad: (people: PersonForm[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [problem, setProblem] = useState('');

  const download = async () => {
    setBusy(true);
    try {
      const bytes = await xlsx(teamSheet(link, people, custom));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `${link.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Team'} - players.xlsx` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally { setBusy(false); }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setProblem(''); setDone(''); setNotes([]);
    if (file.size > 5_000_000) return setProblem('This file is too big. Keep only the players sheet and upload again.');
    setBusy(true);
    try {
      const got = peopleFromRows(link, await readSheetFile(file), blank, custom);
      if ('problem' in got) return setProblem(got.problem);
      const typed = people.filter((p) => p.backName.trim()).length;
      if (typed > 0 && !window.confirm(`Put the ${got.people.length} players in the file in place of the ${typed} on the form?`)) return;
      onLoad(got.people);
      setDone(`${got.people.length} ${got.people.length === 1 ? 'player' : 'players'} added from ${file.name}. Check them below, then send.`);
      setNotes(got.notes);
    } catch (e) {
      setProblem(FILE_WORDS[(e as Error).message] ?? FILE_WORDS.NOT_ZIP!);
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-slate-900/5" aria-label="List the players in Excel">
      <div>
        <h2 className="text-lg font-bold">A long list? Use Excel</h2>
        <p className="text-sm text-slate-600">Download the template, list one player per row in Excel or Google Sheets, then upload it here. The players fill the form below for you to check before sending.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => void download()} className="rounded-full bg-slate-100 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-200 disabled:cursor-wait">⬇ Download the Excel template</button>
        <label className={`cursor-pointer rounded-full bg-indigo-600 px-4 py-3 text-center font-semibold text-white hover:bg-indigo-700 ${busy ? 'cursor-wait opacity-60' : ''}`}>
          ⬆ Upload the filled file
          <input type="file" className="sr-only" disabled={busy} aria-label="Upload the filled Excel file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Excel workbook (.xlsx) or .csv. Sizes: {link.sizes.map((s) => s.label).join(', ')}{link.items.some((it) => it.customFit) ? `, or ${CUSTOM_WORDS}` : ''}. How many: leave it empty for 1, or type 0 for none.</p>
      {problem && <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{problem}</p>}
      {done && <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{done}</p>}
      {notes.length > 0 && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">To fix on the form:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{notes.slice(0, 20).map((n) => <li key={n}>{n}</li>)}</ul>
          {notes.length > 20 && <p className="mt-1">…and {notes.length - 20} more.</p>}
        </div>
      )}
    </section>
  );
}
