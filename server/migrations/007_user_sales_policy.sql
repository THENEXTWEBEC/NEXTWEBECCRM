ALTER TABLE users ADD COLUMN commission_enabled INTEGER NOT NULL DEFAULT 1 CHECK(commission_enabled IN (0,1));
ALTER TABLE users ADD COLUMN commission_rate REAL CHECK(commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- Administrators do not receive commission by default. This replaces the
-- previous name-based exception while preserving every historical sale rate.
UPDATE users SET commission_enabled = 0 WHERE role = 'admin';
