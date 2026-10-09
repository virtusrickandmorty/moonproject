/**
 * Reads the first sheet of an old Excel file (.xls: a compound file holding a BIFF8 workbook) as a grid of text, for the
 * biometric attendance report (the owner's request, Oct 2026). Only what such a report holds is read: text (shared and
 * inline), numbers (NUMBER, RK, MULRK); formulas, formats and other sheets are left out. No library: the common one on npm
 * is out of date, and PLAN keeps runtime dependencies few.
 */

const FREE = 0xffffffff, END = 0xfffffffe;

/** The bytes of the workbook stream inside the compound file. */
function workbookStream(buf: Buffer): Buffer {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) throw new Error('This is not an .xls file.');
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSize = 1 << buf.readUInt16LE(0x20);
  const cutoff = buf.readUInt32LE(0x38);
  const sector = (id: number) => {
    const at = (id + 1) * sectorSize;
    if (at + sectorSize > buf.length + sectorSize) throw new Error('The .xls file is cut short.');
    return buf.subarray(at, Math.min(at + sectorSize, buf.length));
  };
  // The FAT's own sectors: 109 in the header, the rest in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) { const id = buf.readUInt32LE(0x4c + i * 4); if (id !== FREE) fatSectors.push(id); }
  for (let id = buf.readUInt32LE(0x44), n = 0; id !== END && id !== FREE && n < 10_000; n++) {
    const s = sector(id);
    for (let i = 0; i < sectorSize / 4 - 1; i++) { const f = s.readUInt32LE(i * 4); if (f !== FREE) fatSectors.push(f); }
    id = s.readUInt32LE(sectorSize - 4);
  }
  const fat: number[] = [];
  for (const id of fatSectors) { const s = sector(id); for (let i = 0; i + 4 <= s.length; i += 4) fat.push(s.readUInt32LE(i)); }
  const chain = (start: number, table: number[]) => {
    const ids: number[] = [];
    for (let id = start; id !== END && id !== FREE && ids.length < table.length + 1; id = table[id] ?? END) ids.push(id);
    return ids;
  };
  const read = (start: number) => Buffer.concat(chain(start, fat).map(sector));

  const dir = read(buf.readUInt32LE(0x30));
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const len = dir.readUInt16LE(at + 0x40);
    entries.push({ name: dir.toString('utf16le', at, at + Math.max(0, len - 2)), type: dir[at + 0x42]!, start: dir.readUInt32LE(at + 0x74), size: dir.readUInt32LE(at + 0x78) });
  }
  const root = entries.find((e) => e.type === 5);
  const book = entries.find((e) => e.type === 2 && (e.name === 'Workbook' || e.name === 'Book'));
  if (!book || !root) throw new Error('The .xls file has no workbook in it.');
  if (book.size >= cutoff) return read(book.start).subarray(0, book.size);
  // A small workbook lives in the mini stream (64-byte sectors), indexed by the mini FAT.
  const miniFat: number[] = [];
  const mf = read(buf.readUInt32LE(0x3c));
  for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  const mini = read(root.start);
  return Buffer.concat(chain(book.start, miniFat).map((id) => mini.subarray(id * miniSize, (id + 1) * miniSize))).subarray(0, book.size);
}

/** Reads across the pieces of a record split by CONTINUE records (the shared strings table). */
class Pieces {
  private i = 0;
  private at = 0;
  private readonly parts: Buffer[];
  constructor(parts: Buffer[]) { this.parts = parts; } // no parameter property: the server runs on plain Node (type stripping)
  private get part() { return this.parts[this.i]!; }
  private next() { this.i++; this.at = 0; if (this.i >= this.parts.length) throw new Error('The .xls text table is cut short.'); }
  u8() { if (this.at >= this.part.length) this.next(); return this.part[this.at++]!; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n: number) { for (let k = 0; k < n; k++) this.u8(); }
  /** `count` characters; a CONTINUE starting inside them begins with a byte saying whether they are one or two bytes each. */
  chars(count: number, wide: boolean): string {
    let out = '';
    let left = count;
    while (left > 0) {
      if (this.at >= this.part.length) { this.next(); wide = (this.u8() & 1) === 1; }
      const fit = Math.min(left, Math.floor((this.part.length - this.at) / (wide ? 2 : 1)));
      if (fit === 0) { this.at = this.part.length; continue; }
      const end = this.at + fit * (wide ? 2 : 1);
      out += wide ? this.part.toString('utf16le', this.at, end) : this.part.toString('latin1', this.at, end);
      this.at = end;
      left -= fit;
    }
    return out;
  }
}

