-- CROVO SPACE — Migration 0004: Before/After Solution Images on Comments
ALTER TABLE comments ADD COLUMN attachment_before_url TEXT;
ALTER TABLE comments ADD COLUMN attachment_after_url TEXT;
