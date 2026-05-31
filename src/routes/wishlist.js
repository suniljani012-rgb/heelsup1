// worker/src/routes/wishlist.js
import { requireAuth } from '../middleware/auth.js';
import { ok, list, error, serverError } from '../utils/response.js';

function safeJsonParse(str, fallback = []) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

export async function wishlistRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/wishlist', '') || '/';
    const method = request.method;

    // GET /api/wishlist — get user's wishlist
    if (path === '/' && method === 'GET') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const items = await env.DB.prepare(
                `SELECT p.id, p.name, p.price, p.original_price, p.images_json, p.category,
                        p.stock, p.sizes_json, w.created_at as added_at
                 FROM wishlists w
                 JOIN products p ON w.product_id = p.id
                 WHERE w.user_id = ? AND p.active = 1
                 ORDER BY w.created_at DESC`
            ).bind(user.id).all();

            const result = (items.results || []).map(p => ({
                id: p.id,
                name: p.name,
                price: Number(p.price),
                original_price: p.original_price ? Number(p.original_price) : null,
                mrp: p.original_price ? Number(p.original_price) : null,
                images: safeJsonParse(p.images_json, []),
                category: p.category || '',
                stock: Number(p.stock || 0),
                sizes: safeJsonParse(p.sizes_json, []),
                added_at: p.added_at,
            }));

            return list(result);
        } catch (e) {
            console.error('Wishlist fetch error:', e);
            return serverError('Failed to fetch wishlist');
        }
    }

    // GET /api/wishlist/ids — get just product IDs in wishlist (fast check)
    if (path === '/ids' && method === 'GET') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const items = await env.DB.prepare(
                'SELECT product_id FROM wishlists WHERE user_id = ?'
            ).bind(user.id).all();
            return ok({ ids: (items.results || []).map(r => r.product_id) });
        } catch (e) {
            return serverError('Failed to fetch wishlist ids');
        }
    }

    // POST /api/wishlist — add to wishlist
    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { product_id } = await request.json();
            if (!product_id) return error('product_id required');
            // Check product exists
            const prod = await env.DB.prepare('SELECT id FROM products WHERE id=? AND active=1').bind(product_id).first();
            if (!prod) return error('Product not found', 404);
            await env.DB.prepare(
                'INSERT OR IGNORE INTO wishlists (user_id, product_id, created_at) VALUES (?, ?, datetime(\'now\'))'
            ).bind(user.id, product_id).run();
            return ok({ product_id, wishlisted: true }, 'Added to wishlist');
        } catch (e) {
            console.error('Wishlist add error:', e);
            return serverError('Failed to add to wishlist');
        }
    }

    // DELETE /api/wishlist/:productId — remove from wishlist
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        const productId = parseInt(path.slice(1));
        try {
            await env.DB.prepare('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?').bind(user.id, productId).run();
            return ok({ product_id: productId, wishlisted: false }, 'Removed from wishlist');
        } catch (e) {
            return serverError('Failed to remove from wishlist');
        }
    }

    // POST /api/wishlist/toggle — add or remove based on current state
    if (path === '/toggle' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { product_id } = await request.json();
            if (!product_id) return error('product_id required');
            const existing = await env.DB.prepare(
                'SELECT id FROM wishlists WHERE user_id=? AND product_id=?'
            ).bind(user.id, product_id).first();
            if (existing) {
                await env.DB.prepare('DELETE FROM wishlists WHERE user_id=? AND product_id=?').bind(user.id, product_id).run();
                return ok({ product_id, wishlisted: false }, 'Removed from wishlist');
            } else {
                await env.DB.prepare(
                    'INSERT OR IGNORE INTO wishlists (user_id, product_id, created_at) VALUES (?, ?, datetime(\'now\'))'
                ).bind(user.id, product_id).run();
                return ok({ product_id, wishlisted: true }, 'Added to wishlist');
            }
        } catch (e) {
            console.error('Wishlist toggle error:', e);
            return serverError('Failed to toggle wishlist');
        }
    }

    return error('Route not found', 404);
}