/**
 * The image tools (the owner's request, Oct 2026): free AI programs that run on the shop PC itself, so no picture leaves
 * the shop and there is no charge per picture. They are installed beside the database by tools/img/install.ps1:
 * <data>/tools/realesrgan (Real-ESRGAN, the upscaler, on the graphics card) and <data>/tools/rembg (the background
 * remover, a Python environment). One picture is worked at a time: the graphics card does one job well, not several.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppError } from '@moonproject/shared';

export type UpscaleKind = 'artwork' | 'photo';
export type Cutout = 'object' | 'design';
export interface ImageTools {
  installed(): { upscale: boolean; background: boolean };
  upscale(input: string, output: string, scale: 2 | 4, kind: UpscaleKind): Promise<void>;
  removeBackground(input: string, output: string, cutout: Cutout): Promise<void>;
}

/** The longest one picture may take before it is stopped (BiRefNet on the processor takes seconds, not minutes). */
const TIMEOUT_MS = 3 * 60_000;

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let errors = '';
    child.stderr.on('data', (d: Buffer) => { errors = (errors + d.toString()).slice(-2000); });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new AppError('IMG_FAILED', `The image tool stopped with an error${errors ? `: ${errors.split('\n').filter(Boolean).at(-1)}` : ''}. Try a smaller picture or another option.`, 500));
    });
  });
}

/** The tools folder: MOONPROJECT_IMG_TOOLS, else "tools" beside the database (the practice shop's: beside the real one). */
export function toolsDir(dbFile: string): string {
  const env = process.env.MOONPROJECT_IMG_TOOLS;
  if (env) return env;
  const beside = join(dirname(dbFile), 'tools');
  const above = join(dirname(dirname(dbFile)), 'tools');
  return existsSync(beside) || !existsSync(above) ? beside : above;
}

export function localTools(dir: string): ImageTools {
  const esr = join(dir, 'realesrgan', 'realesrgan-ncnn-vulkan.exe');
  const py = join(dir, 'rembg', 'env', 'Scripts', 'python.exe');
  const remover = join(dir, 'rembg', 'remove.py');
  return {
    installed: () => ({ upscale: existsSync(esr), background: existsSync(py) && existsSync(remover) }),
    // Artwork: the model for drawn graphics (crisp edges, flat colour); photo: the general one.
    upscale: (input, output, scale, kind) =>
      run(esr, ['-i', input, '-o', output, '-n', kind === 'artwork' ? 'realesr-animevideov3' : 'realesrgan-x4plus', '-s', String(scale)], dirname(esr)),
    removeBackground: (input, output, cutout) => run(py, [remover, input, output, cutout], dirname(remover)),
  };
}

/** One picture at a time; at most WAITING more wait their turn, then "busy" (a picture takes seconds). */
export const WAITING = 4;
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
export function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (waiting >= WAITING) throw new AppError('IMG_BUSY', 'The image tools are busy with other pictures. Try again in a minute.', 503);
  waiting++;
  const mine = queue.then(work).finally(() => { waiting--; });
  queue = mine.catch(() => undefined);
  return mine;
}
export const queueLength = () => waiting;
