/**
 * The image tools (the owner's request, Oct 2026): free AI programs that run on the shop PC itself, so no picture leaves
 * the shop and there is no charge per picture. They are installed beside the database by tools/img/install.ps1:
 * <data>/tools/realesrgan (Real-ESRGAN, the upscaler, on the graphics card) and <data>/tools/rembg (the background
 * remover, a Python environment, which also runs flatart.py and vectorize.py: photo to flat art, and vector files).
 * One picture is worked at a time: the graphics card does one job well, not several.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AppError } from '@moonproject/shared';

export type UpscaleKind = 'artwork' | 'photo';
export type Cutout = 'object' | 'design';
/** Photo to flat art (tools/img/flatart.py says what each does). */
export interface FlatOptions {
  corners?: [number, number][]; clean: number; light: boolean; colours: number; specks: number; clear: boolean;
  palette?: string[]; paint?: (string | null)[];
}
export interface FlatInfo { width: number; height: number; colours: { hex: string; paint: string | null; share: number; background: boolean }[] }
/** Vectorize (tools/img/vectorize.py). */
export interface VectorOptions { style: 'colour' | 'full' | 'cutter'; colours: number; specks: number; edges: 'smooth' | 'sharp'; width: number; invert: boolean; mirror: boolean }
export interface VectorInfo {
  width: number; height: number; widthCm: number; heightCm: number; colours: { hex: string; share: number }[];
  shapes: number; files: string[]; warnings: string[];
}
export interface ImageTools {
  installed(): { upscale: boolean; background: boolean; art: boolean };
  upscale(input: string, output: string, scale: 2 | 4, kind: UpscaleKind): Promise<void>;
  removeBackground(input: string, output: string, cutout: Cutout): Promise<void>;
  /** Writes output (a PNG); says which colours it found. */
  flatten(input: string, output: string, options: FlatOptions): Promise<FlatInfo>;
  /** Writes design.svg, design.pdf and (colour, several inks) separations.pdf into folder. */
  vectorize(input: string, folder: string, options: VectorOptions): Promise<VectorInfo>;
}

/** The longest one picture may take before it is stopped (BiRefNet on the processor takes seconds, not minutes). */
const TIMEOUT_MS = 3 * 60_000;

/** Runs a tool; gives back what it printed (the Python tools print what they found as JSON). */
function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let errors = '', printed = '';
    child.stdout.on('data', (d: Buffer) => { printed = (printed + d.toString()).slice(-200_000); });
    child.stderr.on('data', (d: Buffer) => { errors = (errors + d.toString()).slice(-2000); });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(printed);
      else reject(new AppError('IMG_FAILED', `The image tool stopped with an error${errors ? `: ${errors.split('\n').filter(Boolean).at(-1)}` : ''}. Try a smaller picture or another option.`, 500));
    });
  });
}

/**
 * The tools folder, always a full path (a tool runs in its own folder, where a relative path no longer points at it:
 * the shop's server opens "data/moonproject.db"): MOONPROJECT_IMG_TOOLS, else "tools" beside the database (the practice
 * shop's: beside the real one).
 */
export function toolsDir(dbFile: string): string {
  const env = process.env.MOONPROJECT_IMG_TOOLS;
  if (env) return resolve(env);
  const db = resolve(dbFile);
  const beside = join(dirname(db), 'tools');
  const above = join(dirname(dirname(db)), 'tools');
  const hasTools = (d: string) => existsSync(join(d, 'realesrgan')) || existsSync(join(d, 'rembg'));
  return hasTools(beside) || !hasTools(above) ? beside : above;
}

export function localTools(folder: string): ImageTools {
  const dir = resolve(folder);
  const esr = join(dir, 'realesrgan', 'realesrgan-ncnn-vulkan.exe');
  const py = join(dir, 'rembg', 'env', 'Scripts', 'python.exe');
  const remover = join(dir, 'rembg', 'remove.py');
  const flat = join(dir, 'rembg', 'flatart.py');
  const vector = join(dir, 'rembg', 'vectorize.py');
  const lib = join(dir, 'rembg', 'env', 'Lib', 'site-packages');
  /** The options go in a file beside the output (a command line mangles JSON on Windows); the last line printed is the answer. */
  const python = async <T>(script: string, input: string, output: string, optionsFile: string, options: object): Promise<T> => {
    writeFileSync(optionsFile, JSON.stringify(options));
    const printed = await run(py, [script, input, output, optionsFile], dirname(script));
    return JSON.parse(printed.trim().split('\n').at(-1) ?? '{}') as T;
  };
  return {
    installed: () => ({
      upscale: existsSync(esr),
      background: existsSync(py) && existsSync(remover),
      art: existsSync(py) && existsSync(flat) && existsSync(vector) && existsSync(join(lib, 'cv2')) && existsSync(join(lib, 'vtracer')),
    }),
    // Artwork: the model for drawn graphics (crisp edges, flat colour); photo: the general one.
    upscale: async (input, output, scale, kind) => {
      await run(esr, ['-i', input, '-o', output, '-n', kind === 'artwork' ? 'realesr-animevideov3' : 'realesrgan-x4plus', '-s', String(scale)], dirname(esr));
    },
    removeBackground: async (input, output, cutout) => { await run(py, [remover, input, output, cutout], dirname(remover)); },
    flatten: (input, output, options) => python<FlatInfo>(flat, input, output, join(dirname(output), 'flat-options.json'), options),
    vectorize: (input, folder, options) => python<VectorInfo>(vector, input, folder, join(folder, 'vector-options.json'), options),
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
