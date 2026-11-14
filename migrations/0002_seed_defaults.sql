-- CROVO SPACE — Cloudflare D1 Migration 0002 (Default Settings, Poll & Tool Services)
-- Uses INSERT OR IGNORE so existing production records are never overwritten.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('qureo_offer_price', '50'),
  ('qureo_old_price', '100'),
  ('fin_offer_price', '50'),
  ('fin_old_price', '100'),
  ('bundle_offer_price', '100'),
  ('bundle_old_price', '200'),
  ('offer_ends_at', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+72 hours')),
  ('after_offer_mode', 'regular_price'),
  ('orders_enabled', 'true'),
  ('poll_closed', 'false'),
  ('library_ad_enabled', 'true'),
  ('library_ad_title', 'لسه بتحل المنصة بنفسك؟'),
  ('library_ad_subtitle', 'وفر وقتك مع أداة CROVO'),
  ('library_ad_price_text', 'حل المنصة بالكامل بـ50 جنيه فقط'),
  ('library_ad_cta', 'اعرف أكتر'),
  ('library_ad_cta_link', '/tool'),
  ('library_ad_image_url', '/media/crovo-promo-ad.jpg'),
  ('library_ad_delay_seconds', '60'),
  ('library_ad_cooldown_hours', '24'),
  ('library_ad_template_mode', 'classic'),
  ('hero_promo_enabled', 'true'),
  ('hero_promo_title', 'أداة CROVO الذكية — خلّص المنصة كلها في 4 دقايق'),
  ('hero_promo_subtitle', 'بتسجل دخولك بمحاكاة بشرية كاملة وتكتب وتجاوب بدقة 100% من غير ما المنصة تشك في أي حاجة.'),
  ('promo_banner_enabled', 'true'),
  ('promo_banner_text', 'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط'),
  ('notifications_enabled', 'true'),
  ('notifications_interval_days', '3'),
  ('admin_whatsapp_display', '201550324450'),
  ('tracking_started_at', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO polls (id, slug, question, is_open, starts_at, ends_at, created_at, updated_at)
VALUES (
  'poll_extend_offer',
  'extend-offer',
  'إيه رأيكم نمد العرض؟',
  1,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  NULL,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
);

INSERT OR IGNORE INTO poll_options (id, poll_id, option_key, label, sort_order) VALUES
  ('opt_extend', 'poll_extend_offer', 'extend', 'أيوه، نمد العرض.', 1),
  ('opt_enough', 'poll_extend_offer', 'enough', 'لا، العرض كفاية.', 2);

INSERT OR IGNORE INTO tool_services (key, name, grade, description, is_visible, config_json, updated_at) VALUES
  ('qureo_bac1', 'أداة حل منصة QUREO — أولى بكالوريا', 'bac1', 'إنهاء جميع مستويات جافا (42 مستوى) بمحاكاة بشرية كاملة.', 1, '{}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('qureo_bac2_java', 'أداة حل منصة QUREO (Java) — تانية بكالوريا', 'bac2', 'حل 54 مستوى جافا متقدمة أوتوماتيكياً بأمان تام.', 1, '{}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('qureo_bac2_python', 'قسم بايثون Python — تانية بكالوريا', 'bac2', 'متاح قريباً للتنفيذ الأوتوماتيكي الكامل.', 0, '{}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('financial_bac2', 'أداة حل الثقافة المالية — تانية بكالوريا', 'bac2', 'حل جميع فصول الثقافة المالية والاختبارات النهائية بنسبة 100%.', 1, '{}', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
