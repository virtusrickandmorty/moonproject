import { useEffect, useState } from 'react';
import { api, type PrinterTestPack } from '../../api.ts';
import { Button, Notice, Panel } from '../../components/ui.tsx';

const CHECKS_KEY = 'moonproject.printer-test-pack.checked';

export function openTestPrint(html: string): void {
  const page = window.open('', '_blank');
  if (!page) throw new Error('Allow a new window to print this test page.');
  page.document.write(html);
  page.document.close();
  page.onload = () => page.print();
}

/** Keep the first print's stylesheet and put every A4 sheet in one print job, in catalogue order. */
export function combineA4(prints: PrinterTestPack['prints']): string {
  const pages = prints.filter((p) => p.paper.startsWith('A4'));
  if (!pages.length) return '';
  const style = pages[0]!.html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
  const sheets = pages.map((p) => p.html.match(/<div class="sheet[^>]*">[\s\S]*<\/div><\/body>/)?.[0]?.replace(/<\/body>$/, '') ?? '').join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Printer test pack · A4</title>${style}</head><body>${sheets}</body></html>`;
}

export function PrinterTestPackScreen() {
  const [pack, setPack] = useState<PrinterTestPack | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    api.printerTestPack().then(setPack, (e: Error) => setError(e.message));
    try { setChecked(JSON.parse(localStorage.getItem(CHECKS_KEY) ?? '{}') as Record<string, boolean>); } catch { setChecked({}); }
  }, []);
  const mark = (id: string, value: boolean) => setChecked((old) => {
    const next = { ...old, [id]: value };
    localStorage.setItem(CHECKS_KEY, JSON.stringify(next));
    return next;
  });
  const print = (html: string) => { try { openTestPrint(html); } catch (e) { setError((e as Error).message); } };
  return <div className="max-w-4xl space-y-4">
    <div><h1 className="text-2xl font-semibold">Printer test pack</h1>
      <p className="text-sm text-slate-600">Print every sample on the shop printers before go-live. These made-up samples do not record anything or use a real document number.</p></div>
    {error && <Notice>{error}</Notice>}
    {!pack ? !error && <p>Loading…</p> : <>
      <Button tone="primary" onClick={() => print(combineA4(pack.prints))}>Print all A4</Button>
      <Panel title="Print checklist"><div className="divide-y divide-slate-200">
        {pack.prints.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-60 flex-1"><strong>{item.label}</strong><div className="text-sm text-slate-500">{item.paper}</div></div>
          <Button onClick={() => print(item.html)}>Print</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!checked[item.id]} onChange={(e) => mark(item.id, e.target.checked)} />Printed well</label>
        </div>)}
      </div></Panel>
      <Panel title="Not built"><ul className="list-disc space-y-1 pl-5 text-sm">{pack.notBuilt.map((name) => <li key={name}>{name} — not built</li>)}</ul></Panel>
    </>}
  </div>;
}
