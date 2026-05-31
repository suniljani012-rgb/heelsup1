-- =============================================================================
-- HeelsUp — PRODUCTION MIGRATION 001
-- Safe, additive-only migration for an existing D1/SQLite database.
-- Last updated: 2026-05-31
--
-- SAFETY NOTES:
--   • All CREATE TABLE statements use IF NOT EXISTS — safe to re-run.
--   • ALTER TABLE … ADD COLUMN statements will ERROR if the column already
--     exists in SQLite/D1. This is intentional and harmless: D1 runs each
--     statement independently, so a failing ALTER on an existing column does
--     NOT roll back anything else. Simply ignore "duplicate column" errors.
--   • INSERT OR IGNORE INTO settings is fully idempotent.
--   • No existing data is modified or deleted.
--   • Run this migration ONCE on the production database; subsequent re-runs
--     are safe for CREATE TABLE / INSERT OR IGNORE blocks; ALTER TABLE blocks
--     will emit harmless errors for already-existing columns.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- =============================================================================
-- SECTION A: CREATE NEW TABLES (IF NOT EXISTS)
-- These tables may not exist at all in older deployments.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BRANDS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- PRODUCT_IMAGES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  alt         TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- PRODUCT_SIZE_STOCK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_size_stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_label  TEXT NOT NULL,
  stock       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, size_label)
);

-- ---------------------------------------------------------------------------
-- INVENTORY_LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER REFERENCES products(id),
  product_name    TEXT,
  change_type     TEXT NOT NULL
                    CHECK(change_type IN ('sale','return','adjustment','import')),
  quantity_before INTEGER NOT NULL DEFAULT 0,
  quantity_change INTEGER NOT NULL DEFAULT 0,
  quantity_after  INTEGER NOT NULL DEFAULT 0,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- PAYMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_order_id   TEXT,
  provider_payment_id TEXT,
  amount              REAL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','captured','failed','refunded')),
  refund_id           TEXT,
  refund_amount       REAL,
  raw_payload         TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- ACTIVITY_LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- SESSIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- OTP_TOKENS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  otp_hash   TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'register'
               CHECK(purpose IN ('register','forgot','login')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  verified   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- PAGES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT,
  meta_title  TEXT,
  meta_desc   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- COLLECTIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  image_url   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- COLLECTION_PRODUCTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_products (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(collection_id, product_id)
);

-- ---------------------------------------------------------------------------
-- COUPONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT UNIQUE NOT NULL,
  type           TEXT NOT NULL DEFAULT 'percent'
                   CHECK(type IN ('percent','flat','free_shipping')),
  value          REAL NOT NULL DEFAULT 0,
  min_order      REAL NOT NULL DEFAULT 0,
  max_discount   REAL,
  usage_limit    INTEGER,
  used_count     INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  active         INTEGER NOT NULL DEFAULT 1,
  starts_at      TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- ADDRESSES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addresses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT,
  full_name    TEXT,
  phone        TEXT,
  line1        TEXT NOT NULL,
  line2        TEXT,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  pincode      TEXT NOT NULL,
  country      TEXT NOT NULL DEFAULT 'India',
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- CARTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size        TEXT,
  color       TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id, size, color)
);

-- ---------------------------------------------------------------------------
-- WISHLISTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlists (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, product_id)
);

-- ---------------------------------------------------------------------------
-- PRODUCT_REVIEWS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id),
  order_id      INTEGER REFERENCES orders(id),
  rating        INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title         TEXT,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','approved','rejected')),
  is_verified   INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- BANNERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT,
  subtitle    TEXT,
  image_url   TEXT NOT NULL,
  link_url    TEXT,
  position    TEXT NOT NULL DEFAULT 'hero',
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- BLOGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blogs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  slug         TEXT UNIQUE,
  content      TEXT,
  excerpt      TEXT,
  image_url    TEXT,
  author_id    INTEGER REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','published')),
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- SHIPPING_RULES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipping_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  min_amount REAL NOT NULL DEFAULT 0,
  max_amount REAL,
  charge     REAL NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- TAX_RULES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  rate        REAL NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- POS_SESSIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id     INTEGER REFERENCES users(id),
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK(status IN ('open','closed')),
  opened_at    TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT
);

-- ---------------------------------------------------------------------------
-- RETURNS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS returns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  user_id       INTEGER REFERENCES users(id),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested'
                  CHECK(status IN ('requested','approved','rejected','completed')),
  refund_amount REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- STAFF
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- SETTINGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- ORDER_ITEMS (may or may not exist)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_sku  TEXT,
  quantity     INTEGER NOT NULL,
  unit_price   REAL NOT NULL,
  line_total   REAL NOT NULL,
  size_label   TEXT,
  image_url    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- SECTION B: ALTER EXISTING TABLES — ADD MISSING COLUMNS
-- Each statement may fail with "duplicate column name" on re-run.
-- That is expected and safe. D1 / SQLite handles each statement independently.
-- =============================================================================

-- ---- users ------------------------------------------------------------------
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN staff_permissions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

