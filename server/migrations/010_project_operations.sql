ALTER TABLE projects ADD COLUMN project_name TEXT;
ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE projects ADD COLUMN due_at TEXT;
ALTER TABLE projects ADD COLUMN scope TEXT;
ALTER TABLE projects ADD COLUMN github_url TEXT;
ALTER TABLE projects ADD COLUMN domain TEXT;
ALTER TABLE projects ADD COLUMN hosting TEXT;
ALTER TABLE projects ADD COLUMN production_url TEXT;

UPDATE projects
SET project_name = (SELECT company_name FROM leads JOIN sales ON sales.lead_id=leads.id WHERE sales.id=projects.sale_id)
WHERE project_name IS NULL;

CREATE TABLE project_tasks (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
 description TEXT,
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','cancelled')),
 due_at TEXT,
 assignee_id TEXT REFERENCES users(id),
 depends_on TEXT REFERENCES project_tasks(id) ON DELETE SET NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(depends_on IS NULL OR depends_on<>id)
);
CREATE INDEX project_tasks_project_status_idx ON project_tasks(project_id,status,due_at);
CREATE INDEX project_tasks_assignee_due_idx ON project_tasks(assignee_id,status,due_at);
