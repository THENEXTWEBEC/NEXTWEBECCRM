ALTER TABLE finance_alert_rules ADD COLUMN threshold_bps INTEGER;
ALTER TABLE expenses ADD COLUMN due_at TEXT;
CREATE TABLE finance_objectives (
 id TEXT PRIMARY KEY,
 metric TEXT NOT NULL CHECK(metric IN ('contracted','collected','profit','mrr')),
 period TEXT NOT NULL CHECK(period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'),
 target_cents INTEGER NOT NULL CHECK(target_cents >= 0),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(metric,period)
);
CREATE INDEX finance_objectives_period_idx ON finance_objectives(period,metric);
