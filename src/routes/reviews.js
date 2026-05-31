// src/routes/reviews.js — HeelsUp Product Reviews Router
// Table: product_reviews | status: draft / approved / rejected
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

export async function reviewsRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/reviews', '') || '/';
    const method = request.method;

    // ── GET /api/reviews?product_id=X — public approved reviews ─────────────
    if (path === '/' && method === 'GET') {
        const productId = url.searchParams.get('product_id');
        if (!productId) return error('product_id required');

        try {
            const page  = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
            const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
            const offset = (page - 1) * limit;

            const [rows, countRow, summary] = await Promise.all([
                env.DB.prepare(`
                    SELECT r.id, r.rating, r.title, r.body, r.created_at,
                           (u.first_name || ' ' || COALESCE(u.last_name, '')) AS reviewer_name
                    FROM product_reviews r
                    LEFT JOIN users u ON r.user_id = u.id
                    WHERE r.product_id = ? AND r.status = 'approved'
                    ORDER BY r.created_at DESC
                    LIMIT ? OFFSET ?
                `).bind(productId, limit, offset).all(),

                env.DB.prepare(
                    `SELECT COUNT(*) AS n FROM product_reviews WHERE product_id = ? AND status = 'approved'`
                ).bind(productId).first(),

                env.DB.prepare(`
                    SELECT
                        COUNT(*)                                        AS total,
                        ROUND(AVG(CAST(rating AS REAL)), 1)             AS avg_rating,
                        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END)    AS r5,
                        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END)    AS r4,
                        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END)    AS r3,
                        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END)    AS r2,
                        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)    AS r1
                    FROM product_reviews
                    WHERE product_id = ? AND status = 'approved'
                `).bind(productId).first(),
            ]);

            const total = countRow?.n || 0;
            return list(rows.results || [], {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                summary: {
                    avg_rating: summary?.avg_rating || 0,
                    total_reviews: summary?.total || 0,
                    distribution: {
                        5: summary?.r5 || 0,
                        4: summary?.r4 || 0,
                        3: summary?.r3 || 0,
                        2: summary?.r2 || 0,
                        1: summary?.r1 || 0,
                    },
                },
            });
        } catch (e) {
            console.error('Fetch reviews error:', e);
            return serverError('Failed to fetch reviews');
        }
    }

    // ── POST /api/reviews — submit review (authenticated users) ──────────────
    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;

        try {
            const { product_id, rating, title, body, order_id } = await request.json();
            if (!product_id) return error('product_id is required');
            if (!rating || rating < 1 || rating > 5) return error('Rating must be between 1 and 5');

            // One review per user per product
            const dupe = await env.DB.prepare(
                `SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ?`
            ).bind(product_id, user.id).first();
            if (dupe) return error('You have already reviewed this product', 409);

            await env.DB.prepare(`
                INSERT INTO product_reviews
                    (product_id, user_id, order_id, rating, title, body, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'draft', datetime('now'))
            `).bind(
                product_id,
                user.id,
                order_id || null,
                parseInt(rating),
                title   ? title.trim()  : null,
                body    ? body.trim()   : null
            ).run();

            return created(null, 'Review submitted — pending approval');
        } catch (e) {
            console.error('Submit review error:', e);
            return serverError('Failed to submit review');
        }
    }

    // ── GET /api/reviews/admin/all — paginated all reviews (admin) ───────────
    if (path === '/admin/all' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        try {
            const page    = Math.max(1, parseInt(url.searchParams.get('page')   || '1'));
            const limit   = Math.min(100, parseInt(url.searchParams.get('limit') || '30'));
            const offset  = (page - 1) * limit;
            const status  = url.searchParams.get('status'); // draft | approved | rejected
            const pid     = url.searchParams.get('product_id');

            const conditions = [];
            const params     = [];
            if (status) { conditions.push("r.status = ?"); params.push(status); }
            if (pid)    { conditions.push("r.product_id = ?"); params.push(pid); }

            const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

            const [rows, countRow] = await Promise.all([
                env.DB.prepare(`
                    SELECT r.*,
                           p.name  AS product_name,
                           (u.first_name || ' ' || COALESCE(u.last_name, '')) AS reviewer_name
                    FROM product_reviews r
                    JOIN products p ON r.product_id = p.id
                    LEFT JOIN users u ON r.user_id = u.id
                    ${where}
                    ORDER BY r.created_at DESC
                    LIMIT ? OFFSET ?
                `).bind(...params, limit, offset).all(),

                env.DB.prepare(
                    `SELECT COUNT(*) AS n FROM product_reviews r ${where}`
                ).bind(...params).first(),
            ]);

            const total = countRow?.n || 0;
            return list(rows.results || [], { page, limit, total, pages: Math.ceil(total / limit) });
        } catch (e) {
            console.error('Admin fetch reviews error:', e);
            return serverError('Failed to fetch reviews');
        }
    }

    // ── PATCH /api/reviews/:id/approve — set status=approved ────────────────
    if (path.match(/^\/\d+\/approve$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        const id = path.match(/(\d+)/)[1];
        try {
            const review = await env.DB.prepare(
                'SELECT id FROM product_reviews WHERE id = ?'
            ).bind(id).first();
            if (!review) return notFound('Review not found');

            await env.DB.prepare(
                "UPDATE product_reviews SET status = 'approved' WHERE id = ?"
            ).bind(id).run();
            return ok({ id: parseInt(id), status: 'approved' }, 'Review approved');
        } catch (e) {
            console.error('Approve review error:', e);
            return serverError('Failed to approve review');
        }
    }

    // ── PATCH /api/reviews/:id/reject — set status=rejected ─────────────────
    if (path.match(/^\/\d+\/reject$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        const id = path.match(/(\d+)/)[1];
        try {
            const review = await env.DB.prepare(
                'SELECT id FROM product_reviews WHERE id = ?'
            ).bind(id).first();
            if (!review) return notFound('Review not found');

            await env.DB.prepare(
                "UPDATE product_reviews SET status = 'rejected' WHERE id = ?"
            ).bind(id).run();
            return ok({ id: parseInt(id), status: 'rejected' }, 'Review rejected');
        } catch (e) {
            console.error('Reject review error:', e);
            return serverError('Failed to reject review');
        }
    }

    // ── PATCH /api/reviews/:id/status — set any valid status (admin) ─────────
    if (path.match(/^\/\d+\/status$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        const id = path.match(/(\d+)/)[1];
        try {
            const { status } = await request.json();
            if (!['draft', 'approved', 'rejected'].includes(status)) {
                return error('status must be draft, approved, or rejected');
            }

            const review = await env.DB.prepare(
                'SELECT id FROM product_reviews WHERE id = ?'
            ).bind(id).first();
            if (!review) return notFound('Review not found');

            await env.DB.prepare(
                'UPDATE product_reviews SET status = ? WHERE id = ?'
            ).bind(status, id).run();
            return ok({ id: parseInt(id), status }, `Review ${status}`);
        } catch (e) {
            console.error('Status review error:', e);
            return serverError('Failed to update review status');
        }
    }

    // ── POST /api/reviews/:id/helpful — increment helpful vote ───────────────
    if (path.match(/^\/\d+\/helpful$/) && method === 'POST') {
        const id = path.match(/(\d+)/)[1];
        try {
            const review = await env.DB.prepare(
                "SELECT id FROM product_reviews WHERE id = ? AND status = 'approved'"
            ).bind(id).first();
            if (!review) return notFound('Review not found');

            // helpful_votes column is optional — increment if it exists
            // We use a safe COALESCE so it works even if the column is NULL
            await env.DB.prepare(
                'UPDATE product_reviews SET helpful_votes = COALESCE(helpful_votes, 0) + 1 WHERE id = ?'
            ).bind(id).run();

            return ok({ id: parseInt(id) }, 'Helpful vote recorded');
        } catch (e) {
            // If helpful_votes column doesn't exist yet, fail gracefully
            console.warn('Helpful vote error (column may not exist):', e);
            return ok({ id: parseInt(id) }, 'Helpful vote recorded');
        }
    }

    // ── DELETE /api/reviews/:id — admin delete ───────────────────────────────
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        const id = path.slice(1);
        try {
            const review = await env.DB.prepare(
                'SELECT id FROM product_reviews WHERE id = ?'
            ).bind(id).first();
            if (!review) return notFound('Review not found');

            await env.DB.prepare('DELETE FROM product_reviews WHERE id = ?').bind(id).run();
            return ok(null, 'Review deleted');
        } catch (e) {
            console.error('Delete review error:', e);
            return serverError('Failed to delete review');
        }
    }

    return error('Route not found', 404);
}