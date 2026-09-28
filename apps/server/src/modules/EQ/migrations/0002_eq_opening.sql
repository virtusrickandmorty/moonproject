-- Opening Officer Balance (OBOF-, PLAN D8 "Cut-over" step 3, MIG-02 part 2): what an officer owed the shop, or the shop
-- owed an officer, on the cut-over date. It only stores what was typed; the balance itself, the officer ledger and any
-- settlement afterwards (eq.officer) all read the ledger (1220/2501, party officer), like any other officer money.
CREATE TABLE eq_opening_balances (
  document_id  TEXT PRIMARY KEY REFERENCES documents(id),
  person_id    TEXT NOT NULL REFERENCES eq_people(id),
  direction    TEXT NOT NULL CHECK (direction IN ('owes_shop', 'shop_owes')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note         TEXT NOT NULL CHECK (length(trim(note)) >= 3)
) STRICT;
CREATE INDEX eq_opening_balances_person ON eq_opening_balances(person_id);
CREATE TRIGGER eq_opening_balances_no_update BEFORE UPDATE ON eq_opening_balances
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: posted opening balances are cancelled, never edited'); END;
