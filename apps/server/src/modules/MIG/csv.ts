import { formatPesos, isBusinessDate, parsePesos, GARMENT_TYPE_MAX } from '@moonproject/shared';

export type RowType = 'customer' | 'measurement' | 'employee' | 'piece_rate' | 'sizer_set' | 'unknown';
export interface ParsedRow {
  rowType: RowType;
  raw: Record<string, string>;
  issues: string[];
  status: 'valid' | 'needs_review';
  legacyId: string | null;
  rateCents: number | null;
}

export const measurementFields = [
  'shoulder', 'chest', 'upper_waist', 'collar', 'bust_point', 'figure_point',
  'bust_distance', 'arm_hole', 'sleeve_hole', 'sleeve_length', 'upper_length',
  'lower_waist', 'hips', 'crotch', 'thigh', 'calf', 'ankle', 'lower_length',
] as const;
export type MeasurementField = typeof measurementFields[number];
const measurementSet = new Set<string>(measurementFields);

/** The source calls sleeve length "Sleeve Height"; all other E1 names also accept spaces/case. */
export function measurementField(header: string): MeasurementField | null {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = key === 'sleeve_height' ? 'sleeve_length' : key;
  return measurementSet.has(mapped) ? mapped as MeasurementField : null;
}

/** Exact tenths, with a dash or empty cell representing no measurement. */
export function measurementTenths(value: string): number | null {
  const s = value.trim();
  if (s === '' || s === '-') return null;
  const match = /^(\d+)(?:\.(\d))?$/.exec(s);
  if (!match) throw new Error('Measurement must be a non-negative number exact to tenths.');
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? '0');
  if (!Number.isSafeInteger(tenths)) throw new Error('Measurement is too large.');
  return tenths;
}

export function rateFromPesos(value: string): number {
  const cents = parsePesos(value);
  if (cents < 0) throw new Error('Rate cannot be negative.');
  return cents;
}

/** A measurement row with no customer yet: the sheet's MANUAL rows, or a row naming neither a customer nor a group. */
export function isManualMeasurement(raw: Record<string, string>): boolean {
  return raw.Source === 'MANUAL' || raw.Customer_Name === 'MANUAL' || raw.Customer_ID === 'MANUAL'
    || (!raw.Customer_Name && !raw.Customer_ID && !raw.Group_Name);
}

/** What the owner typed for a row: text, pesos in centavos, or a yes for "make this its own customer". */
export type ManualData = Record<string, string | number | boolean>;

/** The name a MANUAL row carries: the wearer's, or the sheet's Customer Name (a person typed in without a customer). Blank when it is only the word MANUAL. */
export function manualName(raw: Record<string, string>): string {
  return [raw.Wearer_Name, raw.Person_Name, raw.Full_Name, raw.Name, raw.Customer_Name]
    .map(v => (v ?? '').trim()).find(v => v !== '' && v.toUpperCase() !== 'MANUAL') ?? '';
}

/** A name with case, spaces and punctuation taken out, so "JUAN  dela-Cruz." and "Juan Dela Cruz" are the same. */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Where the owner put a measurement row, laid over the staged values: a staged customer (by legacy ID), a customer already in
 * Virtus (by id), or a new person-customer named as in the sheet; and a group. A bulk choice also names the wearer.
 * The keys `id:` and `MANUAL:` mark the ones the commit resolves itself. Shared by the review and the commit.
 */
export function applyMeasurementAssignment(raw: Record<string, string>, manual: ManualData): void {
  const text = (v: unknown): string => String(v);
  if (manual.customerLegacyId) { raw.Customer_ID = text(manual.customerLegacyId); raw.Customer_Name = text(manual.customerLegacyId); raw.Source = 'ASSIGNED'; }
  if (manual.groupLegacyId) { raw.Group_ID = text(manual.groupLegacyId); raw.Group_Name = text(manual.groupLegacyId); raw.Source = 'ASSIGNED'; }
  if (manual.customerId) { raw.Customer_ID = `id:${text(manual.customerId)}`; raw.Customer_Name = raw.Customer_ID; raw.Source = 'ASSIGNED'; }
  if (manual.newCustomer) {
    raw.Customer_ID = `MANUAL:${raw.Measurement_ID ?? ''}`;
    raw.Customer_Name = text(manual.wearerName ?? '');
    raw.Source = 'ASSIGNED';
  }
  if (manual.groupId) { raw.Group_ID = `id:${text(manual.groupId)}`; delete raw.Group_Name; }
  if (manual.newGroupName) { raw.Group_Name = text(manual.newGroupName); delete raw.Group_ID; }
  if (manual.wearerName) { raw.Wearer_Name = text(manual.wearerName); raw.Wearer_ID = `manual:${raw.Measurement_ID ?? ''}`; }
}

