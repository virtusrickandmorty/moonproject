-- Each member pays their own share (the owner's request, Nov 2026): on a group link set so, a member sees the price of
-- their pieces, pays with the shop's QR code and sends the reference and a picture of the payment. Staff check it, then
-- take it as a collection on the member's job order, or say it was not received. A decision never removes the payment.
CREATE TABLE olk_payments (
  id           TEXT PRIMARY KEY,
  response_id  TEXT NOT NULL REFERENCES olk_responses(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 100 AND 1000000000),
  reference    TEXT NOT NULL CHECK (length(reference) BETWEEN 4 AND 60),
  sent_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'not_received')),
  decided_at   TEXT,
  decided_by   TEXT REFERENCES users(id),
  reason       TEXT,                                  -- why it was not received (the member sees it)
  job_order_id TEXT,                                  -- accepted: the job order it is collected on
  version      INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX olk_payments_response ON olk_payments(response_id, sent_at);
CREATE INDEX olk_payments_waiting ON olk_payments(status);

-- The picture of the payment (a screenshot of the transfer), checked to be a picture when sent.
CREATE TABLE olk_payment_files (
  payment_id   TEXT PRIMARY KEY REFERENCES olk_payments(id),
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  data         BLOB NOT NULL
) STRICT;
