-- 2.1.58 (M24 ux690pt2): the session remembers the remote that issued its token.
-- Login writes the effective remote address (`--remote-url` > `config.remoteApiUrl`
-- > the production constant) into `issuer_url`. The token is injected only while
-- the current effective address equals it; under another address the project is
-- logged out, and the row is neither sent nor deleted — returning to the issuer
-- restores the session.
--
-- NULL = a row written before this column existed: the project reads as logged
-- out. No data step: the issuer of an existing token is not known.

ALTER TABLE remote_session ADD COLUMN issuer_url TEXT;