/** What the owner typed for an employee row, put over the staged values. Shared by the review and the commit. */
export function applyEmployeeFix(raw: Record<string, string>, manual: ManualData): void {
  if (manual.employeeName) raw.Employee_Name = String(manual.employeeName);
  if (manual.legacyId) raw.Employee_ID = String(manual.legacyId);
  if (manual.payType) raw.Pay_Type = String(manual.payType);
  if (manual.hireDate) raw.Hire_Date = String(manual.hireDate);
  if (manual.rateCents !== undefined) {
    // One rate box: the monthly rate for monthly pay, the daily rate otherwise.
    raw[raw.Pay_Type?.trim().toLowerCase() === 'monthly' ? 'Monthly_Rate' : 'Daily_Rate'] = formatPesos(Number(manual.rateCents));
  }
}

const PAY_TYPES = ['daily', 'piece', 'monthly', 'mixed'];

/** CSV parser supporting quoted newlines and reporting each data row's source line. */
export function parseCSV(csvText: string): { objects: Record<string, string>[]; lineNumbers: number[] } {
  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else { cell += char; if (char === '\n') line++; }
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i++;
      row.push(cell); rows.push(row); lineNumbers.push(rowStart);
      row = []; cell = ''; line++; rowStart = line;
    } else cell += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted cell.');
  if (cell || row.length) { row.push(cell); rows.push(row); lineNumbers.push(rowStart); }
  if (!rows.length) return { objects: [], lineNumbers: [] };
  const headers = rows[0]!.map(h => h.trim());
  const objects: Record<string, string>[] = [];
  const starts: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]!;
    if (values.every(v => !v.trim())) continue;
    const obj: Record<string, string> = {};
    headers.forEach((header, j) => { if (header) obj[header] = values[j]?.trim() ?? ''; });
    objects.push(obj); starts.push(lineNumbers[i]!);
  }
  return { objects, lineNumbers: starts };
}

export function rowTypeOf(raw: Record<string, string>): RowType {
  const keys = Object.keys(raw);
  if (keys.includes('Sizes_Included')) return 'sizer_set'; // the owner's request, Oct 2026
  if (keys.includes('Measurement_ID') || keys.some(k => measurementField(k))) return 'measurement';
  if (keys.includes('Employee_ID') || keys.includes('Employee_Name') || keys.includes('Daily_Rate') || keys.includes('Pay_Type')) return 'employee';
  if (keys.includes('Customer_Name') || keys.includes('Registered_Name') || keys.includes('TIN') || keys.includes('Email')) return 'customer';
  // The price list (the owner's request, Oct 2026): Item with its Price and/or a piece Rate; an old piece-rate sheet
  // (Garment_Type, Operation, Rate) is read as rates of the item of that name. Kept as row type 'piece_rate' inside.
  if (keys.includes('Item') && (keys.includes('Price') || keys.includes('Rate'))) return 'piece_rate';
  if (keys.includes('Garment_Type') && keys.includes('Operation') && keys.includes('Rate')) return 'piece_rate';
  return 'unknown';
}

