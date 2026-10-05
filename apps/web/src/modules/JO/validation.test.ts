/** Keep browser limits aligned with the server when either side changes. */
import { expect, it } from 'vitest';
import { z, type ZodType } from 'zod';
import * as cus from '../CUS/validation.ts';
import * as cat from '../CAT/validation.ts';
import * as jo from './validation.ts';
import * as col from '../COL/validation.ts';
import * as qs from '../QS/validation.ts';
import * as quo from '../QUO/validation.ts';
import * as szr from '../SZR/validation.ts';
import * as com from '../COM/validation.ts';
import * as serverCus from '../../../../server/src/modules/CUS/schemas.ts';
import * as serverCat from '../../../../server/src/modules/CAT/schemas.ts';
import * as serverSzr from '../../../../server/src/modules/SZR/schemas.ts';
import * as serverCom from '../../../../server/src/modules/COM/settings.ts';
import { jobOrderInput } from '../../../../server/src/modules/JO/doctypes/job-order.ts';
import { openingJobOrderInput } from '../../../../server/src/modules/JO/doctypes/opening.ts';
import { releaseInput } from '../../../../server/src/modules/JO/doctypes/release.ts';
import { invoiceRecordInput } from '../../../../server/src/modules/JO/doctypes/invoice-record.ts';
import { dpInvoiceInput } from '../../../../server/src/modules/JO/doctypes/dp-invoice.ts';
import { saleInput } from '../../../../server/src/modules/QS/doctypes/sale.ts';
import { quotationInput } from '../../../../server/src/modules/QUO/doctypes/quotation.ts';
import { collectionInput } from '../../../../server/src/modules/COL/doctypes/collection.ts';
import { refundInput } from '../../../../server/src/modules/COL/doctypes/refund.ts';
import { depositTransferInput } from '../../../../server/src/modules/COL/doctypes/deposit-transfer.ts';
import { creditMemoInput } from '../../../../server/src/modules/COL/doctypes/credit-memo.ts';
import { cwtOnlyInput } from '../../../../server/src/modules/COL/doctypes/cwt-only.ts';
import { forfeitInput } from '../../../../server/src/modules/COL/doctypes/forfeit.ts';
import { writeOffInput } from '../../../../server/src/modules/COL/doctypes/write-off.ts';
import { pdcInput } from '../../../../server/src/modules/COL/pdc.ts';
import { depositBody, returnBody } from '../../../../server/src/modules/COL/checks.ts';

const pairs: [string, ZodType, ZodType][] = [
  ...(['customerInput', 'groupInput', 'personInput', 'chartInput'] as const).map((key): [string, ZodType, ZodType] => [key, cus[key], serverCus[key]]),
  ['catalog item', cat.itemInput, serverCat.itemInput], ['catalog price', cat.priceInput, serverCat.priceInput],
  ['job order', jo.jobOrderInput, jobOrderInput], ['opening job order', jo.openingJobOrderInput, openingJobOrderInput],
  ['release', jo.releaseInput, releaseInput], ['invoice', jo.invoiceRecordInput, invoiceRecordInput], ['downpayment invoice', jo.dpInvoiceInput, dpInvoiceInput],
  ['quick sale', qs.saleInput, saleInput], ['quotation', quo.quotationInput, quotationInput], ['collection', col.collectionInput, collectionInput],
  ['refund', col.refundInput, refundInput], ['transfer', col.depositTransferInput, depositTransferInput], ['credit memo', col.creditMemoInput, creditMemoInput],
  ['2307', col.cwtOnlyInput, cwtOnlyInput], ['forfeit', col.forfeitInput, forfeitInput], ['write-off', col.writeOffInput, writeOffInput],
  ['post-dated check', col.pdcInput, pdcInput], ['deposit checks', col.depositBody, depositBody], ['return check', col.returnBody, returnBody],
  ['sizer loan', szr.szrLoanInput, serverSzr.szrLoanInput], ['sizer return', szr.szrReturnInput, serverSzr.szrReturnInput], ['mail settings', com.settingsInput, serverCom.settingsInput],
];
it.each(pairs)('%s uses the same field limits and formats as its server schema', (_name, browser, server) => {
  expect(z.toJSONSchema(browser, { unrepresentable: 'any' })).toEqual(z.toJSONSchema(server, { unrepresentable: 'any' }));
});
it('custom catalog checks accept and refuse the same entries as the server', () => {
  for (const garmentType of [null, 'jersey']) for (const unit of ['pc', 'set']) for (const setComponents of [1, 2, 101]) {
    const input = { code: 'SAMPLE', name: 'Sample', class: 'made_to_order_garment', garmentType, unit, setComponents };
    expect(cat.itemInput.safeParse(input).success).toBe(serverCat.itemInput.safeParse(input).success);
  }
});
