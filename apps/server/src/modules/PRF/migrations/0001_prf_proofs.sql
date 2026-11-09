-- Design proofs (the owner's request, Nov 2026): staff send the customer a private link with the design of a job order;
-- the customer approves it or asks for a change there, instead of back and forth on Messenger. Each new design for the same
-- job order is the next version, with a link of its own. Nothing here is money: no journal, no document.

CREATE TABLE prf_proofs (
  id             TEXT PRIMARY KEY,
  job_order_id   TEXT NOT NULL REFERENCES documents(id),               -- the job order when the proof was sent
  job_order_no   TEXT NOT NULL,                                         -- its number: an edited job order is followed by it
  version        INTEGER NOT NULL CHECK (version >= 1),
  token          TEXT NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 64), -- the link's private part (staff copy it again)
  note           TEXT CHECK (note IS NULL OR length(note) <= 1000),     -- what staff tell the customer about this design
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users(id),
  UNIQUE (job_order_no, version)
) STRICT;
CREATE INDEX prf_proofs_job_order ON prf_proofs(job_order_no, version);

-- The pictures (or a PDF) of a proof, as checked when sent.
CREATE TABLE prf_files (
  proof_id     TEXT NOT NULL REFERENCES prf_proofs(id),
  file_no      INTEGER NOT NULL CHECK (file_no BETWEEN 1 AND 6),
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes        INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  data         BLOB NOT NULL,
  PRIMARY KEY (proof_id, file_no)
) STRICT;

-- The customer's answer: once per proof. Insert-only.
CREATE TABLE prf_answers (
  proof_id  TEXT PRIMARY KEY REFERENCES prf_proofs(id),
  answer    TEXT NOT NULL CHECK (answer IN ('approved', 'changes')),
  name      TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),       -- who answered, as they typed it
  comment   TEXT CHECK (comment IS NULL OR length(comment) <= 2000),     -- the change asked for (needed then), or a remark
  at        TEXT NOT NULL
) STRICT;

CREATE TRIGGER prf_proofs_no_delete BEFORE DELETE ON prf_proofs BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a proof sent is kept'); END;
CREATE TRIGGER prf_files_no_update BEFORE UPDATE ON prf_files BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a proof''s files stay as sent'); END;
CREATE TRIGGER prf_files_no_delete BEFORE DELETE ON prf_files BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a proof''s files are kept'); END;
CREATE TRIGGER prf_answers_no_update BEFORE UPDATE ON prf_answers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an answer stays as given'); END;
CREATE TRIGGER prf_answers_no_delete BEFORE DELETE ON prf_answers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: an answer is kept'); END;
