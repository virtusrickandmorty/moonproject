import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { defineModule } from '../../engine/documents/registry.ts';
import { taxRoutes } from './routes.ts';
import { vatCloseDoc } from './doctypes/vat-close.ts';
import { birPaymentDoc } from './doctypes/bir-payment.ts';
import { openingWithholdingDoc } from './doctypes/opening.ts';
import { openingPayableDoc } from './doctypes/opening-payable.ts';
import { incomeTaxProvisionDoc } from './doctypes/income-tax-provision.ts';
import { incomeTaxSettlementDoc } from './doctypes/income-tax-settlement.ts';

export default defineModule({
  code: 'TAX',
  name: 'Tax Compliance',
  permissions: [
    { key: 'tax.booklets.view', label: 'See the invoice and receipt booklet register and what each number was used for', defaultRoles: ['encoder', 'accountant', 'owner'] },
    { key: 'tax.registers.view', label: 'See and export the tax registers (sales, purchases, EWT, the 2307s received and to issue), the SLSP and SAWT data, the VAT of a quarter and the 2550Q, 0619-E, 1601-EQ, 1702Q and 1702-RT worksheets, the 1604-E data, the final tax withheld on dividends (1601-FQ and 1604-F), and the income tax settings', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.calendar.view', label: 'See the tax calendar: which BIR returns are due and when', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.vatc.view', label: 'See the quarterly VAT closes', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.vatc.post', label: "Close a quarter's VAT (2550Q): output less input VAT into VAT payable or carry-over", defaultRoles: ['accountant'] },
    { key: 'tax.vatc.cancel', label: 'Cancel a quarterly VAT close', defaultRoles: ['accountant'] },
    { key: 'tax.booklets.manage', label: 'Register, retire and switch back on invoice and receipt booklets', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.payment.view', label: 'See the BIR payments (2550Q VAT, 0619-E and 1601-EQ EWT, 1702Q and 1702 income tax, 1601-FQ final tax)', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.payment.create', label: 'Prepare a BIR payment and see what the return leaves to pay', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.payment.post', label: 'Record a BIR payment: VAT, EWT, income tax or final tax paid with a return, and any penalty', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.payment.cancel', label: 'Cancel a recorded BIR payment', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.income_tax.view', label: 'See the year-end income tax provisions and settlements', defaultRoles: ['accountant', 'owner'] },
    { key: 'tax.income_tax.post', label: "Provide a year's income tax (Dr income tax, Cr income tax payable) and settle it against the 1702Q payments and 2307s", defaultRoles: ['accountant'] },
    { key: 'tax.income_tax.cancel', label: "Cancel a year's income tax provision or settlement", defaultRoles: ['accountant'] },
    { key: 'tax.slsp.classify', label: 'Mark a sale with no output VAT (a journal voucher) zero-rated, exempt or not a sale, for the SLSP', defaultRoles: ['accountant'] },
    { key: 'tax.2307.receive', label: "Mark a customer's 2307 received when it comes after the collection or the opening", defaultRoles: ['accountant', 'owner'] },
  ],
  // tax.opening and tax.payable.opening take ACC's acc.opening.* permissions (OPENING_PERMISSIONS)
  docTypes: [vatCloseDoc, birPaymentDoc, openingWithholdingDoc, openingPayableDoc, incomeTaxProvisionDoc, incomeTaxSettlementDoc],
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), 'migrations'),
  routes: taxRoutes,
});
