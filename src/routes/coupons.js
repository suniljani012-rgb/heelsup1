// worker/src/routes/coupons.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, serverError } from '../utils/response.js';

export async function couponsRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/coupons', '') || '/';
    const method = request.method;

    // POST /api/coupons/validate — validate a coupon code
    if (path === '/validate' && method === 'POST') {
        try {
            const { code, cart_total } = await request.json();
            if (!code) return error('Coupon code required');

            const coupon = await env.DB.prepare(
                `SELECT * FROM coupons WHERE code = ? AND active = 1
         AND (valid_from IS NULL OR valid_from <= datetime('now'))
         AND (valid_until IS NULL OR valid_until >= datetime('now'))`
            ).bind(code.toUpperCase()).first();

            if (!coupon) return error('Invalid or expired coupon code');
            if (coupon.max_uses && coupon.used_count >= coupon.max_uses) return error('Coupon usage limit reached');
            if (cart_total && cart_total < coupon.min_order) {
                return error(`Minimum order ₹${(coupon.min_order / 100).toFixed(0)} required for this coupon`);
            }

            let discount = 0;
            if (coupon.type === 'percent') discount = Math.floor((cart_total || 0) * coupon.value / 100);
            else if (coupon.type === 'flat') discount = coupon.value;
            else if (coupon.type === 'free_shipping') discount = 0; // handled in order

            return ok({
                code: coupon.code,
                type: coupon.type,
                value: coupon.value,
                discount,
                message: coupon.type === 'free_shipping' ? 'Free shipping applied!' : `You save ₹${(discount / 100).toFixed(0)}!`
            }, 'Coupon valid');
        } catch (e) { return serverError('Coupon validation failed'); }
    }

    // GET /api/coupons — admin list
    if (path === '/' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const coupons = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
        return list(coupons.results);
    }

    // POST /api/coupons — admin create
    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const { code, type, value, min_order, max_uses, per_user, valid_from, valid_until } = await request.json();
            if (!code || !type || !value) return error('Code, type, and value required');
            const result = await env.DB.prepare(
                'INSERT INTO coupons (code, type, value, min_order, max_uses, per_user, valid_from, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
            ).bind(code.toUpperCase(), type, value, min_order || 0, max_uses || null, per_user || 1, valid_from || null, valid_until || null).first();
            return created(result, 'Coupon created');
        } catch (e) {
            if (e.message?.includes('UNIQUE')) return error('Coupon code already exists', 409);
            return serverError('Failed to create coupon');
        }
    }

    // DELETE /api/coupons/:id
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        await env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run();
        return ok(null, 'Coupon deleted');
    }

    return error('Route not found', 404);
}