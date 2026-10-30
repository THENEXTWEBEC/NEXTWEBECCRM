ALTER TABLE sales ADD COLUMN due_at TEXT;
CREATE INDEX sales_due_at_idx ON sales(due_at) WHERE due_at IS NOT NULL;
