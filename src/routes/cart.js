// worker/src/routes/cart.js
import { requireAuth } from '../middleware/auth.js';
import { ok, list, error, serverError } from '../utils/response.js';

export async function cartRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/cart', '') || '/';
    const method = request.method;

    // POST /api/cart/sync — sync localStorage cart to server
    if (path === '/sync' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { items } = await request.json();
            // Clear existing cart
            await env.DB.prepare('DELETE FROM carts WHERE user_id = ?').bind(user.id).run();
            // Re-insert
            if (items && items.length > 0) {
                for (const item of items) {
                    await env.DB.prepare(
                        'INSERT INTO carts (user_id, product_id, size, color, qty) VALUES (?, ?, ?, ?, ?)'
                    ).bind(user.id, item.product_id || item.id, item.size || null, item.color || null, item.qty || 1).run();
                }
            }
            return ok(null, 'Cart synced');
        } catch (e) { return serverError('Cart sync failed'); }
    }

    // GET /api/cart
    if (path === '/' && method === 'GET') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        const items = await env.DB.prepare(
            `SELECT c.id, c.qty, c.size, c.color, p.id as product_id, p.name, p.price, p.original_price, p.images_json
       FROM carts c JOIN products p ON c.product_id = p.id
       WHERE c.user_id = ? AND p.active = 1`
        ).bind(user.id).all();
        return list(items.results);
    }

    return error('Route not found', 404);
}