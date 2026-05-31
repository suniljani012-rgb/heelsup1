// worker/src/routes/products.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
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
  // If sizeStock rows provided, use them; else compute from product total stock evenly
  let sizeStockMap = {};
  if (sizeStock && sizeStock.length > 0) {
    for (const row of sizeStock) {
      sizeStockMap[row.size_label] = row.stock;
    }
  }

  // Compute overall effective stock from size stock if available, else use product.stock
  const effectiveStock = sizeStock && sizeStock.length > 0
    ? sizeStock.reduce((s, r) => s + r.stock, 0)
    : Number(p.stock || 0);

  return {
    id: p.id,
    name: p.name,
    sku: p.sku || "",
    category: p.category || "",
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
    rating: Number(p.rating || 4.5),
    review_count: Number(p.review_count || 0),
    sold_count: Number(p.sold_count || 0),
    sales: Number(p.sold_count || 0),
    sales_count: Number(p.sold_count || 0),
    gst_percent: Number(p.gst_percent || 0),
    category_id: p.category_id || null,
    description: p.description || "",
    sizes: sizes,
    size_stock: sizeStockMap,   // NEW: per-size stock map
    images: safeJsonParse(p.images_json, p.image_url ? [p.image_url] : []),
  };
}

// Helper: fetch size stock for one product
async function fetchSizeStock(env, productId) {
  try {
    const res = await env.DB.prepare(
      "SELECT size_label, stock FROM product_size_stock WHERE product_id = ? ORDER BY size_label ASC"
    ).bind(productId).all();
    return res.results || [];
  } catch {
    return [];
  }
}

// Helper: fetch size stock for multiple products as a map { productId: [rows] }
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

// Helper: upsert size stock rows for a product
async function upsertSizeStock(env, productId, sizeStockArray) {
  // sizeStockArray: [{ size_label, stock }, ...]
  for (const row of sizeStockArray) {
    await env.DB.prepare(
      `INSERT INTO product_size_stock (product_id, size_label, stock, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(product_id, size_label) DO UPDATE SET stock=excluded.stock, updated_at=datetime('now')`
    ).bind(productId, String(row.size_label), Math.max(0, parseInt(row.stock || 0))).run();
  }
  // Also sync the legacy products.stock column to the sum of all size stocks
  await syncLegacyStock(env, productId);
}

// Keep products.stock in sync with total size stock sum
async function syncLegacyStock(env, productId) {
  try {
    await env.DB.prepare(
      `UPDATE products SET stock = (
        SELECT COALESCE(SUM(stock), 0) FROM product_size_stock WHERE product_id = ?
      ), updated_at = datetime('now') WHERE id = ?`
    ).bind(productId, productId).run();
  } catch { /* non-critical */ }
}

