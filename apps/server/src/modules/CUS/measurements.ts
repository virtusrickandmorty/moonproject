import { AppError } from '@moonproject/shared';
import { measurements } from './schemas.ts';

type Unit = 'inch' | 'cm';
type ChartRow = Record<string, unknown>;

export const hundredthsColumn = (field: (typeof measurements)[number]): string =>
  `${field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_hundredths`;

/** Parse the JSON decimal as a rational number before quantizing to 0.01 inch. */
export function toHundredthsInch(value: number, unit: Unit): number {
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new AppError('INVALID_MEASUREMENT', 'Enter a positive decimal measurement.', 400);
  const [whole = '0', fraction = ''] = text.split('.');
  if (fraction.length > (unit === 'inch' ? 2 : 4)) {
    throw new AppError('MEASUREMENT_PRECISION', unit === 'inch' ? 'Use at most two decimal places for inches.' : 'Use at most four decimal places for centimetres.', 400);
  }
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction);
  if (unit === 'inch') {
    const scaled = numerator * 100n;
    if (scaled % scale !== 0n) throw new AppError('MEASUREMENT_PRECISION', 'Use at most two decimal places for inches.', 400);
    return Number(scaled / scale);
  }
  // 1 inch = 2.54 cm exactly. Round to the nearest hundredth inch, half up.
  const scaled = numerator * 5000n;
  const divisor = scale * 127n;
  return Number((scaled * 2n + divisor) / (divisor * 2n));
}

function decimal(scaled: bigint, digits: number): number {
  const factor = 10n ** BigInt(digits);
  return Number(`${scaled / factor}.${String(scaled % factor).padStart(digits, '0')}`);
}

export function fromHundredthsInch(value: number, unit: Unit): number {
  return unit === 'inch' ? decimal(BigInt(value), 2) : decimal(BigInt(value) * 254n, 4);
}

export function chartResponse(row: ChartRow): ChartRow {
  const { ...out } = row;
  const unit = row.unit as Unit;
  const values: Record<string, number | null> = {};
  for (const field of measurements) {
    const column = hundredthsColumn(field);
    values[field] = row[column] == null ? null : fromHundredthsInch(row[column] as number, unit);
    delete out[column];
  }
  return { ...out, values };
}
