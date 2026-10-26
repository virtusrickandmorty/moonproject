-- An expense voucher may pay an approved purchase request (PRQ-, the owner's request, 26 Oct 2026): something asked for
-- and approved, then bought and paid on the spot. Optional: everyday small expenses need no request.
ALTER TABLE exp_vouchers ADD COLUMN request_id TEXT;
