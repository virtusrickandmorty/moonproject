import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const pw = JSON.parse(readFileSync('C:/Users/jptin/AppData/Local/Temp/claude/c--moonproject/9547155f-ab91-4680-8d79-56a94b8fe091/scratchpad/shop5/practice-passwords.json', 'utf8'));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 1300 } });
await p.goto('http://127.0.0.1:3100/');
await p.getByLabel('Username').fill('practice-owner'); await p.getByLabel('Password').fill(pw.owner);
await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForSelector('main');
const pack = await p.evaluate(() => fetch('/api/prt/test-pack').then((r) => r.json()));
console.log(pack.prints.map((x) => x.id).join(' '));
const v = await b.newPage({ viewport: { width: 900, height: 1250 } });
for (const x of pack.prints) { writeFileSync('C:/Users/jptin/AppData/Local/Temp/claude/c--moonproject/9547155f-ab91-4680-8d79-56a94b8fe091/scratchpad/prints/' + x.id + '.html', x.html); await v.setContent(x.html); await v.waitForTimeout(150); await v.screenshot({ path: 'C:/Users/jptin/AppData/Local/Temp/claude/c--moonproject/9547155f-ab91-4680-8d79-56a94b8fe091/scratchpad/prints/' + x.id + '.png', fullPage: true }); }
await b.close();
