-- Phase 1 bootstrap only. Domain tables arrive in Phase 2.
CREATE TABLE IF NOT EXISTS schema_version (
  version INT PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO schema_version (version) VALUES (1);
