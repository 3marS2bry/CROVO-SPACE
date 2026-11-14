-- CROVO SPACE — Cloudflare D1 Schema Migration 0001
-- Mirrors the local SQLite database schema 1:1 with indexes and foreign keys.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT 'bac1',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspend_reason TEXT,
  last_active_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  author_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  rating INTEGER NOT NULL,
  content TEXT NOT NULL,
  avatar_url TEXT,
  attachment_url TEXT,
  contact_phone TEXT,
  show_contact_publicly INTEGER NOT NULL DEFAULT 0,
  is_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'approved',
  moderation_note TEXT,
  reports_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_visitor ON comments(visitor_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);

CREATE TABLE IF NOT EXISTS comment_reports (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(comment_id, visitor_id),
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS likes (
  item_key TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_key, visitor_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_item_user ON likes(item_key, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS poll_votes (
  visitor_id TEXT PRIMARY KEY,
  choice TEXT NOT NULL CHECK (choice IN ('extend', 'enough')),
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  option_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(poll_id, option_key),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_poll_votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  option_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_poll_votes_poll ON user_poll_votes(poll_id, option_key);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_code TEXT UNIQUE NOT NULL,
  client_request_id TEXT UNIQUE,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  full_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  platforms_json TEXT NOT NULL,
  platform_label TEXT NOT NULL,
  section_details TEXT NOT NULL,
  platform_username TEXT NOT NULL,
  encrypted_password TEXT,
  password_iv TEXT,
  password_auth_tag TEXT,
  credentials_purged INTEGER NOT NULL DEFAULT 0,
  old_price INTEGER NOT NULL,
  final_price INTEGER NOT NULL,
  offer_applied INTEGER NOT NULL DEFAULT 1,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  whatsapp_status TEXT NOT NULL DEFAULT 'click_to_chat',
  whatsapp_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_visitor ON orders(visitor_id);

CREATE TABLE IF NOT EXISTS uploaded_media (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data BLOB NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_stats (
  question_key TEXT PRIMARY KEY,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  chapter_num INTEGER NOT NULL,
  q_index INTEGER NOT NULL,
  question_title TEXT NOT NULL,
  copy_count INTEGER NOT NULL DEFAULT 0,
  last_copied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_question_stats_copies ON question_stats(copy_count DESC);

CREATE TABLE IF NOT EXISTS question_reports (
  id TEXT PRIMARY KEY,
  question_key TEXT NOT NULL,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  chapter_num INTEGER NOT NULL,
  q_index INTEGER NOT NULL,
  question_title TEXT NOT NULL,
  description TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(question_key, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_qreports_status_created ON question_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sent_at TEXT,
  last_message_id TEXT,
  last_error TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_enabled ON push_subscriptions(enabled, last_sent_at);

CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  trigger_type TEXT NOT NULL,
  error_detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_logs_created ON notification_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS library_chapters (
  id TEXT PRIMARY KEY,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  chapter_num INTEGER NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE(grade, section, chapter_num)
);

CREATE INDEX IF NOT EXISTS idx_lib_chapters_gs ON library_chapters(grade, section, sort_order);

CREATE TABLE IF NOT EXISTS library_questions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  grade TEXT NOT NULL,
  section TEXT NOT NULL,
  chapter_num INTEGER NOT NULL,
  q_index INTEGER NOT NULL,
  q_text TEXT NOT NULL,
  a_text TEXT NOT NULL,
  is_code INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  FOREIGN KEY (chapter_id) REFERENCES library_chapters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lib_questions_lookup ON library_questions(grade, section, chapter_num, q_index);

CREATE TABLE IF NOT EXISTS tool_services (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  description TEXT NOT NULL,
  is_visible INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  visitor_id TEXT,
  service_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_runs_created ON tool_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  path TEXT,
  grade TEXT,
  section TEXT,
  chapter_num INTEGER,
  query TEXT,
  results_count INTEGER,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_type_created ON analytics_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor_created ON analytics_events(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
