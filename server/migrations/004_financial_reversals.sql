ALTER TABLE payments ADD COLUMN void_reason TEXT;
ALTER TABLE payments ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE payments ADD COLUMN voided_at TEXT;
ALTER TABLE commission_payouts ADD COLUMN void_reason TEXT;
ALTER TABLE commission_payouts ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE commission_payouts ADD COLUMN voided_at TEXT;
ALTER TABLE commission_payouts ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX payout_request_key ON commission_payouts(request_key) WHERE request_key IS NOT NULL;
CREATE TABLE financial_archive (
 id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, snapshot TEXT NOT NULL,
 archived_by TEXT NOT NULL REFERENCES users(id), archived_at TEXT NOT NULL
);
