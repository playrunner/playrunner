CREATE TABLE IF NOT EXISTS "AuthenticationRenewal" (
  profile_id TEXT PRIMARY KEY REFERENCES "AuthenticationProfile"(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (interval_minutes BETWEEN 15 AND 1440),
  requested BOOLEAN NOT NULL DEFAULT FALSE,
  next_check_at TIMESTAMPTZ,
  lease_id TEXT,
  lease_until TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_result TEXT,
  cookie_expiry_hint TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "AuthenticationRenewal_due_idx"
  ON "AuthenticationRenewal" (next_check_at);
