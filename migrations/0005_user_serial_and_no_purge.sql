-- Add unique serial_number to users and activity index on analytics_events
ALTER TABLE users ADD COLUMN serial_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_serial_number
  ON users(serial_number)
  WHERE serial_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_user_created
  ON analytics_events(user_id, created_at DESC);
