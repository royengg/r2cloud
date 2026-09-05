ALTER TABLE memberships ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin','owner'));
ALTER TABLE projects ALTER COLUMN repo_id DROP NOT NULL;
CREATE TABLE onboarding_receipts ("userId" text NOT NULL REFERENCES users ON DELETE RESTRICT, key text NOT NULL, digest text NOT NULL, result jsonb NOT NULL, PRIMARY KEY("userId",key));

-- GitHub-only sign-in has no email delivery flow.
DROP TABLE auth_mail_outbox;