-- ---- products ---------------------------------------------------------------
ALTER TABLE products ADD COLUMN slug TEXT;
ALTER TABLE products ADD COLUMN original_price REAL;
ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN is_trending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN sold_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN rating REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN gst_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN sizes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN meta_title TEXT;
ALTER TABLE products ADD COLUMN meta_description TEXT;
ALTER TABLE products ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

-- ---- orders -----------------------------------------------------------------
ALTER TABLE orders ADD COLUMN order_number TEXT;
ALTER TABLE orders ADD COLUMN customer_name TEXT;
ALTER TABLE orders ADD COLUMN customer_email TEXT;
ALTER TABLE orders ADD COLUMN customer_phone TEXT;
ALTER TABLE orders ADD COLUMN address_line1 TEXT;
ALTER TABLE orders ADD COLUMN address_line2 TEXT;
ALTER TABLE orders ADD COLUMN city TEXT;
ALTER TABLE orders ADD COLUMN state TEXT;
ALTER TABLE orders ADD COLUMN pincode TEXT;
ALTER TABLE orders ADD COLUMN country TEXT NOT NULL DEFAULT 'India';
ALTER TABLE orders ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN payment_method TEXT;
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN order_status TEXT NOT NULL DEFAULT 'placed';
ALTER TABLE orders ADD COLUMN subtotal_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN total_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN notes TEXT;
ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'online';
ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT;
ALTER TABLE orders ADD COLUMN razorpay_payment_id TEXT;
ALTER TABLE orders ADD COLUMN razorpay_signature TEXT;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
ALTER TABLE orders ADD COLUMN tracking_url TEXT;
ALTER TABLE orders ADD COLUMN exchange_reason TEXT;
ALTER TABLE orders ADD COLUMN exchange_product TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN confirmed_at TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN out_for_delivery_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN is_pos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

-- ---- categories -------------------------------------------------------------
ALTER TABLE categories ADD COLUMN image_url TEXT;
ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- =============================================================================
-- SECTION C: INDEXES
-- CREATE INDEX IF NOT EXISTS is fully idempotent — safe to re-run anytime.
-- =============================================================================

-- products
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active       ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_featured     ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_is_new       ON products(is_new);
CREATE INDEX IF NOT EXISTS idx_products_is_trending  ON products(is_trending);
CREATE INDEX IF NOT EXISTS idx_products_slug         ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_brand        ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_active_feat  ON products(active, featured);
CREATE INDEX IF NOT EXISTS idx_products_price        ON products(price);

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_user_id        ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_status   ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number   ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_oid   ON orders(razorpay_order_id);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- product_size_stock
CREATE INDEX IF NOT EXISTS idx_pss_product_id ON product_size_stock(product_id);

-- product_images
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- product_reviews
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status     ON product_reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id    ON product_reviews(user_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(user_id, is_read);

-- otp_tokens
CREATE INDEX IF NOT EXISTS idx_otp_email   ON otp_tokens(email);
CREATE INDEX IF NOT EXISTS idx_otp_purpose ON otp_tokens(email, purpose);

-- activity_log
CREATE INDEX IF NOT EXISTS idx_activity_admin_id   ON activity_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_entity     ON activity_log(entity, entity_id);

-- inventory_log
CREATE INDEX IF NOT EXISTS idx_inv_log_product_id ON inventory_log(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_log_created_at ON inventory_log(created_at);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

-- blogs
CREATE INDEX IF NOT EXISTS idx_blogs_status ON blogs(status);
CREATE INDEX IF NOT EXISTS idx_blogs_slug   ON blogs(slug);

-- coupons
CREATE INDEX IF NOT EXISTS idx_coupons_code   ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);

-- addresses
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON addresses(user_id);

-- payments
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

-- carts
CREATE INDEX IF NOT EXISTS idx_carts_user_id ON carts(user_id);

-- wishlists
CREATE INDEX IF NOT EXISTS idx_wishlists_user_id ON wishlists(user_id);

-- returns
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_user_id  ON returns(user_id);

-- pos_sessions
CREATE INDEX IF NOT EXISTS idx_pos_sessions_staff_id ON pos_sessions(staff_id);

-- banners
CREATE INDEX IF NOT EXISTS idx_banners_position  ON banners(position);
CREATE INDEX IF NOT EXISTS idx_banners_is_active ON banners(is_active);

-- =============================================================================
-- SECTION D: DEFAULT SETTINGS (fully idempotent)
-- =============================================================================

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shipping_free_above',      '799'),
  ('shipping_standard_charge', '49'),
  ('exchange_window_days',     '7'),
  ('site_name',                'HeelsUp'),
  ('site_tagline',             'Premium Ladies Footwear'),
  ('email_from_address',       'support@heelsup.in'),
  ('require_email_otp',        'true'),
  ('otp_expiry_minutes',       '10'),
  ('currency',                 'INR'),
  ('currency_symbol',          '₹'),
  ('razorpay_enabled',         'true'),
  ('cod_enabled',              'true'),
  ('cod_min_order',            '0'),
  ('cod_max_order',            '5000');

-- =============================================================================
-- END OF MIGRATION 001
-- =============================================================================
