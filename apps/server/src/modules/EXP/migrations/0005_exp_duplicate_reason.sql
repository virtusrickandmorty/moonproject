-- Why a supplier invoice already on a posted bill or voucher was recorded again (DUPLICATE_INVOICE, by someone who may
-- backdate). NULL on every other voucher. No journal is touched here.
ALTER TABLE exp_vouchers ADD COLUMN duplicate_reason TEXT;