export async function productsRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/products', '') || '/';
    const method = request.method;
    const params = url.searchParams;

    // GET /api/products — public listing with filters
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
            const sizeFilter = params.get('size'); // NEW: filter by available size

            let where = ['p.active = 1'];
            let binds = [];

            if (cat) {
                where.push('LOWER(p.category) = LOWER(?)');
                binds.push(cat);
            }
            if (featured === 'true' || featured === '1') {
                where.push('p.featured = 1');
            }
            if (isNew === 'true' || isNew === '1') {
                where.push('p.is_new = 1');
            }
            if (trending === 'true' || trending === '1') {
                where.push('p.is_trending = 1');
            }
            if (search) {
                where.push("(p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)");
                binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            if (tag) {
                where.push("p.tags LIKE ?");
                binds.push(`%"${tag}"%`);
            }
            if (minPrice) {
                where.push('p.price >= ?');
                binds.push(parseFloat(minPrice));
            }
            if (maxPrice) {
                where.push('p.price <= ?');
                binds.push(parseFloat(maxPrice));
            }
            // Filter by size: only show products that have stock for a given size
            if (sizeFilter) {
                where.push(`EXISTS (SELECT 1 FROM product_size_stock pss WHERE pss.product_id = p.id AND pss.size_label = ? AND pss.stock > 0)`);
                binds.push(sizeFilter);
            }

            const sortMap = {
                newest: 'p.id DESC',
                oldest: 'p.id ASC',
                price_low: 'p.price ASC',
                price_high: 'p.price DESC',
                name: 'p.name ASC',
            };
            const orderBy = sortMap[sort] || 'p.id DESC';
            const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

            const countResult = await env.DB.prepare(
                `SELECT COUNT(*) as total FROM products p ${whereStr}`
            ).bind(...binds).first();

            const productsRes = await env.DB.prepare(
                `SELECT p.*, c.id as category_id,
                (SELECT ROUND(AVG(rating),1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as avg_rating,
                (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as review_count
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
                pages: Math.ceil(countResult.total / limit)
            });
        } catch (e) {
            console.error('Products list error:', e);
            return serverError('Failed to fetch products');
        }
    }

    // GET /api/products/slug/:slug
    if (path.startsWith('/slug/') && method === 'GET') {
        const productSlug = path.replace('/slug/', '');
        try {
            const allProducts = await env.DB.prepare("SELECT id, name FROM products WHERE active = 1").all();
            const matched = (allProducts.results || []).find(p => slug(p.name) === productSlug);
            if (!matched) return notFound('Product not found');
            const id = matched.id;

            const product = await env.DB.prepare(
                `SELECT p.*, c.id as category_id,
                (SELECT ROUND(AVG(rating),1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as avg_rating,
                (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as review_count
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.id = ? AND p.active = 1`
            ).bind(id).first();
            if (!product) return notFound('Product not found');

            const [reviews, images, related, sizeStock] = await Promise.all([
              env.DB.prepare(
                `SELECT r.id, r.rating, r.title, r.body, r.created_at, (u.first_name || ' ' || COALESCE(u.last_name, '')) as reviewer_name
         FROM product_reviews r LEFT JOIN users u ON r.user_id = u.id
         WHERE r.product_id = ? AND r.status = 'approved'
         ORDER BY r.created_at DESC LIMIT 10`
              ).bind(product.id).all(),
              env.DB.prepare(
                "SELECT id, url, alt, sort_order, is_primary FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC"
              ).bind(product.id).all(),
              env.DB.prepare(
                "SELECT p.*, c.id as category_id FROM products p LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category) WHERE p.category=? AND p.id!=? AND p.active=1 ORDER BY p.featured DESC LIMIT 4"
              ).bind(product.category, product.id).all(),
              fetchSizeStock(env, product.id)
            ]);

            return ok({
                product: mapProduct(product, sizeStock),
                reviews: reviews.results || [],
                images: images.results || [],
                related: (related.results || []).map(r => mapProduct(r))
            });
        } catch (e) {
            console.error('Slug fetch error:', e);
            return serverError('Failed to fetch product');
        }
    }

    // GET /api/products/:id
    if (path.match(/^\/\d+$/) && method === 'GET') {
        const id = parseInt(path.slice(1));
        try {
            const product = await env.DB.prepare(
                `SELECT p.*, c.id as category_id,
                (SELECT ROUND(AVG(rating),1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as avg_rating,
                (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') as review_count
         FROM products p
         LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category)
         WHERE p.id = ? AND p.active = 1`
            ).bind(id).first();
            if (!product) return notFound('Product not found');

            const [reviews, images, sizeStock] = await Promise.all([
              env.DB.prepare(
                `SELECT r.id, r.rating, r.title, r.body, r.created_at, (u.first_name || ' ' || COALESCE(u.last_name, '')) as reviewer_name
         FROM product_reviews r LEFT JOIN users u ON r.user_id = u.id
         WHERE r.product_id = ? AND r.status = 'approved'
         ORDER BY r.created_at DESC LIMIT 10`
              ).bind(id).all(),
              env.DB.prepare(
                "SELECT id, url, alt, sort_order, is_primary FROM product_images WHERE product_id=? ORDER BY sort_order ASC, id ASC"
              ).bind(id).all(),
              fetchSizeStock(env, id)
            ]);

            return ok({
                product: mapProduct(product, sizeStock),
                reviews: reviews.results || [],
                images: images.results || []
            });
        } catch (e) {
            console.error('ID fetch error:', e);
            return serverError('Failed to fetch product');
        }
    }

    // GET /api/products/:id/size-stock — get per-size stock for a product (admin)
    if (path.match(/^\/\d+\/size-stock$/) && method === 'GET') {
        const id = parseInt(path.split('/')[1]);
        try {
            const rows = await fetchSizeStock(env, id);
            return ok({ product_id: id, size_stock: rows });
        } catch (e) {
            return serverError('Failed to fetch size stock');
        }
    }

    // PUT /api/products/:id/size-stock — update size stock (admin only)
    if (path.match(/^\/\d+\/size-stock$/) && method === 'PUT') {
        const { error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = parseInt(path.split('/')[1]);
        try {
            const body = await request.json();
            // Accept both array format: [{ size_label, stock }, ...]
            // and map format: { "36": 5, "37": 0, ... }
            let sizeStockArray = [];
            if (Array.isArray(body.size_stock)) {
                sizeStockArray = body.size_stock;
            } else if (body.size_stock && typeof body.size_stock === 'object') {
                // Map format: convert to array
                sizeStockArray = Object.entries(body.size_stock).map(([size_label, stock]) => ({
                    size_label: String(size_label),
                    stock: Math.max(0, parseInt(stock) || 0)
                }));
            }
            if (!sizeStockArray.length) return error('size_stock required (array or object)', 400);
            await upsertSizeStock(env, id, sizeStockArray);
            // Also update aggregate stock on products table
            const total = sizeStockArray.reduce((sum, r) => sum + (parseInt(r.stock) || 0), 0);
            await env.DB.prepare('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(total, id).run();
            const rows = await fetchSizeStock(env, id);
            return ok({ product_id: id, size_stock: rows, total_stock: total }, 'Size stock updated');
        } catch (e) {
            console.error('Size stock update error:', e);
            return serverError('Failed to update size stock');
        }
    }

    // POST /api/products — admin only
    if (path === '/' && method === 'POST') {
        const { error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const body = await request.json();
            const { name, sku, category, description, price, mrp, stock, sizes, images, brand, tags, is_new, is_trending, is_featured, meta_title, meta_desc, size_stock } = body;
            if (!name || !sku || !price) return error('Name, SKU and price are required');

            const result = await env.DB.prepare(
                `INSERT INTO products (name, sku, category, description, price, original_price, stock, active, featured, is_new, is_trending, sizes_json, images_json, brand, tags, meta_title, meta_description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')) RETURNING *`
            ).bind(
                name, sku, category || null, description || null,
                parseFloat(price), mrp ? parseFloat(mrp) : null,
                parseInt(stock || 0), is_featured ? 1 : 0, is_new ? 1 : 0, is_trending ? 1 : 0,
                JSON.stringify(sizes || []), JSON.stringify(images || []),
                brand || null, JSON.stringify(tags || []),
                meta_title || null, meta_desc || null
            ).first();

            // If size_stock provided, insert those rows
            if (size_stock && Array.isArray(size_stock) && size_stock.length > 0) {
                await upsertSizeStock(env, result.id, size_stock);
            } else if (sizes && sizes.length > 0 && stock) {
                // Auto-distribute stock evenly across sizes if no explicit size_stock given
                const perSize = Math.floor(parseInt(stock || 0) / sizes.length);
                const autoSizeStock = sizes.map(s => ({ size_label: String(s), stock: perSize }));
                await upsertSizeStock(env, result.id, autoSizeStock);
            }

            const sizeStock2 = await fetchSizeStock(env, result.id);
            return created(mapProduct(result, sizeStock2), 'Product created');
        } catch (e) {
            console.error('Create product error:', e);
            if (e.message?.includes('UNIQUE')) return error('SKU already exists', 409);
            return serverError('Failed to create product');
        }
    }

    // PUT /api/products/:id — admin only
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const { error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = parseInt(path.slice(1));
        try {
            const body = await request.json();
            const { name, category, description, price, mrp, stock, sizes, images, brand, tags, is_new, is_trending, is_featured, meta_title, meta_desc, size_stock } = body;

            await env.DB.prepare(
                `UPDATE products SET name=?, category=?, description=?, price=?, original_price=?,
         sizes_json=?, images_json=?, brand=?, tags=?, is_new=?, is_trending=?, featured=?,
         meta_title=?, meta_description=?, updated_at=datetime('now') WHERE id=?`
            ).bind(
                name, category || null, description || null, parseFloat(price), mrp ? parseFloat(mrp) : null,
                JSON.stringify(sizes || []), JSON.stringify(images || []),
                brand || null, JSON.stringify(tags || []),
                is_new ? 1 : 0, is_trending ? 1 : 0, is_featured ? 1 : 0,
                meta_title || null, meta_desc || null, id
            ).run();

            // Update size stock if provided
            if (size_stock && Array.isArray(size_stock) && size_stock.length > 0) {
                await upsertSizeStock(env, id, size_stock);
            } else if (stock !== undefined) {
                // fallback: update legacy stock column
                await env.DB.prepare("UPDATE products SET stock=?, updated_at=datetime('now') WHERE id=?").bind(parseInt(stock || 0), id).run();
            }

            const product = await env.DB.prepare(
                "SELECT p.*, c.id as category_id FROM products p LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category) WHERE p.id=?"
            ).bind(id).first();
            const sizeStockRows = await fetchSizeStock(env, id);
            return ok(mapProduct(product, sizeStockRows), 'Product updated');
        } catch (e) {
            console.error('Update product error:', e);
            return serverError('Failed to update product');
        }
    }

    // PATCH /api/products/:id — admin toggle/status/stock update
    if (path.match(/^\/\d+$/) && method === 'PATCH') {
        const { error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = parseInt(path.slice(1));
        try {
            const body = await request.json();
            const updates = [];
            const binds = [];

            // If size_stock provided, update per-size
            if (body.size_stock && Array.isArray(body.size_stock)) {
                await upsertSizeStock(env, id, body.size_stock);
                // Log inventory change
                const prod = await env.DB.prepare("SELECT id, name, stock FROM products WHERE id=?").bind(id).first();
                if (prod) {
                    const newStock = body.size_stock.reduce((s, r) => s + (r.stock || 0), 0);
                    const diff = newStock - (prod.stock || 0);
                    await env.DB.prepare(
                        "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'adjustment',?,?,?,?,datetime('now'))"
                    ).bind(prod.id, prod.name, prod.stock || 0, diff, newStock, String(body.reason || "Admin size-stock adjustment")).run();
                }
            } else if (body.stock !== undefined) {
                updates.push("stock=?");
                binds.push(Math.max(0, parseInt(body.stock)));
            }

            if (body.active !== undefined) {
                updates.push("active=?");
                binds.push(body.active ? 1 : 0);
            } else if (body.is_active !== undefined) {
                updates.push("active=?");
                binds.push(body.is_active ? 1 : 0);
            }
            if (body.featured !== undefined) {
                updates.push("featured=?");
                binds.push(body.featured ? 1 : 0);
            } else if (body.is_featured !== undefined) {
                updates.push("featured=?");
                binds.push(body.is_featured ? 1 : 0);
            }
            if (body.is_new !== undefined) {
                updates.push("is_new=?");
                binds.push(body.is_new ? 1 : 0);
            }
            if (body.is_trending !== undefined) {
                updates.push("is_trending=?");
                binds.push(body.is_trending ? 1 : 0);
            }

            // Log legacy stock change
            if (body.stock !== undefined && !body.size_stock) {
                const prod = await env.DB.prepare("SELECT id, name, stock FROM products WHERE id=?").bind(id).first();
                if (prod) {
                    const newStock = Math.max(0, parseInt(body.stock));
                    const diff = newStock - (prod.stock || 0);
                    await env.DB.prepare(
                        "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'adjustment',?,?,?,?,datetime('now'))"
                    ).bind(prod.id, prod.name, prod.stock || 0, diff, newStock, String(body.reason || "Admin adjustment")).run();
                }
            }

            if (updates.length > 0) {
                updates.push("updated_at=datetime('now')");
                binds.push(id);
                await env.DB.prepare(
                    `UPDATE products SET ${updates.join(', ')} WHERE id=?`
                ).bind(...binds).run();
            }

            const product = await env.DB.prepare(
                "SELECT p.*, c.id as category_id FROM products p LEFT JOIN categories c ON LOWER(c.name) = LOWER(p.category) WHERE p.id=?"
            ).bind(id).first();
            const sizeStockRows = await fetchSizeStock(env, id);
            return ok(mapProduct(product, sizeStockRows), 'Product updated');
        } catch (e) {
            console.error('PATCH product error:', e);
            return serverError('Failed to patch product');
        }
    }

    // DELETE /api/products/:id — admin only
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