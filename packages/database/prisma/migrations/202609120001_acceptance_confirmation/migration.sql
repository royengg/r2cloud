ALTER TABLE approvals ADD COLUMN acceptance_confirmed_at timestamptz;
ALTER TABLE approvals ADD CONSTRAINT approvals_acceptance_publication
  CHECK (acceptance_confirmed_at IS NULL OR action = 'publish');
