ALTER TABLE project_access ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
CREATE TABLE project_invitations (
 id text PRIMARY KEY,
 org_id text NOT NULL,
 project_id text NOT NULL,
 inviter_id text NOT NULL REFERENCES users(id),
 email text NOT NULL,
 contribute boolean NOT NULL,
 review boolean NOT NULL,
 merge boolean NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
 accepted_by text REFERENCES users(id),
 accepted_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,project_id) REFERENCES projects(org_id,id),
 CHECK(email=lower(email)),
 CHECK((accepted_by IS NULL)=(accepted_at IS NULL))
);
CREATE UNIQUE INDEX project_invitations_pending ON project_invitations(project_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