export function validateRow(raw: Record<string, string>): ParsedRow {
  const rowType = rowTypeOf(raw);
  const issues: string[] = [];
  const legacyId = (rowType === 'customer' ? raw.Legacy_ID || raw.Customer_ID
    : rowType === 'employee' ? raw.Employee_ID || raw.Legacy_ID
    : rowType === 'measurement' ? raw.Measurement_ID
    : rowType === 'sizer_set' ? raw.Code : null) || null;
  let rateCents: number | null = null;
  if (rowType === 'unknown') issues.push('Could not determine row type from columns.');
  if (rowType === 'customer') {
    if (!raw.Customer_Name && !raw.Registered_Name) issues.push('Customer is missing a name.');
    if (!legacyId) issues.push('Customer is missing a legacy ID.');
  }
  if (rowType === 'measurement') {
    if (!legacyId) issues.push('Measurement is missing a legacy ID.');
    if (isManualMeasurement(raw)) {
      issues.push('Manual measurement row needs to be assigned to a customer or group.');
    }
    const seen = new Set<string>();
    let cells = 0;
    for (const [key, value] of Object.entries(raw)) {
      const field = measurementField(key);
      if (!field) continue;
      if (seen.has(field)) { issues.push(`Measurement column ${field} appears twice.`); continue; }
      seen.add(field);
      try { if (measurementTenths(value) !== null) cells++; } catch { issues.push(`${key} must be a number exact to tenths.`); }
    }
    if (!cells) issues.push('This row has no measurements, so there is nothing to import. Type a measurement with Fix, or exclude the row.');
  }
  if (rowType === 'employee') {
    if (!raw.Employee_Name) issues.push('Employee is missing a name.');
    if (!legacyId) issues.push('Employee is missing a legacy ID.');
    const sheet = raw.Salary_Category !== undefined; // a row of the old sheet's Employees tab
    const payType = (raw.Pay_Type ?? '').trim().toLowerCase();
    if (payType && !PAY_TYPES.includes(payType)) issues.push('Pay type must be daily, piece, monthly or mixed.');
    if (sheet && !payType) {
      issues.push(raw.Salary_Category
        ? `Salary Category "${raw.Salary_Category}" is not Daily, Piece Rate (Pakyawan) or Monthly. Use Fix to choose the pay type.`
        : 'Salary Category is blank. Use Fix to choose the pay type.');
    }
    if (raw.Daily_Rate?.trim()) {
      try { rateCents = rateFromPesos(raw.Daily_Rate); }
      catch { issues.push('Daily rate must be a non-negative peso amount exact to the centavo.'); }
    }
    if (payType === 'monthly') {
      if (!raw.Monthly_Rate?.trim()) issues.push('Monthly pay needs a monthly rate. Use Fix to type it.');
      else try { rateFromPesos(raw.Monthly_Rate); } catch { issues.push('Monthly rate must be a non-negative peso amount exact to the centavo.'); }
    } else if ((payType === 'daily' || payType === 'mixed') && !rateCents && !issues.some(i => i.startsWith('Daily rate'))) {
      issues.push('Daily pay needs a daily rate. Use Fix to type it.');
    }
    if (raw.Hire_Date?.trim() && !isBusinessDate(raw.Hire_Date.trim())) issues.push(`Hire date "${raw.Hire_Date}" is not a date like 2026-02-11. Use Fix to type it.`);
    if (raw.Hire_Date !== undefined && !raw.Hire_Date.trim()) issues.push('Date Employed is blank, so the hire date will be today (requires owner confirmation).');
    if (raw.Status !== undefined && raw.Status.trim().toLowerCase() !== 'active') {
      issues.push(`Status is ${raw.Status.trim() ? `"${raw.Status.trim()}"` : 'blank'}, not Active. Exclude the row, or accept it to bring the employee in as active (requires owner confirmation).`);
    }
    issues.push('Employee rate or missing rate requires owner confirmation.');
  }
  if (rowType === 'piece_rate') {
    const p = priceListRow(raw);
    issues.push(...p.issues);
    rateCents = p.rateCents ?? null;
    issues.push('Price list row requires owner confirmation.');
  }
  if (rowType === 'sizer_set') {
    if (!raw.Code?.trim()) issues.push('Sizer set is missing its code.');
    if (!raw.Garment_Type?.trim()) issues.push('Sizer set is missing its garment type.');
    if (!raw.Sizes_Included?.trim()) issues.push('Sizer set is missing the sizes it includes, like XS, S, M, L, XL.');
    if ((raw.Code ?? '').length > 100 || (raw.Garment_Type ?? '').length > 100 || (raw.Sizes_Included ?? '').length > 200) issues.push('Sizer set code and garment type take up to 100 letters, sizes up to 200.');
  }
  return { rowType, raw, issues, status: issues.length ? 'needs_review' : 'valid', legacyId, rateCents };
}

