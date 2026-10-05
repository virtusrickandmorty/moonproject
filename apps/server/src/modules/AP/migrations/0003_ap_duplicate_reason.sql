-- Why a supplier invoice already on a posted bill or voucher was recorded again (DUPLICATE_INVOICE, by someone who may
-- backdate). NULL on every other bill. No journal is touched here.
ALTER TABLE ap_bills ADD COLUMN duplicate_reason TEXT;
