-- Purchases with no input VAT on the SLP and the 2550Q (research vat-cwt-ewt §3.8 and §3.9): an expense voucher with no
-- input VAT is a purchase from a non-VAT supplier or without a valid VAT receipt, unless it paid the government. Taxes
-- and licenses (6195) and penalties and surcharges (6290) buy no goods or services, so they stay off both. The
-- accountant confirms the list before the first 2550Q (TAX-1).
ALTER TABLE exp_categories ADD COLUMN is_purchase INTEGER NOT NULL DEFAULT 1 CHECK (is_purchase IN (0, 1));
UPDATE exp_categories SET is_purchase = 0
  WHERE account_id IN (SELECT id FROM accounts WHERE code IN ('6195', '6290'));
