-- Late-payment penalty paid with a remittance (PLAN D5 STAT-REM "6290 penalties"): Dr 6290 in the same journal, the cash
-- credit covering both. It is not a payable of the month, so amount_cents (what clears the employees' shares) is unchanged.
-- From here on: documents.total_cents = amount_cents + penalty_cents.
ALTER TABLE stat_remittances ADD COLUMN penalty_cents INTEGER NOT NULL DEFAULT 0 CHECK (penalty_cents >= 0);
