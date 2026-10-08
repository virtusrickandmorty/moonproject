/** Build the one-volume manual from the owner guides; no new dependency or running shop needed. */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const guidesDir = resolve(root, 'docs/owner-guide');
const read = (path) => readFile(resolve(root, path), 'utf8');
const files = (await readdir(guidesDir)).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
if (files.length !== 63) throw new Error('Expected exactly 63 numbered owner guides; review the book structure.');
const guides = new Map(await Promise.all(files.map(async (file) => [Number(file.slice(0, 2)), await readFile(resolve(guidesDir, file), 'utf8')])));
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const seen = new Set();
let markdown = await read('docs/manual/manual.md');
markdown = markdown.replace(/\{\{guide:(\d+)\}\}/g, (_, n) => {
  const number = Number(n);
  if (seen.has(number) || !guides.has(number)) throw new Error(`Duplicate or missing guide ${n}`);
  seen.add(number);
  return guides.get(number).replace(/^# \d+\. (.+)$/m, `## Guide ${n.padStart(2, '0')}. $1`);
});
if (seen.size !== guides.size) throw new Error('Every guide must appear exactly once.');

// Read the actual menu and registered document titles. No hand-maintained screen inventory.
const menu = await read('apps/web/src/shell/menu.ts');
const groups = ['Sales', 'Money', 'Reports', 'Purchases & Expenses', 'People & Payroll', 'Production', 'Accounting & Tax', 'Admin', 'Overview'];
const screens = new Map(groups.map((g) => [g, new Set()]));
for (const m of menu.matchAll(/group: '([^']+)', label: (?:'([^']+)'|"([^"]+)"), path:/g)) screens.get(m[1]).add(m[2] ?? m[3]);
const moduleGroup = new Map();
for (const m of menu.matchAll(/\['([^']+)', '([A-Z ]+)'\]/g)) for (const code of m[2].split(' ')) moduleGroup.set(code, m[1]);
const titles = new Map();
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory() && !['tests', 'migrations'].includes(entry.name)) await walk(path);
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      const s = await readFile(path, 'utf8');
      for (const m of s.matchAll(/key:\s*'([^']+)'\s*,\s*module:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'/g)) titles.set(m[1], { module: m[2], title: m[3] });
    }
  }
}
await walk(resolve(root, 'apps/server/src/modules'));
const overrides = new Map([...menu.matchAll(/'([^']+)': \['[^']+', '([^']+)'\]/g)].map((m) => [m[1], m[2]]));
for (const [key, d] of titles) {
  const group = moduleGroup.get(d.module);
  if (!group) throw new Error(`No menu group for ${key}`);
  screens.get(group).add(overrides.get(key) ?? (/[sy]$/.test(d.title) ? d.title : `${d.title}s`));
}
if (titles.size < 50) throw new Error('Document menu discovery is incomplete; review the source format.');
const chapterFor = { 'Purchases & Expenses': 'purchases-and-expenses', 'People & Payroll': 'people-and-payroll', 'Accounting & Tax': 'accounting-and-tax', Admin: 'admin-and-safety', Overview: 'admin-and-safety' };
markdown = markdown.replace('{{screens}}', groups.map((g) => `## ${g}\n\n${[...screens.get(g)].sort().map((s) => {
  const guide = [...guides].find(([, text]) => text.includes(`**${s}**`));
  return guide ? `- [${s}](guide:${guide[0]}) — guide ${guide[0]}` : `- [${s}](#${chapterFor[g] ?? slug(g)}) — chapter`;
}).join('\n')}`).join('\n\n'));

const imageNames = [...markdown.matchAll(/!\[[^\]]*\]\((img\/[^)]+)\)/g)].map((m) => m[1]);
const images = new Map(await Promise.all([...new Set(imageNames)].map(async (name) => {
  if (!/^img\/[\w-]+\.png$/.test(name)) throw new Error(`Unexpected image path: ${name}`);
  const data = await readFile(resolve(guidesDir, name));
  return [name, `data:image/png;base64,${data.toString('base64')}`];
})));
const contents = [];
const ids = new Set();
function link(target) {
  const guide = target.match(/^(?:guide:|(?:\.\.\/owner-guide\/)?)(\d+)(?:-|$)/);
  if (guide) return `#guide-${Number(guide[1])}`;
  if (target.startsWith('#') || /^https?:\/\//.test(target)) return target;
  throw new Error(`Unsupported link: ${target}`);
}
function inline(s) {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  s = s.replace(/`([^`]+)`/g, (_, t) => keep(`<code>${escape(t)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => keep(`<a href="${escape(link(href))}">${escape(t)}</a>`));
  s = escape(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}
