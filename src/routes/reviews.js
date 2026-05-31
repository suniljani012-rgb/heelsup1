// worker/src/routes/reviews.js
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, serverError } from '../utils/response.js';

export async function reviewsRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/reviews', '') || '/';
    const method = request.method;

    // GET /api/reviews?product_id=X
    if (path === '/' && method === 'GET') {
        const productId = url.searchParams.get('product_id');
        if (!productId) return error('product_id required');
        try {
            const reviews = await env.DB.prepare(
                `SELECT r.id, r.rating, r.title, r.body, r.created_at, (u.first_name || ' ' || COALESCE(u.last_name, '')) as reviewer_name
           FROM product_reviews r LEFT JOIN users u ON r.user_id = u.id
           WHERE r.product_id = ? AND r.status = 'approved' ORDER BY r.created_at DESC`
            ).bind(productId).all();
            return list(reviews.results || []);
        } catch (e) {
            console.error('Fetch reviews error:', e);
            return serverError('Failed to fetch reviews');
        }
    }

    // POST /api/reviews
    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { product_id, rating, title, body, order_id } = await request.json();
            if (!product_id || !rating) return error('Product ID and rating required');
            if (rating < 1 || rating > 5) return error('Rating must be 1-5');

            await env.DB.prepare(
                "INSERT INTO product_reviews (product_id, user_id, order_id, rating, title, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
            ).bind(product_id, user.id, order_id || null, rating, title || null, body || null).run();

            return created(null, 'Review submitted — pending approval');
        } catch (e) {
            console.error('Submit review error:', e);
            return serverError('Failed to submit review');
        }
    }

    // GET /api/reviews/admin/all
    if (path === '/admin/all' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const reviews = await env.DB.prepare(
                `SELECT r.*, p.name as product_name, (u.first_name || ' ' || COALESCE(u.last_name, '')) as reviewer_name
           FROM product_reviews r JOIN products p ON r.product_id = p.id LEFT JOIN users u ON r.user_id = u.id
           ORDER BY r.created_at DESC`
            ).all();
            return list(reviews.results || []);
        } catch (e) {
            console.error('Admin fetch reviews error:', e);
            return serverError('Failed to fetch reviews');
        }
    }

    // PATCH /api/reviews/:id/approve
    if (path.match(/^\/\d+\/approve$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.match(/(\d+)/)[1];
        try {
            await env.DB.prepare("UPDATE product_reviews SET status = 'approved' WHERE id = ?").bind(id).run();
            return ok(null, 'Review approved');
        } catch (e) {
            console.error('Approve review error:', e);
            return serverError('Failed to approve review');
        }
    }

    // DELETE /api/reviews/:id
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        try {
            await env.DB.prepare('DELETE FROM product_reviews WHERE id = ?').bind(id).run();
            return ok(null, 'Review deleted');
        } catch (e) {
            console.error('Delete review error:', e);
            return serverError('Failed to delete review');
        }
    }

    return error('Route not found', 404);
}