/** What the owner typed with Fix on a sizer set row, laid over the sheet's values. Shared by the review and the commit. */
export function applySizerFix(raw: Record<string, string>, manual: ManualData): void {
  if (manual.code) raw.Code = String(manual.code);
  if (manual.garmentType) raw.Garment_Type = String(manual.garmentType);
  if (manual.sizesIncluded) raw.Sizes_Included = String(manual.sizesIncluded);
}

/** Keys scoped by type avoid merging unrelated customers and employees with the same ID. */
export function duplicateKeys(row: ParsedRow): string[] {
  const keys: string[] = [];
  if (row.legacyId) keys.push(`${row.rowType}:id:${row.legacyId.trim().toLowerCase()}`);
  if (row.rowType === 'customer' && row.raw.Customer_Name?.trim() && row.raw.TIN?.trim()) {
    keys.push(`customer:name-tin:${row.raw.Customer_Name.trim().toLowerCase()}:${row.raw.TIN.trim().toLowerCase()}`);
  }
  return keys;
}

/**
 * A price list row (the owner's request, Oct 2026): Item, Kind (Made to order, Ready-made or Service), Unit (Piece or Set),
 * Price (VAT included) and From qty (the price from that many pieces: a price break; blank is 1), and optionally one piece
 * rate of the item: Operation (the step), Part (Upper or Lower, a set's) and Rate. No difficulty: each item has its own
 * rates (an older file's Difficulty column may say Standard; anything else is flagged). An item's price breaks are its rows with a Price, one per From qty. An old piece-rate sheet's Garment_Type is the
 * Item.
 */
export interface PriceListRow {
  item: string; class: 'made_to_order_garment' | 'ready_made_item' | 'service'; unit: 'pc' | 'set';
  priceCents?: number; minQty: number; operation: string; part: 'whole' | 'upper' | 'lower'; complexity: 'standard'; rateCents?: number; issues: string[];
}
export function priceListRow(raw: Record<string, string>): PriceListRow {
  const issues: string[] = [];
  const item = (raw.Item ?? raw.Garment_Type ?? '').trim();
  const kind = (raw.Kind ?? '').trim().toLowerCase().replace(/[-_]/g, ' ');
  const cls = !kind || ['made to order', 'mto', 'made to order garment', 'garment'].includes(kind) ? 'made_to_order_garment'
    : ['ready made', 'rtw', 'ready made item', 'ready to wear'].includes(kind) ? 'ready_made_item' : kind === 'service' ? 'service' : null;
  const unitWord = (raw.Unit ?? '').trim().toLowerCase();
  const unit = !unitWord || ['piece', 'pc', 'pcs', 'pieces'].includes(unitWord) ? 'pc' : ['set', 'sets'].includes(unitWord) ? 'set' : null;
  const operation = (raw.Operation ?? '').trim();
  const partWord = (raw.Part ?? '').trim().toLowerCase();
  const part = !partWord || partWord === 'whole' ? 'whole' : partWord === 'upper' || partWord === 'lower' ? partWord : null;
  // No difficulty (the owner's decision, Oct 2026): each item has its own rates; an older file's Standard is fine.
  const level = (raw.Difficulty ?? raw.Complexity ?? '').trim().toLowerCase() || 'standard';
  const money = (label: string, value: string | undefined) => {
    if (!value?.trim()) return undefined;
    try { return rateFromPesos(value); } catch { issues.push(`${label} "${value}" must be a peso amount like 450.00.`); return undefined; }
  };
  const priceCents = money('Price', raw.Price);
  const fromWord = (raw['From qty'] ?? raw['From Qty'] ?? raw.From_Qty ?? raw.Min_Qty ?? '').trim().replace(/,/g, '');
  const minQty = fromWord === '' ? 1 : /^\d+$/.test(fromWord) && Number(fromWord) >= 1 && Number(fromWord) <= 100_000 ? Number(fromWord) : null;
  const rateCents = money('Rate', raw.Rate);
  if (!item) issues.push('The price list row needs the item name.');
  if (minQty === null) issues.push(`From qty "${fromWord}" must be a whole number of pieces, 1 or more.`);
  else if (minQty > 1 && priceCents === undefined) issues.push('From qty goes with a Price: the price from that many pieces.');
  if (item.length > GARMENT_TYPE_MAX) issues.push(`The item name takes up to ${GARMENT_TYPE_MAX} letters.`);
  if (!cls) issues.push(`Kind "${raw.Kind}" is not Made to order, Ready-made or Service.`);
  if (!unit) issues.push(`Unit "${raw.Unit}" is not Piece or Set.`);
  if (!part) issues.push(`Part "${raw.Part}" is not Upper or Lower.`);
  if (level !== 'standard') issues.push(`Difficulty "${raw.Difficulty ?? raw.Complexity}" is no longer used: each item has its own rates. Leave it blank, or make the harder version a price list item of its own.`);
  if (operation && raw.Rate?.trim() === undefined) issues.push('A piece rate needs the Rate as well as the Operation.');
  if (!operation && rateCents !== undefined) issues.push('A piece rate needs the Operation (the step, like Sewing).');
  if (operation && cls && cls !== 'made_to_order_garment') issues.push('Piece rates are for made-to-order garments; this item is not one.');
  if (part && part !== 'whole' && unit !== 'set') issues.push('Upper and Lower parts are for an item sold as a set.');
  if (priceCents === undefined && !(operation && rateCents !== undefined) && !issues.length) issues.push('The row has neither a price nor a piece rate.');
  return { item, class: cls ?? 'made_to_order_garment', unit: unit ?? 'pc', ...(priceCents !== undefined ? { priceCents } : {}), minQty: minQty ?? 1, operation, part: part ?? 'whole', complexity: 'standard', ...(rateCents !== undefined ? { rateCents } : {}), issues };
}

