-- 2303 Output VAT deferred on uncollected receivables (EOPT law, RR 3-2024, RMC 65-2024): the output VAT the
-- accountant takes off a quarter's 2550Q because a credit sale's agreed time to pay passed unpaid (TAX
-- tax.uncollected_vat: Dr 2301 / Cr 2303, party the customer, ref the invoice), and adds back when the customer pays
-- (tax.uncollected_vat_recovery: Dr 2303 / Cr 2301). Still owed to the BIR if collected, so a liability; it is left
-- out of the quarterly VAT close.
INSERT INTO accounts (code, name, type, normal_side, role_key, party_type, is_header, is_postable, is_cash_place, is_reserved, sort_order) VALUES
('2303', 'Output VAT deferred on uncollected receivables', 'liability', 'credit', 'OUTPUT_VAT_DEFERRED', 'customer', 0, 1, 0, 0, 515);
