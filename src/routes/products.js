// worker/src/routes/products.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

// ── Slug generation (deterministic, no timestamp suffix by default) ───────────
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function safeJsonParse(str, fallback = []) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function mapProduct(p, sizeStock = []) {
  if (!p) return null;
  const sizes = safeJsonParse(p.sizes_json, []);

  // Build size_stock map: { "36": 5, "37": 0, ... }
  let sizeStockMap = {};
  if (sizeStock && sizeStock.length > 0) {
    for (const row of sizeStock) {
      sizeStockMap[row.size_label] = row.stock;
    }
  }

  // Compute overall effective stock from size stock if available, else use product.stock
  const effectiveStock =
    sizeStock && sizeStock.length > 0
      ? sizeStock.reduce((s, r) => s + r.stock, 0)
      : Number(p.stock || 0);

  // avg_rating from subquery may be null; fall back to p.rating, then 0
  const rating =
    p.avg_rating !== null && p.avg_rating !== undefined
      ? Number(p.avg_rating)
      : p.rating !== null && p.rating !== undefined
      ? Number(p.rating)
      : 0;

  const reviewCount = p.review_count !== null && p.review_count !== undefined
    ? Number(p.review_count)
    : 0;

  return {
    id: p.id,
    name: p.name,
    slug: p.slug || slugify(p.name),
    sku: p.sku || '',
    category: p.category || '',
    brand: p.brand || null,
    price: Number(p.price),
    original_price: p.original_price ? Number(p.original_price) : null,
    mrp: p.original_price ? Number(p.original_price) : null,
    stock: effectiveStock,
    active: !!p.active,
    is_active: !!p.active,
    featured: !!p.featured,
    is_featured: !!p.featured,
    is_new: !!p.is_new,
    is_trending: !!p.is_trending,
    rating,
    review_count: reviewCount,
    sold_count: Number(p.sold_count || 0),
    sales: Number(p.sold_count || 0),
    sales_count: Number(p.sold_count || 0),
    gst_percent: Number(p.gst_percent || 0),
    category_id: p.category_id || null,
    description: p.description || '',
    sizes: sizes,
    size_stock: sizeStockMap,
    tags: safeJsonParse(p.tags, []),
    meta_title: p.meta_title || null,
    meta_description: p.meta_description || null,
    images: safeJsonParse(p.images_json, p.image_url ? [p.image_url] : []),
    created_at: p.created_at || null,
    updated_at: p.updated_at || null,
  };
}

// ── Size-stock helpers ────────────────────────────────────────────────────────

async function fetchSizeStock(env, productId) {
  try {
    const res = await env.DB.prepare(
      'SELECT size_label, stock FROM product_size_stock WHERE product_id = ? ORDER BY size_label ASC'
    ).bind(productId).all();
    return res.results || [];
  } catch {
    return [];
  }
}

async function fetchSizeStockBatch(env, productIds) {
  if (!productIds.length) return {};
  try {
    const placeholders = productIds.map(() => '?').join(',');
    const res = await env.DB.prepare(
      `SELECT product_id, size_label, stock FROM product_size_stock WHERE product_id IN (${placeholders}) ORDER BY product_id, size_label ASC`
    ).bind(...productIds).all();
    const map = {};
    for (const row of (res.results || [])) {
      if (!map[row.product_id]) map[row.product_id] = [];
      map[row.product_id].push(row);
    }
    return map;
  } catch {
    return {};
  }
}

async function upsertSizeStock(env, productId, sizeStockArray) {
  for (const row of sizeStockArray) {
    await env.DB.prepare(
      `INSERT INTO product_size_stock (product_id, size_label, stock, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(product_id, size_label) DO UPDATE SET stock=excluded.stock, updated_at=datetime('now')`
    ).bind(productId, String(row.size_label), Math.max(0, parseInt(row.stock || 0))).run();
  }
  await syncLegacyStock(env, productId);
}

async function syncLegacyStock(env, productId) {
  try {
    await env.DB.prepare(
      `UPDATE products SET stock = (
        SELECT COALESCE(SUM(stock), 0) FROM product_size_stock WHERE product_id = ?
      ), updated_at = datetime('now') WHERE id = ?`
    ).bind(productId, productId).run();
  } catch { /* non-critical */ }
}

