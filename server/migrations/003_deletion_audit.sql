CREATE TABLE opportunity_deletion_log (
 id TEXT PRIMARY KEY,
 opportunity_id TEXT NOT NULL,
 company_name TEXT NOT NULL,
 deleted_by TEXT NOT NULL REFERENCES users(id),
 deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
