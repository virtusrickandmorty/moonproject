-- Local HTTPS (PLAN C6, OWN-13): the app's own CA and the server certificates it issues for this PC. Kept in the
-- database like the other secrets, so a restore on a new PC brings back the CA every phone and PC already trusts.
-- Insert-only: a new server certificate (new address, or 30 days before the old one ends) is a new row; the newest
-- counts. One CA per database.
CREATE TABLE tls_certificates (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('ca', 'server')),
  cert_pem        TEXT NOT NULL,
  key_pem         TEXT NOT NULL,
  fingerprint256  TEXT NOT NULL,
  not_after       TEXT NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX tls_certificates_one_ca ON tls_certificates(kind) WHERE kind = 'ca';
CREATE TRIGGER tls_certificates_no_update BEFORE UPDATE ON tls_certificates
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE: a certificate is replaced by a new row, never edited'); END;