// ── Ensure a slug is unique in the products table ────────────────────────────
async function uniqueSlug(env, baseSlug, excludeId = null) {
  let candidate = baseSlug;
  let attempt = 0;
  while (true) {
    const existing = excludeId
      ? await env.DB.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').bind(candidate, excludeId).first()
      : await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(candidate).first();
    if (!existing) return candidate;
    attempt++;
    // append a short timestamp/counter suffix on collision
    candidate = `${baseSlug}-${Date.now().toString(36)}${attempt > 1 ? attempt : ''}`;
  }
}

// ── Shared subquery fragment for reviews ─────────────────────────────────────
const REVIEW_SUBQUERIES = `
  (SELECT ROUND(AVG(rating),1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as avg_rating,
  (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as review_count
`;

// ── Main router ───────────────────────────────────────────────────────────────
export async function productsRouter(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/products', '') || '/';
  const method = request.method;
  const params = url.searchParams;

  // ── GET /api/products/categories — distinct categories with counts ─────────
  if (path === '/categories' && method === 'GET') {
    try {
      const rows = await env.DB.prepare(
        `SELECT category, COUNT(*) as product_count
         FROM products
         WHERE active = 1 AND category IS NOT NULL AND category != ''
         GROUP BY category
         ORDER BY product_count DESC, category ASC`
      ).all();
      return ok(rows.results || []);
    } catch (e) {
      console.error('Categories error:', e);
      return serverError('Failed to fetch categories');
    }
  }

  // ── GET /api/products/featured — featured products, limit 8 ───────────────
  if (path === '/featured' && method === 'GET') {
    try {
      const limit = Math.min(parseInt(params.get('limit') || '8'), 50);
      const res = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.active = 1 AND p.featured = 1
         ORDER BY p.id DESC
         LIMIT ?`
      ).bind(limit).all();
      const rawProducts = res.results || [];
      const sizeStockBatch = await fetchSizeStockBatch(env, rawProducts.map(p => p.id));
      return ok(rawProducts.map(p => mapProduct(p, sizeStockBatch[p.id] || [])));
    } catch (e) {
      console.error('Featured products error:', e);
      return serverError('Failed to fetch featured products');
    }
  }

  // ── GET /api/products/new-arrivals — is_new products, limit 12 ────────────
  if (path === '/new-arrivals' && method === 'GET') {
    try {
      const limit = Math.min(parseInt(params.get('limit') || '12'), 50);
      const res = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.active = 1 AND p.is_new = 1
         ORDER BY p.id DESC
         LIMIT ?`
      ).bind(limit).all();
      const rawProducts = res.results || [];
      const sizeStockBatch = await fetchSizeStockBatch(env, rawProducts.map(p => p.id));
      return ok(rawProducts.map(p => mapProduct(p, sizeStockBatch[p.id] || [])));
    } catch (e) {
      console.error('New arrivals error:', e);
      return serverError('Failed to fetch new arrivals');
    }
  }

  // ── GET /api/products/trending — is_trending products, limit 12 ───────────
  if (path === '/trending' && method === 'GET') {
    try {
      const limit = Math.min(parseInt(params.get('limit') || '12'), 50);
      const res = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.active = 1 AND p.is_trending = 1
         ORDER BY p.sold_count DESC, p.id DESC
         LIMIT ?`
      ).bind(limit).all();
      const rawProducts = res.results || [];
      const sizeStockBatch = await fetchSizeStockBatch(env, rawProducts.map(p => p.id));
      return ok(rawProducts.map(p => mapProduct(p, sizeStockBatch[p.id] || [])));
    } catch (e) {
      console.error('Trending products error:', e);
      return serverError('Failed to fetch trending products');
    }
  }

  // ── GET /api/products/search — search with q param required ──────────────
  if (path === '/search' && method === 'GET') {
    const q = (params.get('q') || params.get('search') || '').trim();
    if (!q) return error('Search query (q) is required', 400);
    try {
      const page = parseInt(params.get('page') || '1');
      const limit = Math.min(parseInt(params.get('limit') || '20'), 100);
      const offset = (page - 1) * limit;
      const cat = params.get('cat') || params.get('category');
      const minPrice = params.get('min_price');
      const maxPrice = params.get('max_price');
      const sort = params.get('sort') || 'relevance';

      const where = ['p.active = 1', '(p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ? OR p.brand LIKE ?)'];
      const binds = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];

      if (cat) {
        where.push('LOWER(p.category) = LOWER(?)');
        binds.push(cat);
      }
      if (minPrice) { where.push('p.price >= ?'); binds.push(parseFloat(minPrice)); }
      if (maxPrice) { where.push('p.price <= ?'); binds.push(parseFloat(maxPrice)); }

      const sortMap = {
        relevance: 'p.sold_count DESC, p.id DESC',
        newest: 'p.id DESC',
        price_low: 'p.price ASC',
        price_high: 'p.price DESC',
        name: 'p.name ASC',
      };
      const orderBy = sortMap[sort] || 'p.sold_count DESC, p.id DESC';
      const whereStr = 'WHERE ' + where.join(' AND ');

      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM products p ${whereStr}`
      ).bind(...binds).first();

      const res = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         ${whereStr}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();

      const rawProducts = res.results || [];
      const sizeStockBatch = await fetchSizeStockBatch(env, rawProducts.map(p => p.id));

      // Add simple highlight: mark which field matched
      const products = rawProducts.map(p => {
        const mapped = mapProduct(p, sizeStockBatch[p.id] || []);
        const ql = q.toLowerCase();
        mapped._match = {
          name: mapped.name.toLowerCase().includes(ql),
          description: (mapped.description || '').toLowerCase().includes(ql),
          brand: (mapped.brand || '').toLowerCase().includes(ql),
          tags: (mapped.tags || []).some(t => String(t).toLowerCase().includes(ql)),
        };
        return mapped;
      });

      return list(products, {
        page, limit,
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit),
        query: q,
      });
    } catch (e) {
      console.error('Search error:', e);
      return serverError('Search failed');
    }
  }

  // ── GET /api/products — public listing with filters ───────────────────────
  if (path === '/' && method === 'GET') {
    try {
      const page = parseInt(params.get('page') || '1');
      const limit = Math.min(parseInt(params.get('limit') || '20'), 100);
      const offset = (page - 1) * limit;
      const cat = params.get('cat') || params.get('category');
      const featured = params.get('featured');
      const isNew = params.get('is_new');
      const trending = params.get('trending');
      const search = params.get('q') || params.get('search');
      const sort = params.get('sort') || 'newest';
      const tag = params.get('tag');
      const minPrice = params.get('min_price');
      const maxPrice = params.get('max_price');
      const sizeFilter = params.get('size');

      let where = ['p.active = 1'];
      let binds = [];

      if (cat) {
        where.push('LOWER(p.category) = LOWER(?)');
        binds.push(cat);
      }
      if (featured === 'true' || featured === '1') where.push('p.featured = 1');
      if (isNew === 'true' || isNew === '1') where.push('p.is_new = 1');
      if (trending === 'true' || trending === '1') where.push('p.is_trending = 1');
      if (search) {
        where.push('(p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)');
        binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (tag) {
        where.push('p.tags LIKE ?');
        binds.push(`%"${tag}"%`);
      }
      if (minPrice) { where.push('p.price >= ?'); binds.push(parseFloat(minPrice)); }
      if (maxPrice) { where.push('p.price <= ?'); binds.push(parseFloat(maxPrice)); }
      if (sizeFilter) {
        where.push(
          'EXISTS (SELECT 1 FROM product_size_stock pss WHERE pss.product_id = p.id AND pss.size_label = ? AND pss.stock > 0)'
        );
        binds.push(sizeFilter);
      }

      const sortMap = {
        newest: 'p.id DESC',
        oldest: 'p.id ASC',
        price_low: 'p.price ASC',
        price_high: 'p.price DESC',
        name: 'p.name ASC',
        popular: 'p.sold_count DESC, p.id DESC',
      };
      const orderBy = sortMap[sort] || 'p.id DESC';
      const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM products p ${whereStr}`
      ).bind(...binds).first();

      const productsRes = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         ${whereStr}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();

      const rawProducts = productsRes.results || [];
      const productIds = rawProducts.map(p => p.id);
      const sizeStockBatch = await fetchSizeStockBatch(env, productIds);
      const products = rawProducts.map(p => mapProduct(p, sizeStockBatch[p.id] || []));

      return list(products, {
        page, limit,
        total: countResult.total,
        pages: Math.ceil(countResult.total / limit),
      });
    } catch (e) {
      console.error('Products list error:', e);
      return serverError('Failed to fetch products');
    }
  }

  // ── GET /api/products/slug/:slug ──────────────────────────────────────────
  if (path.startsWith('/slug/') && method === 'GET') {
    const productSlug = decodeURIComponent(path.replace('/slug/', ''));
    if (!productSlug) return error('Slug is required', 400);
    try {
      // Primary path: look up by slug column directly
      let product = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.slug = ? AND p.active = 1`
      ).bind(productSlug).first();

      // Backward-compat fallback: scan by generated slug from name
      if (!product) {
        const allProducts = await env.DB.prepare(
          'SELECT id, name FROM products WHERE active = 1'
        ).all();
        const matched = (allProducts.results || []).find(
          p => slugify(p.name) === productSlug
        );
        if (matched) {
          product = await env.DB.prepare(
            `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
             FROM products p
             LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
             WHERE p.id = ? AND p.active = 1`
          ).bind(matched.id).first();
          // Backfill the slug column if missing
          if (product && !product.slug) {
            const newSlug = await uniqueSlug(env, productSlug, product.id);
            await env.DB.prepare(
              "UPDATE products SET slug = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(newSlug, product.id).run();
            product.slug = newSlug;
          }
        }
      }

      if (!product) return notFound('Product not found');

      const [reviews, images, related, sizeStock] = await Promise.all([
        env.DB.prepare(
          `SELECT r.id, r.rating, r.title, r.body, r.created_at,
                  (u.first_name || ' ' || COALESCE(u.last_name, '')) as reviewer_name
           FROM product_reviews r LEFT JOIN users u ON r.user_id = u.id
           WHERE r.product_id = ? AND r.status = 'approved'
           ORDER BY r.created_at DESC LIMIT 10`
        ).bind(product.id).all(),
        env.DB.prepare(
          'SELECT id, url, alt, sort_order, is_primary FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC'
        ).bind(product.id).all(),
        env.DB.prepare(
          `SELECT p.*, c.id as category_id FROM products p
           LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
           WHERE p.category=? AND p.id!=? AND p.active=1
           ORDER BY p.featured DESC LIMIT 4`
        ).bind(product.category, product.id).all(),
        fetchSizeStock(env, product.id),
      ]);

      return ok({
        product: mapProduct(product, sizeStock),
        reviews: reviews.results || [],
        images: images.results || [],
        related: (related.results || []).map(r => mapProduct(r)),
      });
    } catch (e) {
      console.error('Slug fetch error:', e);
      return serverError('Failed to fetch product');
    }
  }

  // ── GET /api/products/:id/size-stock ─────────────────────────────────────
  if (path.match(/^\/\d+\/size-stock$/) && method === 'GET') {
    const id = parseInt(path.split('/')[1]);
    try {
      const rows = await fetchSizeStock(env, id);
      return ok({ product_id: id, size_stock: rows });
    } catch (e) {
      return serverError('Failed to fetch size stock');
    }
  }

  // ── PUT /api/products/:id/size-stock — admin ──────────────────────────────
  if (path.match(/^\/\d+\/size-stock$/) && method === 'PUT') {
    const { error: authError } = await requireAdmin(request, env);
    if (authError) return authError;
    const id = parseInt(path.split('/')[1]);
    try {
      const body = await request.json();
      let sizeStockArray = [];
      if (Array.isArray(body.size_stock)) {
        sizeStockArray = body.size_stock;
      } else if (body.size_stock && typeof body.size_stock === 'object') {
        sizeStockArray = Object.entries(body.size_stock).map(([size_label, stock]) => ({
          size_label: String(size_label),
          stock: Math.max(0, parseInt(stock) || 0),
        }));
      }
      if (!sizeStockArray.length) return error('size_stock required (array or object)', 400);
      await upsertSizeStock(env, id, sizeStockArray);
      const total = sizeStockArray.reduce((sum, r) => sum + (parseInt(r.stock) || 0), 0);
      await env.DB.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").bind(total, id).run();
      const rows = await fetchSizeStock(env, id);
      return ok({ product_id: id, size_stock: rows, total_stock: total }, 'Size stock updated');
    } catch (e) {
      console.error('Size stock update error:', e);
      return serverError('Failed to update size stock');
    }
  }

  // ── GET /api/products/:id ─────────────────────────────────────────────────
  if (path.match(/^\/\d+$/) && method === 'GET') {
    const id = parseInt(path.slice(1));
    try {
      const product = await env.DB.prepare(
        `SELECT p.*, c.id as category_id, ${REVIEW_SUBQUERIES}
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.id = ? AND p.active = 1`
      ).bind(id).first();
      if (!product) return notFound('Product not found');

      const [reviews, images, sizeStock] = await Promise.all([
        env.DB.prepare(
          `SELECT r.id, r.rating, r.title, r.body, r.created_at,
                  (u.first_name || ' ' || COALESCE(u.last_name, '')) as reviewer_name
           FROM product_reviews r LEFT JOIN users u ON r.user_id = u.id
           WHERE r.product_id = ? AND r.status = 'approved'
           ORDER BY r.created_at DESC LIMIT 10`
        ).bind(id).all(),
        env.DB.prepare(
          'SELECT id, url, alt, sort_order, is_primary FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC'
        ).bind(id).all(),
        fetchSizeStock(env, id),
      ]);

      return ok({
        product: mapProduct(product, sizeStock),
        reviews: reviews.results || [],
        images: images.results || [],
      });
    } catch (e) {
      console.error('ID fetch error:', e);
      return serverError('Failed to fetch product');
    }
  }

  // ── POST /api/products/bulk — admin only ───────────────────────────────────
  if (path === '/bulk' && method === 'POST') {
    const { error: authError } = await requireAdmin(request, env);
    if (authError) return authError;
    try {
      const body = await request.json();
      const products = Array.isArray(body.products) ? body.products : [];
      if (!products.length) return error('No products provided', 400);

      let successCount = 0;
      let failedCount = 0;
      for (const p of products) {
        try {
          if (!p.name || !p.price) {
            failedCount++;
            continue;
          }
          const sku = p.sku || `HU-BULK-${Math.floor(100000 + Math.random() * 900000)}`;
          const baseSlug = slugify(p.name);
          const finalSlug = await uniqueSlug(env, baseSlug);
          
          // Check if SKU exists
          const existing = await env.DB.prepare('SELECT id FROM products WHERE sku = ?').bind(sku).first();
          if (existing) {
            // Update product
            await env.DB.prepare(`
              UPDATE products SET
                name = ?,
                price = ?,
                original_price = ?,
                stock = ?,
                active = ?,
                updated_at = datetime('now')
              WHERE id = ?
            `).bind(
              p.name,
              parseFloat(p.price) || 0,
              p.mrp ? parseFloat(p.mrp) : null,
              parseInt(p.stock) || 0,
              p.is_active !== undefined ? (p.is_active ? 1 : 0) : (p.active !== undefined ? (p.active ? 1 : 0) : 1),
              existing.id
            ).run();
            
            successCount++;
          } else {
            // Insert product
            await env.DB.prepare(`
              INSERT INTO products (name, slug, sku, category, price, original_price, stock, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(
              p.name,
              finalSlug,
              sku,
              p.category || null,
              parseFloat(p.price) || 0,
              p.mrp ? parseFloat(p.mrp) : null,
              parseInt(p.stock) || 0,
              p.is_active !== undefined ? (p.is_active ? 1 : 0) : (p.active !== undefined ? (p.active ? 1 : 0) : 1)
            ).run();
            
            successCount++;
          }
        } catch (e) {
          console.error('Bulk import item error:', e);
          failedCount++;
        }
      }
      return ok({ success: successCount, failed: failedCount });
    } catch (e) {
      console.error('Bulk import error:', e);
      return serverError('Failed to import products');
    }
  }

  // ── POST /api/products — admin only ──────────────────────────────────────
  if (path === '/' && method === 'POST') {
    const { error: authError } = await requireAdmin(request, env);
    if (authError) return authError;
    try {
      const body = await request.json();
      const {
        name, sku, category, description, price, mrp, stock,
        sizes, images, brand, tags, is_new, is_trending, is_featured,
        meta_title, meta_desc, size_stock, gst_percent,
      } = body;
      if (!name || !sku || !price) return error('Name, SKU and price are required', 400);

      const baseSlug = slugify(name);
      const finalSlug = await uniqueSlug(env, baseSlug);

      const result = await env.DB.prepare(
        `INSERT INTO products
           (name, slug, sku, category, description, price, original_price, stock, active, featured,
            is_new, is_trending, sizes_json, images_json, brand, tags, gst_percent,
            meta_title, meta_description, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
         RETURNING *`
      ).bind(
        name, finalSlug, sku, category || null, description || null,
        parseFloat(price), mrp ? parseFloat(mrp) : null,
        parseInt(stock || 0), is_featured ? 1 : 0, is_new ? 1 : 0, is_trending ? 1 : 0,
        JSON.stringify(sizes || []), JSON.stringify(images || []),
        brand || null, JSON.stringify(tags || []),
        Number(gst_percent || 0),
        meta_title || null, meta_desc || null,
      ).first();

      if (size_stock && Array.isArray(size_stock) && size_stock.length > 0) {
        await upsertSizeStock(env, result.id, size_stock);
      } else if (sizes && sizes.length > 0 && stock) {
        const perSize = Math.floor(parseInt(stock || 0) / sizes.length);
        await upsertSizeStock(env, result.id, sizes.map(s => ({ size_label: String(s), stock: perSize })));
      }

      const sizeStockRows = await fetchSizeStock(env, result.id);
      return created(mapProduct(result, sizeStockRows), 'Product created');
    } catch (e) {
      console.error('Create product error:', e);
      if (e.message?.includes('UNIQUE')) return error('SKU already exists', 409);
      return serverError('Failed to create product');
    }
  }

  // ── PUT /api/products/:id — admin only ───────────────────────────────────
  if (path.match(/^\/\d+$/) && method === 'PUT') {
    const { error: authError } = await requireAdmin(request, env);
    if (authError) return authError;
    const id = parseInt(path.slice(1));
    try {
      const body = await request.json();
      const {
        name, category, description, price, mrp, stock,
        sizes, images, brand, tags, is_new, is_trending, is_featured,
        meta_title, meta_desc, size_stock, gst_percent,
      } = body;
      if (!name || !price) return error('Name and price are required', 400);

      const baseSlug = slugify(name);
      const finalSlug = await uniqueSlug(env, baseSlug, id);

      await env.DB.prepare(
        `UPDATE products SET
           name=?, slug=?, category=?, description=?, price=?, original_price=?,
           sizes_json=?, images_json=?, brand=?, tags=?, is_new=?, is_trending=?, featured=?,
           gst_percent=?, meta_title=?, meta_description=?, updated_at=datetime('now')
         WHERE id=?`
      ).bind(
        name, finalSlug, category || null, description || null,
        parseFloat(price), mrp ? parseFloat(mrp) : null,
        JSON.stringify(sizes || []), JSON.stringify(images || []),
        brand || null, JSON.stringify(tags || []),
        is_new ? 1 : 0, is_trending ? 1 : 0, is_featured ? 1 : 0,
        Number(gst_percent || 0),
        meta_title || null, meta_desc || null, id,
      ).run();

      if (size_stock && Array.isArray(size_stock) && size_stock.length > 0) {
        await upsertSizeStock(env, id, size_stock);
      } else if (stock !== undefined) {
        await env.DB.prepare("UPDATE products SET stock=?, updated_at=datetime('now') WHERE id=?").bind(parseInt(stock || 0), id).run();
      }

      const product = await env.DB.prepare(
        'SELECT p.*, c.id as category_id FROM products p LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category) WHERE p.id=?'
      ).bind(id).first();
      const sizeStockRows = await fetchSizeStock(env, id);
      return ok(mapProduct(product, sizeStockRows), 'Product updated');
    } catch (e) {
      console.error('Update product error:', e);
      return serverError('Failed to update product');
    }
  }

  // ── PATCH /api/products/:id — admin toggle/status/stock ──────────────────
  if (path.match(/^\/\d+$/) && method === 'PATCH') {
    const { error: authError } = await requireAdmin(request, env);
    if (authError) return authError;
    const id = parseInt(path.slice(1));
    try {
      const body = await request.json();
      const updates = [];
      const binds = [];

      if (body.size_stock && Array.isArray(body.size_stock)) {
        await upsertSizeStock(env, id, body.size_stock);
        const prod = await env.DB.prepare('SELECT id, name, stock FROM products WHERE id=?').bind(id).first();
        if (prod) {
          const newStock = body.size_stock.reduce((s, r) => s + (r.stock || 0), 0);
          const diff = newStock - (prod.stock || 0);
          await env.DB.prepare(
            "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'adjustment',?,?,?,?,datetime('now'))"
          ).bind(prod.id, prod.name, prod.stock || 0, diff, newStock, String(body.reason || 'Admin size-stock adjustment')).run();
        }
      } else if (body.stock !== undefined) {
        updates.push('stock=?');
        binds.push(Math.max(0, parseInt(body.stock)));
      }

      if (body.active !== undefined) {
        updates.push('active=?');
        binds.push(body.active ? 1 : 0);
      } else if (body.is_active !== undefined) {
        updates.push('active=?');
        binds.push(body.is_active ? 1 : 0);
      }
      if (body.featured !== undefined) {
        updates.push('featured=?');
        binds.push(body.featured ? 1 : 0);
      } else if (body.is_featured !== undefined) {
        updates.push('featured=?');
        binds.push(body.is_featured ? 1 : 0);
      }
      if (body.is_new !== undefined) {
        updates.push('is_new=?');
        binds.push(body.is_new ? 1 : 0);
      }
      if (body.is_trending !== undefined) {
        updates.push('is_trending=?');
        binds.push(body.is_trending ? 1 : 0);
      }

      // Log legacy stock change
      if (body.stock !== undefined && !body.size_stock) {
        const prod = await env.DB.prepare('SELECT id, name, stock FROM products WHERE id=?').bind(id).first();
        if (prod) {
          const newStock = Math.max(0, parseInt(body.stock));
          const diff = newStock - (prod.stock || 0);
          await env.DB.prepare(
            "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'adjustment',?,?,?,?,datetime('now'))"
          ).bind(prod.id, prod.name, prod.stock || 0, diff, newStock, String(body.reason || 'Admin adjustment')).run();
        }
      }

      if (updates.length > 0) {
        updates.push("updated_at=datetime('now')");
        binds.push(id);
        await env.DB.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id=?`).bind(...binds).run();
      }

      const product = await env.DB.prepare(
        'SELECT p.*, c.id as category_id FROM products p LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category) WHERE p.id=?'
      ).bind(id).first();
      const sizeStockRows = await fetchSizeStock(env, id);
      return ok(mapProduct(product, sizeStockRows), 'Product updated');
    } catch (e) {
      console.error('PATCH product error:', e);
      return serverError('Failed to patch product');
    }
  }

  // ── DELETE /api/products/:id — admin only ────────────────────────────────
  if (path.match(/^\/\d+$/) && method === 'DELETE') {
    const { error: authError } = await requireAdmin(request, env);
    if (authError) return authError;
    const id = parseInt(path.slice(1));
    try {
      await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
      return ok(null, 'Product deleted');
    } catch (e) {
      console.error('Delete product error:', e);
      return serverError('Failed to delete product');
    }
  }

  return error('Route not found', 404);
}