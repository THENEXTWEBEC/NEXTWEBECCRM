PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
 full_name TEXT NOT NULL, phone TEXT, role TEXT NOT NULL CHECK(role IN ('admin','sales')),
 is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, default_price REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS leads (
 id TEXT PRIMARY KEY, company_name TEXT NOT NULL, contact_name TEXT NOT NULL, job_title TEXT, phone TEXT, whatsapp TEXT, email TEXT, website TEXT, city TEXT, country TEXT,
 service_id TEXT REFERENCES services(id) ON DELETE SET NULL, estimated_value REAL NOT NULL DEFAULT 0, source TEXT, lead_origin TEXT NOT NULL DEFAULT 'self_generated',
 status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'medium', owner_id TEXT NOT NULL REFERENCES users(id), original_owner_id TEXT NOT NULL REFERENCES users(id), created_by TEXT NOT NULL REFERENCES users(id), updated_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 last_contact_at TEXT, next_action TEXT, next_action_at TEXT, notes TEXT, loss_reason TEXT, deleted_at TEXT, deleted_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS leads_owner_updated_idx ON leads(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads(email);
CREATE INDEX IF NOT EXISTS leads_website_idx ON leads(website);
CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), created_by TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, subject TEXT NOT NULL, body TEXT, result TEXT DEFAULT 'completed', occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), due_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id), total_value REAL NOT NULL, collected_amount REAL NOT NULL DEFAULT 0, pending_balance REAL NOT NULL DEFAULT 0, signed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), amount REAL NOT NULL CHECK(amount > 0), paid_at TEXT NOT NULL, payment_method TEXT, reference TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS commissions (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id), owner_id TEXT NOT NULL REFERENCES users(id), rate REAL NOT NULL DEFAULT 0.4, generated_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, paid_at TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS lead_status_history (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), old_status TEXT, new_status TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS lead_audit_log (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), actor_id TEXT NOT NULL REFERENCES users(id), operation TEXT NOT NULL, before_data TEXT, after_data TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
INSERT OR IGNORE INTO services(id,name,default_price) VALUES
 ('service-landing','Landing page / rediseño básico',250),
 ('service-professional','Web profesional',450),
 ('service-business','Web empresarial',750),
 ('service-corporate','Web corporativa',1350),
 ('service-large','Proyecto corporativo amplio',2000),
 ('service-custom','Otro / personalizado',0);
