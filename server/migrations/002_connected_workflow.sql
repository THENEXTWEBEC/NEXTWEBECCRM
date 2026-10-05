CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings(key,value) VALUES('commission_rate','0.4');
ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','cancelled'));
ALTER TABLE payments ADD COLUMN notes TEXT;
ALTER TABLE payments ADD COLUMN confirmed_by TEXT REFERENCES users(id);
ALTER TABLE payments ADD COLUMN confirmed_at TEXT;
ALTER TABLE payments ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX payments_request_key_idx ON payments(request_key) WHERE request_key IS NOT NULL;
UPDATE payments SET confirmed_by=created_by,confirmed_at=created_at;
CREATE TABLE followups (
 id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), owner_id TEXT NOT NULL REFERENCES users(id),
 due_at TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('call','whatsapp','email','meeting','proposal','other')),
 description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), completed_by TEXT REFERENCES users(id),completed_at TEXT,
 legacy_activity_id TEXT UNIQUE REFERENCES activities(id)
);
INSERT INTO followups(id,lead_id,owner_id,due_at,type,description,status,created_by,created_at,updated_at,completed_at,legacy_activity_id)
 SELECT 'legacy-'||a.id,a.lead_id,l.owner_id,a.due_at,'other',a.subject,
 CASE WHEN a.completed_at IS NOT NULL THEN 'completed' WHEN a.result='cancelled' THEN 'cancelled' ELSE 'pending' END,
 a.created_by,a.occurred_at,a.occurred_at,a.completed_at,a.id FROM activities a JOIN leads l ON l.id=a.lead_id WHERE a.type='task' AND a.due_at IS NOT NULL;
INSERT INTO followups(id,lead_id,owner_id,due_at,type,description,created_by,created_at,updated_at)
 SELECT 'legacy-next-'||l.id,l.id,l.owner_id,l.next_action_at,'other',COALESCE(NULLIF(l.next_action,''),'Seguimiento'),l.created_by,l.created_at,l.updated_at FROM leads l
 WHERE l.next_action_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM followups f WHERE f.lead_id=l.id AND f.status='pending' AND f.due_at=l.next_action_at AND f.description=COALESCE(NULLIF(l.next_action,''),'Seguimiento'));
CREATE TABLE commission_payouts(id TEXT PRIMARY KEY,commission_id TEXT NOT NULL REFERENCES commissions(id),amount REAL NOT NULL CHECK(amount>0),paid_at TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
INSERT INTO commission_payouts(id,commission_id,amount,paid_at,created_at) SELECT 'legacy-'||id,id,paid_amount,COALESCE(paid_at,updated_at),updated_at FROM commissions WHERE paid_amount>0;
INSERT INTO lead_audit_log(id,lead_id,actor_id,operation,before_data,after_data)
 SELECT 'normalize-'||id,id,COALESCE(updated_by,created_by),'UPDATE',json_object('status',status),json_object('status','negotiation') FROM leads WHERE status='awaiting_payment';
INSERT INTO lead_status_history(id,lead_id,old_status,new_status,actor_id)
 SELECT 'normalize-'||id,id,status,'negotiation',COALESCE(updated_by,created_by) FROM leads WHERE status='awaiting_payment';
UPDATE leads SET status='negotiation' WHERE status='awaiting_payment';
CREATE INDEX leads_status_archive_idx ON leads(status,deleted_at);
CREATE INDEX leads_created_idx ON leads(created_at);
CREATE INDEX followups_owner_due_idx ON followups(owner_id,status,due_at);
CREATE INDEX followups_lead_status_idx ON followups(lead_id,status,due_at);
CREATE INDEX activities_lead_date_idx ON activities(lead_id,occurred_at DESC);
CREATE INDEX audit_lead_date_idx ON lead_audit_log(lead_id,created_at DESC);
CREATE INDEX payments_sale_status_idx ON payments(sale_id,status);
CREATE INDEX payments_date_idx ON payments(paid_at);
CREATE INDEX commissions_owner_idx ON commissions(owner_id);
