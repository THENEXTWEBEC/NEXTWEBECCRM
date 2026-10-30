CREATE TABLE expenses (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 category TEXT NOT NULL CHECK(category IN ('hosting','advertising','software','tools','external_services','other')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 incurred_at TEXT NOT NULL,
 frequency TEXT NOT NULL DEFAULT 'once' CHECK(frequency IN ('once','monthly','yearly')),
 vendor TEXT,
 project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','void')),
 paid_at TEXT,
 payment_method TEXT,
 reference TEXT,
 receipt_url TEXT,
 notes TEXT,
 request_key TEXT UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 void_reason TEXT,
 voided_by TEXT REFERENCES users(id),
 voided_at TEXT,
 CHECK((status='paid' AND paid_at IS NOT NULL) OR status!='paid')
);
CREATE INDEX expenses_date_status_idx ON expenses(incurred_at,status);
CREATE INDEX expenses_project_idx ON expenses(project_id,incurred_at);
CREATE INDEX expenses_recurring_idx ON expenses(frequency,status,incurred_at);
