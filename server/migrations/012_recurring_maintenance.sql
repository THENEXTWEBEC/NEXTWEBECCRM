CREATE TABLE maintenance_subscriptions (
 id TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
 service_name TEXT NOT NULL CHECK(length(trim(service_name)) BETWEEN 1 AND 160),
 monthly_fee_cents INTEGER NOT NULL CHECK(monthly_fee_cents > 0),
 started_at TEXT NOT NULL,
 next_due_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','cancelled')),
 cancelled_at TEXT,
 notes TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX maintenance_subscriptions_status_due_idx ON maintenance_subscriptions(status,next_due_at);
CREATE INDEX maintenance_subscriptions_client_idx ON maintenance_subscriptions(client_id,status);
CREATE TABLE maintenance_invoices (
 id TEXT PRIMARY KEY,
 subscription_id TEXT NOT NULL REFERENCES maintenance_subscriptions(id) ON DELETE RESTRICT,
 period TEXT NOT NULL CHECK(period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 due_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','void')),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 void_reason TEXT,
 voided_by TEXT REFERENCES users(id),
 voided_at TEXT,
 UNIQUE(subscription_id,period)
);
CREATE INDEX maintenance_invoices_due_idx ON maintenance_invoices(status,due_at);
CREATE TABLE maintenance_payments (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES maintenance_invoices(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 paid_at TEXT NOT NULL,
 payment_method TEXT,
 reference TEXT,
 request_key TEXT UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
);
CREATE INDEX maintenance_payments_date_idx ON maintenance_payments(paid_at);