/** A cell's RK number: an integer or a float, maybe divided by 100. */
function rk(v: number): number {
  const n = v & 2 ? v >> 2 : (() => { const b = Buffer.alloc(8); b.writeUInt32LE(v & 0xfffffffc, 4); return b.readDoubleLE(0); })();
  return v & 1 ? n / 100 : n;
}
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

/** The first sheet of an .xls file as rows of cell text ('' for an empty cell). */
export function readXls(buf: Buffer): string[][] {
  const wb = workbookStream(buf);
  const records: { type: number; data: Buffer; at: number }[] = [];
  for (let at = 0; at + 4 <= wb.length;) {
    const type = wb.readUInt16LE(at), len = wb.readUInt16LE(at + 2);
    records.push({ type, data: wb.subarray(at + 4, at + 4 + len), at });
    at += 4 + len;
  }
  // The shared strings (SST and its CONTINUEs) and where the first worksheet starts (BOUNDSHEET, type 0).
  const sst: string[] = [];
  let sheetAt = -1;
  for (let r = 0; r < records.length; r++) {
    const rec = records[r]!;
    if (rec.type === 0x0085 && sheetAt < 0 && rec.data[5] === 0) sheetAt = rec.data.readUInt32LE(0);
    if (rec.type === 0x00fc) {
      const parts = [rec.data];
      for (let c = r + 1; records[c]?.type === 0x003c; c++) parts.push(records[c]!.data);
      const p = new Pieces(parts);
      p.u32();
      const unique = p.u32();
      for (let s = 0; s < unique; s++) {
        const count = p.u16();
        const flags = p.u8();
        const runs = flags & 8 ? p.u16() : 0;
        const ext = flags & 4 ? p.u32() : 0;
        sst.push(p.chars(count, (flags & 1) === 1));
        p.skip(runs * 4 + ext);
      }
    }
    if (rec.type === 0x000a && sheetAt >= 0) break; // the end of the globals
  }
  if (sheetAt < 0) throw new Error('The .xls file has no worksheet.');
  const grid: string[][] = [];
  const put = (row: number, col: number, text: string) => { (grid[row] ??= [])[col] = text; };
  for (const rec of records.filter((x) => x.at >= sheetAt)) {
    const d = rec.data;
    if (rec.type === 0x000a) break; // the worksheet's end
    if (rec.type === 0x00fd) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
    else if (rec.type === 0x0203) put(d.readUInt16LE(0), d.readUInt16LE(2), num(d.readDoubleLE(6)));
    else if (rec.type === 0x027e) put(d.readUInt16LE(0), d.readUInt16LE(2), num(rk(d.readUInt32LE(6))));
    else if (rec.type === 0x00bd) {
      const row = d.readUInt16LE(0), first = d.readUInt16LE(2);
      for (let k = 0; 4 + k * 6 + 6 <= d.length - 2; k++) put(row, first + k, num(rk(d.readUInt32LE(4 + k * 6 + 2))));
    } else if (rec.type === 0x0204) {
      const count = d.readUInt16LE(6), wide = (d[8]! & 1) === 1;
      put(d.readUInt16LE(0), d.readUInt16LE(2), wide ? d.toString('utf16le', 9, 9 + count * 2) : d.toString('latin1', 9, 9 + count));
    }
  }
  return Array.from({ length: grid.length }, (_, r) => Array.from({ length: grid[r]?.length ?? 0 }, (__, c) => grid[r]?.[c] ?? ''));
}
