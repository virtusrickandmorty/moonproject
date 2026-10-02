import { applyRate, formatPesos, vatFromGross } from '@moonproject/shared';
import type { WithholdingProfile } from '../CUS/withholding.ts';

export interface WithholdingRows { amount: string; atc: string; certificate: string; vat: string }
export const emptyWithholding = (): WithholdingRows => ({ amount: '', atc: '', certificate: 'pending', vat: '' });

/** COL validate's payment NET and rates (D4.6); platform uses TAX's 'other' ATC (PLAN E1). */
export function suggestedWithholding(profile: WithholdingProfile, grossCents: number, vatBp: number) {
  if (profile === 'none' || grossCents <= 0) return undefined;
  const netCents = vatFromGross(grossCents, vatBp).netCents;
  return {
    cwtCents: applyRate(netCents, profile === 'twa_services' ? 200 : profile === 'platform' ? 50 : 100),
    atc: profile === 'twa_services' ? 'WC160' as const : profile === 'platform' ? 'other' as const : 'WC158' as const,
    vatWithheldCents: profile === 'government' ? applyRate(netCents, 500) : 0,
  };
}

/** Oldest-first starts from money actually received: include the suggested tax in the same payment base. */
export function paymentGross(profile: WithholdingProfile, cashCents: number, vatBp: number): number {
  let gross = cashCents;
  for (;;) {
    const w = suggestedWithholding(profile, gross, vatBp);
    const next = cashCents + (w?.cwtCents ?? 0) + (w?.vatWithheldCents ?? 0);
    if (next === gross) return gross;
    gross = next;
  }
}

/** Once edited (including clearing), the encoder's rows win until another customer is picked. */
export function withholdingRows(manual: WithholdingRows | null, profile: WithholdingProfile, grossCents: number, vatBp: number): WithholdingRows {
  if (manual) return manual;
  const w = suggestedWithholding(profile, grossCents, vatBp);
  return w ? { amount: formatPesos(w.cwtCents), atc: w.atc, certificate: 'pending', vat: w.vatWithheldCents ? formatPesos(w.vatWithheldCents) : '' } : emptyWithholding();
}
