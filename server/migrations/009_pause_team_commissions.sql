-- Preserve existing financial records and the former rate for a future restart.
INSERT OR IGNORE INTO settings(key,value)
SELECT 'commission_rate_before_pause', value FROM settings WHERE key='commission_rate';
INSERT OR IGNORE INTO settings(key,value) VALUES('commission_pause_started_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO settings(key,value) VALUES('team_commissions_paused','1')
ON CONFLICT(key) DO UPDATE SET value='1';
UPDATE settings SET value='0' WHERE key='commission_rate';
UPDATE users
SET is_active=0, commission_enabled=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE role='sales' AND (is_active<>0 OR commission_enabled<>0);
