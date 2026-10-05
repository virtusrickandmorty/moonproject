import { describe, expect, it } from 'vitest';
import { applyRate, formatPesos, vatFromGross } from '@moonproject/shared';
import { cashPlaceId, createTestEnv, idem } from '../../../../server/test/helpers.ts';
import { runInvariants } from '../../../../server/src/engine/ledger/invariants.ts';
import { withholdingLabels, type WithholdingProfile } from '../CUS/withholding.ts';
import { cents } from './money.ts';
import { emptyWithholding, paymentGross, suggestedWithholding, withholdingRows } from './withholding.ts';

const profiles = Object.keys(withholdingLabels) as WithholdingProfile[];

describe('customer withholding suggestions', () => {
  for (const profile of profiles) {
    for (const vatBp of [1200, 1000]) {
      it(`${profile}, VAT ${vatBp}: selected invoice figures preview and record without warnings`, async () => {
        const env = await createTestEnv();
        try {
          const encoder = await env.as('encoder');
          const customer = await encoder.post('/api/cus/customers', { kind: 'organization', displayName: 'Moonlit Test Buyer', withholdingProfile: profile });
          expect(customer.statusCode).toBe(200);
          const customerId = customer.json().id;
          expect((await encoder.get(`/api/cus/customers/${customerId}`)).json().withholding_profile).toBe(profile);
          env.db.prepare('INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('tax.vat_rate_bp', '2026-09-28', String(vatBp), 'Test payment date VAT', '2026-09-28T10:00:00+08:00');
          // A future setting must not affect today's suggestion.
          env.db.prepare('INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('tax.vat_rate_bp', '2027-01-01', '900', 'Test future VAT', '2026-09-28T10:00:00+08:00');
          const rate = (await encoder.get('/api/settings')).json().find((s: { key: string }) => s.key === 'tax.vat_rate_bp').current;
          expect(rate).toBe(vatBp);
          // Two invoices with awkward centavos: round the payment's NET once, as COL validate does.
          const grossAmounts = [99_901, 17_854];
          const sales = [];
          for (const [n, gross] of grossAmounts.entries()) {
            const sale = await encoder.post('/api/docs/qs.sale/post', { input: { customerId, invoiceNumber: String(501 + n),
              lines: [{ kind: 'service', description: 'Sample sleeve repair', qty: 1, unitPriceCents: gross, discountCents: 0 }] }, expectedTotalCents: gross }, idem());
            expect(sale.statusCode).toBe(200);
            sales.push({ saleId: sale.json().id, amountCents: gross });
          }
          const gross = grossAmounts.reduce((a, b) => a + b, 0);
          const w = suggestedWithholding(profile, gross, rate);
          const net = vatFromGross(gross, rate).netCents;
          if (profile === 'none') {
            expect(w).toBeUndefined();
            expect(withholdingRows(null, profile, gross, rate)).toEqual(emptyWithholding());
          } else {
            expect(w).toEqual({ atc: profile === 'platform' ? 'other' : profile === 'twa_services' ? 'WC160' : 'WC158',
              cwtCents: applyRate(net, profile === 'platform' ? 50 : profile === 'twa_services' ? 200 : 100),
              vatWithheldCents: profile === 'government' ? applyRate(net, 500) : 0 });
          }
          const rows = withholdingRows(null, profile, gross, rate);
          expect(cents(rows.amount)).toBe(w?.cwtCents ?? 0);
          expect(cents(rows.vat)).toBe(w?.vatWithheldCents ?? 0);
          const input = { customerId, crNumber: '101', applications: [], sales,
            tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: gross - (w?.cwtCents ?? 0) - (w?.vatWithheldCents ?? 0) }],
            ...(w ? { withholding: { cwtCents: w.cwtCents, atc: w.atc, certificate: 'pending', ...(w.vatWithheldCents ? { vatWithheldCents: w.vatWithheldCents } : {}) } } : {}) };
          const preview = await encoder.post('/api/docs/col.collection/preview', { input });
          expect(preview.statusCode).toBe(200);
          expect(preview.json().totalCents).toBe(gross);
          expect(preview.json().issues).toEqual([]);
          const posted = await encoder.post('/api/docs/col.collection/post', { input, expectedTotalCents: gross }, idem());
          expect(posted.statusCode).toBe(200);
          const saved = (await encoder.get(`/api/docs/col.collection/${posted.json().id}`)).json().input;
          expect(saved.withholding).toEqual(input.withholding);
          const typed = { amount: '123.45', atc: 'other', vat: '67.89', certificate: 'received' };
          const kept = withholdingRows(typed, profile, gross, rate);
          const manual = { cwtCents: cents(kept.amount)!, atc: kept.atc, vatWithheldCents: cents(kept.vat)!, certificate: kept.certificate };
          const changed = { ...input, crNumber: '102', withholding: manual,
            tenders: [{ cashPlaceId: cashPlaceId(env.db, '1101'), amountCents: gross - manual.cwtCents - manual.vatWithheldCents }] };
          const edited = await encoder.post(`/api/docs/col.collection/${posted.json().id}/reissue`,
            { input: changed, expectedTotalCents: gross, reason: 'Match the sample 2307 certificate' }, idem());
          expect(edited.statusCode).toBe(200);
          expect((await encoder.get(`/api/docs/col.collection/${edited.json().id}`)).json().input.withholding).toEqual(manual);
          expect(runInvariants(env.db).filter((r) => !r.ok)).toEqual([]);
        } finally {
          await env.app.close();
          env.db.close();
        }
      });
    }

    it(`${profile}: hand edits and clearing survive invoice and tender changes`, () => {
      const typed = { amount: '123.45', atc: 'other', vat: '67.89', certificate: 'received' };
      expect(withholdingRows(typed, profile, 11_200_000, 1200)).toBe(typed);
      expect(withholdingRows(typed, profile, 35_000, 1000)).toBe(typed);
      const cleared = emptyWithholding();
      expect(withholdingRows(cleared, profile, 11_200_000, 1200)).toBe(cleared);
      // Reissue starts with stored rows, including a collection originally recorded without withholding.
      expect(withholdingRows(cleared, profile, 11_200_000, 1200).amount).toBe('');
    });

    it(`${profile}: oldest-first includes tax in the payment base without a feedback loop`, () => {
      for (const cash of [0, 1, 999, 10_600_000]) {
        const gross = paymentGross(profile, cash, 1200);
        const w = suggestedWithholding(profile, gross, 1200);
        expect(gross).toBe(cash + (w?.cwtCents ?? 0) + (w?.vatWithheldCents ?? 0));
        expect(withholdingRows(null, profile, gross, 1200).amount).toBe(w ? formatPesos(w.cwtCents) : '');
      }
    });
  }

  it('G-09: government buyer pays 106,000 on 112,000, with 1,000 CWT and 5,000 VAT withheld', () => {
    expect(withholdingRows(null, 'government', 11_200_000, 1200)).toEqual({ amount: '1,000.00', atc: 'WC158', certificate: 'pending', vat: '5,000.00' });
    expect(paymentGross('government', 10_600_000, 1200)).toBe(11_200_000);
  });
});
