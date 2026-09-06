ALTER TABLE execution_runtime ADD COLUMN models jsonb NOT NULL DEFAULT '[]';
ALTER TABLE execution_runtime ADD COLUMN models_updated_at timestamptz;
