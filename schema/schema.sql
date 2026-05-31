-- ============================================================
-- HEELSUP D1 SCHEMA — SQLite Compatible
-- Run: npx wrangler d1 execute heelsup-live --file=./schema/schema.sql
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── USERS (Customers + Admin + Staff) ────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT,
  password      TEXT NOT NULL,
  role          TEXT DEFAULT 'customer' CHECK(role IN ('customer','admin','staff','manager')),
  avatar_url    TEXT,
  is_active     INTEGER DEFAULT 1,
  email_verified INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- ── ADDRESSES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS addresses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT DEFAULT 'Home',
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  line1      TEXT NOT NULL,
  line2      TEXT,
  city       TEXT NOT NULL,
  state      TEXT NOT NULL,
  pincode    TEXT NOT NULL,
  country    TEXT DEFAULT 'India',
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── CATEGORIES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  image_url   TEXT,
  is_active   INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── PRODUCTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL,
  description  TEXT,
  category_id  INTEGER REFERENCES categories(id),
  price        INTEGER NOT NULL,
  mrp          INTEGER,
  cost_price   INTEGER,
  images       TEXT DEFAULT '[]',
  sizes        TEXT DEFAULT '[]',
  colors       TEXT DEFAULT '[]',
  tags         TEXT DEFAULT '[]',
  weight_grams INTEGER,
  is_active    INTEGER DEFAULT 1,
  is_featured  INTEGER DEFAULT 0,
  meta_title   TEXT,
  meta_desc    TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- ── INVENTORY ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT NOT NULL,
  color      TEXT,
  stock      INTEGER DEFAULT 0,
  reserved   INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, size, color)
);

-- ── COLLECTIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  image_url   TEXT,
  condition   TEXT DEFAULT '{}',
  is_active   INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_products (
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id) ON DELETE CASCADE,
  sort_order    INTEGER DEFAULT 0,
  PRIMARY KEY(collection_id, product_id)
);

-- ── COUPONS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT UNIQUE NOT NULL,
  type            TEXT DEFAULT 'percent' CHECK(type IN ('percent','flat','free_shipping')),
  value           INTEGER DEFAULT 0,
  min_order       INTEGER DEFAULT 0,
  max_discount    INTEGER,
  usage_limit     INTEGER,
  usage_count     INTEGER DEFAULT 0,
  per_user_limit  INTEGER DEFAULT 1,
  is_active       INTEGER DEFAULT 1,
  starts_at       TEXT,
  expires_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ── ORDERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number    TEXT UNIQUE NOT NULL,
  user_id         INTEGER REFERENCES users(id),
  status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','processing','shipped','delivered','cancelled','returned','refunded')),
  payment_status  TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
  payment_method  TEXT DEFAULT 'cod' CHECK(payment_method IN ('cod','upi','card','netbanking','wallet')),
  subtotal        INTEGER NOT NULL,
  discount        INTEGER DEFAULT 0,
  shipping        INTEGER DEFAULT 0,
  tax             INTEGER DEFAULT 0,
  total           INTEGER NOT NULL,
  coupon_code     TEXT,
  address         TEXT NOT NULL,
  razorpay_order_id    TEXT,
  razorpay_payment_id  TEXT,
  notes           TEXT,
  is_pos          INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ── ORDER ITEMS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku         TEXT,
  size        TEXT,
  color       TEXT,
  quantity    INTEGER NOT NULL,
  unit_price  INTEGER NOT NULL,
  total_price INTEGER NOT NULL
);

-- ── CART (server-side sync) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT,
  color      TEXT,
  quantity   INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id, size, color)
);

-- ── WISHLIST ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishlists (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, product_id)
);

-- ── REVIEWS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id),
  order_id   INTEGER REFERENCES orders(id),
  rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title      TEXT,
  body       TEXT,
  is_verified INTEGER DEFAULT 0,
  is_approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── BANNERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT,
  subtitle    TEXT,
  image_url   TEXT NOT NULL,
  link_url    TEXT,
  position    TEXT DEFAULT 'hero',
  is_active   INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── BLOG POSTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blogs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  content     TEXT,
  excerpt     TEXT,
  image_url   TEXT,
  author_id   INTEGER REFERENCES users(id),
  status      TEXT DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- ── STAFF ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  permissions TEXT DEFAULT '[]',
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── SETTINGS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    INTEGER DEFAULT 0,
  data       TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── SHIPPING RULES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipping_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  min_amount  INTEGER DEFAULT 0,
  max_amount  INTEGER,
  charge      INTEGER DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── TAX RULES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  rate        INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── OTP TOKENS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  token      TEXT NOT NULL,
  type       TEXT DEFAULT 'login' CHECK(type IN ('login','register','forgot_password')),
  expires_at TEXT NOT NULL,
  used       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── POS SESSIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id     INTEGER REFERENCES users(id),
  opening_cash INTEGER DEFAULT 0,
  closing_cash INTEGER,
  status       TEXT DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_at    TEXT DEFAULT (datetime('now')),
  closed_at    TEXT
);

-- ── RETURNS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS returns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  user_id    INTEGER REFERENCES users(id),
  reason     TEXT NOT NULL,
  status     TEXT DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected','completed')),
  refund_amount INTEGER,
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── INDEXES (for performance) ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_tokens(email, type);
