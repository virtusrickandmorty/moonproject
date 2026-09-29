/**
 * npm run compare-blind -- <their.csv> [--app <app.csv>] [--write-app <app.csv>]
 * Compares a reviewer's journals for the month (the blind-recompute CSV, tools/blind.ts) with the app's, and prints
 * each difference in plain words. The app's journals come from running the month on a fresh in-memory shop, or from
 * a CSV written earlier with --write-app. Exits 0 when they agree to the centavo, 1 on any difference, 2 when a file
 * cannot be read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chartNames, compareJournals, parseCsv, toCsv, type BlindRow } from './blind.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function appJournals(): Promise<BlindRow[]> {
  const { asBlindRows, runMonth } = await import('./month-scenario.ts');
  const m = await runMonth();
  const rows = asBlindRows(await m.journals());
  await m.env.app.close();
  return rows;
}

async function main(args: string[]): Promise<number> {
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const appFile = opt('--app');
  const writeApp = opt('--write-app');
  const theirFile = args[0];
  if (!theirFile && !writeApp) {
    console.error('Usage: npm run compare-blind -- <their.csv> [--app <app.csv>] [--write-app <app.csv>]');
    return 2;
  }
  let app: BlindRow[];
  let theirs: BlindRow[] = [];
  try {
    app = appFile ? parseCsv(readFileSync(appFile, 'utf8')) : await appJournals();
    if (theirFile) theirs = parseCsv(readFileSync(theirFile, 'utf8'));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  if (writeApp) {
    writeFileSync(writeApp, toCsv(app));
    console.log(`Wrote the app's journals to ${writeApp}.`);
  }
  if (!theirFile) return 0;
  const diffs = compareJournals(app, theirs, chartNames(ROOT));
  if (diffs.length === 0) {
    console.log(`No differences: ${new Set(app.map((r) => r.docRef)).size} journals, ${app.length} lines agree to the centavo.`);
    return 0;
  }
  console.log(`${diffs.length} difference${diffs.length === 1 ? '' : 's'}:`);
  for (const d of diffs) console.log(`- ${d}`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