// The source uses headings, paragraphs, nested lists, images, emphasis and links only.
function render(s) {
  const out = [];
  const lists = [];
  const close = () => { while (lists.length) out.push(`</li></${lists.pop().tag}>`); };
  for (const line of s.split(/\r?\n/)) {
    if (!line.trim()) { close(); continue; }
    const heading = line.match(/^(#{1,4}) (.+)$/);
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    const item = line.match(/^(\s*)(?:(\d+)\.|[-*]) (.+)$/);
    if (heading) {
      close();
      const level = heading[1].length;
      const guide = heading[2].match(/^Guide (\d+)\./);
      let id = guide ? `guide-${Number(guide[1])}` : slug(heading[2]);
      const base = id;
      for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
      ids.add(id);
      if (level === 1 || guide) contents.push({ id, title: heading[2], level });
      out.push(`<h${level} id="${id}"${guide ? ' class="guide"' : ''}>${inline(heading[2])}</h${level}>`);
    } else if (img) {
      if (!images.has(img[2])) throw new Error(`Missing screenshot ${img[2]}`);
      out.push(`<figure><img src="${images.get(img[2])}" alt="${escape(img[1])}"><figcaption>${escape(img[1])} · Owner-guide screenshot</figcaption></figure>`);
    } else if (item) {
      const indent = item[1].length;
      const tag = item[2] ? 'ol' : 'ul';
      while (lists.length && (lists.at(-1).indent > indent || (lists.at(-1).indent === indent && lists.at(-1).tag !== tag))) out.push(`</li></${lists.pop().tag}>`);
      if (!lists.length || lists.at(-1).indent < indent) { out.push(`<${tag}>`); lists.push({ indent, tag }); }
      else out.push('</li>');
      out.push(`<li${item[2] ? ` value="${item[2]}"` : ''}>${inline(item[3])}`);
    } else {
      close();
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  close();
  return out.join('\n');
}
const body = render(markdown);
const tocGroups = [];
for (const h of contents) {
  if (h.level === 1) tocGroups.push([]);
  tocGroups.at(-1).push(`<a class="toc-${h.level}" href="#${h.id}">${escape(h.title)}</a>`);
}
const toc = tocGroups.map((items) => `<div class="toc-group">${items.join('')}</div>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moonproject — User manual</title><style>
@page { size: A4; }
* { box-sizing: border-box; }
body { margin: 0; color: #182536; font: 10.5pt/1.45 Arial, sans-serif; }
h1 { break-before: page; font-size: 27pt; line-height: 1.12; color: #24396a; border-bottom: 2pt solid #6c80b2; padding-bottom: 12pt; margin: 0 0 20pt; }
h2 { font-size: 16pt; line-height: 1.2; color: #24396a; margin: 19pt 0 10pt; }
h3 { font-size: 12pt; margin: 16pt 0 7pt; }
h4 { font-size: 11pt; margin: 12pt 0 5pt; }
h1,h2,h3,h4 { break-after: avoid; }
h2.guide { break-before: page; }
h1 + h2.guide { break-before: auto; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
ul,ol { padding-left: 20pt; margin: 5pt 0 10pt; }
li { margin: 0 0 6pt; orphans: 3; widows: 3; }
a { color: #284d8a; text-decoration: none; }
code { font-size: 9pt; overflow-wrap: anywhere; }
figure { margin: 12pt 0 15pt; break-inside: avoid; }
figure img { display: block; width: 100%; max-height: 125mm; object-fit: contain; object-position: left; border: .5pt solid #d8deea; }
figcaption { font-size: 8.5pt; color: #50617a; margin-top: 5pt; }
.cover { padding: 38mm 0 12mm; min-height: 220mm; }
.cover h1 { break-before: auto; border: 0; font-size: 44pt; margin: 0; }
.cover .subtitle { font-size: 23pt; margin: 15pt 0 25pt; }
.cover .audience { font-size: 14pt; line-height: 1.8; }
.cover .edition { border-top: 1pt solid #6c80b2; margin-top: 30mm; padding-top: 16pt; }
.toc { columns: 2; column-gap: 8mm; }
.toc-group { break-inside: avoid; margin-bottom: 9pt; }
.toc a { display: block; break-inside: avoid; }
.toc-1 { font-weight: bold; font-size: 12pt; margin-top: 0; break-after: avoid; }
.toc-2 { padding-left: 16pt; font-size: 9.5pt; margin-top: 3pt; }
</style></head><body>
<div class="cover"><h1>Moonproject</h1><p class="subtitle">The shop's user manual</p><p class="audience">For owners, accountants, encoders<br>and production workers</p><p>From the first sign-in to the year-end books.<br>Step-by-step guides, screenshots and help when something goes wrong.</p><p class="edition">Edition: 6 October 2026<br>All 63 owner guides in one book<br>Practice examples only</p></div>
<h1 id="contents">Contents</h1><p>Click a chapter or guide to go there. Use your PDF reader's search for other screen names.</p><nav class="toc">${toc}</nav>${body}</body></html>`;
await mkdir(here, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode())); });
  const problems = await page.evaluate(() => {
    const bad = [...document.querySelectorAll('a[href^="#"]')].filter((a) => !document.getElementById(a.hash.slice(1))).map((a) => a.getAttribute('href'));
    return { bad, images: [...document.images].filter((i) => !i.naturalWidth).length };
  });
  if (problems.bad.length || problems.images) throw new Error(JSON.stringify(problems));
  await page.pdf({ path: resolve(here, 'Moonproject-Manual.pdf'), format: 'A4', printBackground: true,
    margin: { top: '17mm', right: '17mm', bottom: '19mm', left: '17mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-family:Arial;font-size:8px;width:100%;margin:0 17mm;color:#50617a;display:flex;justify-content:space-between"><span>Moonproject · User manual</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    tagged: true, outline: true });
  // Optional local review output. It is not needed to read the delivered PDF.
  if (process.env.MANUAL_REVIEW_DIR) {
    await mkdir(process.env.MANUAL_REVIEW_DIR, { recursive: true });
    await writeFile(resolve(process.env.MANUAL_REVIEW_DIR, 'manual.html'), html);
    await writeFile(resolve(process.env.MANUAL_REVIEW_DIR, 'contents.json'), JSON.stringify(contents, null, 2));
  }
  console.log(`Built docs/manual/Moonproject-Manual.pdf: ${seen.size} guides, ${imageNames.length} screenshots, ${titles.size} document types indexed.`);
} finally { await browser.close(); }
