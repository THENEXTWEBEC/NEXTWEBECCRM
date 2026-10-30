CREATE TABLE finance_accounts (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 kind TEXT NOT NULL CHECK(kind IN ('bank','cash')),
 currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 opening_balance_set INTEGER NOT NULL DEFAULT 0 CHECK(opening_balance_set IN (0,1)),
 opening_balance_cents INTEGER,
 opening_balance_at TEXT,
 opening_note TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE finance_movements (
 id TEXT PRIMARY KEY,
 account_id TEXT REFERENCES finance_accounts(id) ON DELETE RESTRICT,
 direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 occurred_at TEXT NOT NULL,
 kind TEXT NOT NULL,
 source_type TEXT,
 source_id TEXT,
 request_key TEXT UNIQUE,
 reference TEXT,
 memo TEXT,
 reconciled_at TEXT,
 reconciled_by TEXT REFERENCES users(id),
 voided_at TEXT,
 voided_by TEXT REFERENCES users(id),
 void_reason TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 UNIQUE(source_type,source_id)
);
CREATE INDEX finance_movements_account_date_idx ON finance_movements(account_id,occurred_at);
CREATE TABLE finance_distribution_settings (
 category TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 percentage_bps INTEGER NOT NULL CHECK(percentage_bps BETWEEN 0 AND 10000),
 updated_by TEXT REFERENCES users(id),
 updated_at TEXT
);
INSERT INTO finance_distribution_settings VALUES
 ('owner_salary','Sueldo del propietario',4500,NULL,NULL),
 ('reinvestment','Reinversión',2500,NULL,NULL),
 ('reserve','Reserva',1500,NULL,NULL),
 ('tax_provision','Provisión tributaria',1000,NULL,NULL),
 ('bonuses_growth','Bonos y crecimiento',500,NULL,NULL);
CREATE TABLE finance_distributions (
 id TEXT PRIMARY KEY,
 period TEXT NOT NULL CHECK(period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'),
 base_cents INTEGER NOT NULL CHECK(base_cents >= 0),
 percentages_json TEXT NOT NULL,
 amounts_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','void')),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 void_reason TEXT,
 voided_by TEXT REFERENCES users(id),
 voided_at TEXT
);
CREATE UNIQUE INDEX finance_distribution_one_confirmed_idx ON finance_distributions(period) WHERE status='confirmed';
CREATE TABLE finance_projection_scenarios (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 inputs_json TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE finance_alert_rules (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 threshold_cents INTEGER,
 threshold_days INTEGER,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
CREATE TABLE finance_alerts (
 id TEXT PRIMARY KEY,
 rule_id TEXT NOT NULL REFERENCES finance_alert_rules(id),
 event_key TEXT NOT NULL UNIQUE,
 message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
 created_at TEXT NOT NULL,
 resolved_at TEXT,
 resolved_by TEXT REFERENCES users(id)
);
CREATE INDEX finance_alerts_status_idx ON finance_alerts(status,created_at);
