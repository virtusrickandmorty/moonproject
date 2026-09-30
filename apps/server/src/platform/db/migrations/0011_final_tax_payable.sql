-- 2312 Final withholding tax payable (PLAN D5 DIV): the final tax Virtus withholds as a withholding agent, first on cash
-- dividends to individual stockholders (NIRC Sec. 24(B)(2), 10%), paid to the BIR with the 1601-FQ each quarter. Role key
-- FINAL_TAX_PAYABLE so posting rules name it; no party (who it was withheld from is on the dividend declaration's lines).
-- Sits between 2311 EWT payable (530) and 2320 income tax payable (540) under 2300 Taxes payable.
INSERT INTO accounts (code, name, type, normal_side, role_key, party_type, is_header, is_postable, is_cash_place, is_reserved, sort_order) VALUES
('2312', 'Final withholding tax payable', 'liability', 'credit', 'FINAL_TAX_PAYABLE', NULL, 0, 1, 0, 0, 535);

-- The final tax rate on cash dividends to individual resident citizens, as a dated setting so a change of law is a new
-- version and a posted declaration keeps the rate it used.
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('tax.dividend_final_tax_bp', '2000-01-01', '1000', 'Default at install: 10% final tax on cash dividends to individual resident citizens (NIRC Sec. 24(B)(2))', '2026-09-28T00:00:00.000+08:00');
