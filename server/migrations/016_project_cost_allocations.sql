CREATE TABLE project_cost_allocations (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
 domain_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(domain_cost_cents >= 0),
 chatgpt_cost_cents INTEGER NOT NULL DEFAULT 2000 CHECK(chatgpt_cost_cents >= 0),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
