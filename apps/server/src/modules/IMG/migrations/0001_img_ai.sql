-- The image tools' online AI (the owner's request, Oct 2026): redraw a jersey photo flat (Fal.ai: Nano Banana Pro or
-- FLUX Kontext) and vectorize cleanly (Recraft), paid per picture. The settings are one row changed with a version and
-- an audit row: the monthly limit and the peso rate used to show costs. The Fal.ai key is never here (a locked file,
-- ai.ts). Every run is logged with what it cost, so the month's spending is known before the next run.

CREATE TABLE img_ai_settings (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  monthly_cap_peso  INTEGER NOT NULL CHECK (monthly_cap_peso BETWEEN 0 AND 1000000),
  rate_centavos     INTEGER NOT NULL CHECK (rate_centavos BETWEEN 100 AND 100000), -- pesos per US$, x100 (58.00 = 5800)
  version           INTEGER NOT NULL CHECK (version >= 1),
  updated_at        TEXT NOT NULL,
  updated_by        TEXT REFERENCES users(id)
) STRICT;

-- One run of an online AI step. Insert-only. cost_mills: thousandths of a US$ (0.150 = 150); 0 when it failed (Fal.ai
-- charges only for a result). The peso rate is kept with each run, so a later change of rate leaves past costs as shown.
-- result_id: where its picture is kept (img-work, three days), so a paid picture can be downloaded again.
CREATE TABLE img_ai_runs (
  id             TEXT PRIMARY KEY,
  at             TEXT NOT NULL,
  month          TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  user_id        TEXT NOT NULL REFERENCES users(id),
  step           TEXT NOT NULL CHECK (step IN ('redraw', 'back', 'mockup', 'vectorize')),
  model          TEXT NOT NULL,
  ok             INTEGER NOT NULL CHECK (ok IN (0, 1)),
  cost_mills     INTEGER NOT NULL CHECK (cost_mills >= 0),
  rate_centavos  INTEGER NOT NULL CHECK (rate_centavos > 0),
  ms             INTEGER NOT NULL CHECK (ms >= 0),
  note           TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  result_id      TEXT CHECK (result_id IS NULL OR length(result_id) = 36)
) STRICT;
CREATE INDEX img_ai_runs_month ON img_ai_runs (month);
