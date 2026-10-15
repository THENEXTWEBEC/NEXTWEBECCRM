ALTER TABLE sales ADD COLUMN commission_exempt INTEGER NOT NULL DEFAULT 0 CHECK(commission_exempt IN (0,1));