/**
 * An item's later rows in a price list may leave Kind and Unit empty (the template says so, and a sheet with those cells
 * merged saves them that way): before the rows are checked, they take the item's own, from its first row that has them
 * (the owner's report, Oct 2026: "every field in the template has data, but the review shows one missing").
 */
export function carryItemDetails(rows: Record<string, string>[]): Record<string, string>[] {
  const known = new Map<string, { Kind?: string; Unit?: string }>();
  return rows.map((raw) => {
    if (rowTypeOf(raw) !== 'piece_rate') return raw;
    const key = nameKey(raw.Item ?? raw.Garment_Type ?? '');
    if (!key) return raw;
    const item = known.get(key) ?? {};
    const out = { ...raw };
    for (const col of ['Kind', 'Unit'] as const) {
      if (out[col] === undefined) continue;
      if (!out[col].trim() && item[col]) out[col] = item[col];
      else if (out[col].trim() && !item[col]) item[col] = out[col].trim();
    }
    known.set(key, item);
    return out;
  });
}

/** What the owner typed with Fix on a price list row, laid over the sheet's values. Shared by the review and the commit. */
export function applyPriceListFix(raw: Record<string, string>, manual: ManualData): void {
  if (manual.garmentType) raw.Item = String(manual.garmentType);
  if (manual.item) raw.Item = String(manual.item);
  if (manual.kind) raw.Kind = String(manual.kind);
  if (manual.unit) raw.Unit = String(manual.unit);
  if (manual.priceCents !== undefined) raw.Price = (Number(manual.priceCents) / 100).toFixed(2);
  if (manual.minQty !== undefined) raw[['From qty', 'From Qty', 'From_Qty', 'Min_Qty'].find((k) => raw[k] !== undefined) ?? 'From qty'] = String(manual.minQty);
  if (manual.operation) raw.Operation = String(manual.operation);
  if (manual.part) raw.Part = String(manual.part);
  // No difficulty any more (the owner's decision, Oct 2026): a row the owner fixes drops an older file's Difficulty.
  delete raw.Difficulty; delete raw.Complexity;
  if (manual.rateCents !== undefined) raw.Rate = (Number(manual.rateCents) / 100).toFixed(2);
  if (raw.Garment_Type !== undefined && raw.Item === undefined) raw.Item = raw.Garment_Type;
}
