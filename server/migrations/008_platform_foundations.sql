CREATE TABLE clients (
 id TEXT PRIMARY KEY,
 legal_name TEXT NOT NULL,
 display_name TEXT NOT NULL,
 tax_id TEXT,
 email TEXT,
 phone TEXT,
 whatsapp TEXT,
 address TEXT,
 website TEXT,
 industry TEXT,
 owner_id TEXT REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX clients_tax_id_unique ON clients(tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX clients_name_idx ON clients(display_name COLLATE NOCASE);
CREATE TABLE client_leads (
 lead_id TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE RESTRICT,
 client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 linked_at TEXT NOT NULL,
 linked_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX client_leads_client_idx ON client_leads(client_id);
CREATE TABLE quote_counters (year INTEGER PRIMARY KEY, last_number INTEGER NOT NULL);
CREATE TABLE quotes (
 id TEXT PRIMARY KEY,
 number TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 lead_id TEXT REFERENCES leads(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','rejected')),
 subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
 discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents >= 0),
 tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_cents >= 0),
 total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
 deposit_cents INTEGER NOT NULL DEFAULT 0 CHECK(deposit_cents >= 0),
 valid_until TEXT,
 terms TEXT,
 notes TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 accepted_at TEXT
);
CREATE INDEX quotes_client_status_idx ON quotes(client_id,status,created_at DESC);
CREATE TABLE quote_items (
 id TEXT PRIMARY KEY,
 quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,
 description TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
 UNIQUE(quote_id,position)
);
ALTER TABLE sales ADD COLUMN quote_id TEXT REFERENCES quotes(id) ON DELETE RESTRICT;
CREATE TABLE projects (
 id TEXT PRIMARY KEY,
 sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
 client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'pending_content' CHECK(status IN ('pending_content','planning','design','development','internal_review','client_review','corrections','approved','publication','delivered')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 delivered_at TEXT
);
CREATE INDEX projects_status_idx ON projects(status,updated_at DESC);
CREATE TABLE platform_audit (
 id TEXT PRIMARY KEY,
 entity TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 operation TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 before_data TEXT,
 after_data TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX platform_audit_entity_idx ON platform_audit(entity,entity_id,created_at DESC);
INSERT INTO projects(id,sale_id,status,created_at,updated_at)
SELECT 'project-'||s.id,s.id,'pending_content',MIN(p.confirmed_at),MIN(p.confirmed_at)
FROM sales s JOIN payments p ON p.sale_id=s.id
WHERE p.status='confirmed'
GROUP BY s.id;
INSERT OR IGNORE INTO services(id,name,default_price) VALUES
 ('service-web-600','Desarrollo web',600),
 ('service-analytics-200','Analítica',200),
 ('service-payments-200','Integración de pagos',200),
 ('service-bookings-200','Calendario y reservas',200),
 ('service-maintenance-99','Mantenimiento mensual',99);
