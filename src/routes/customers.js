// worker/src/routes/customers.js
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { ok, list, error, serverError } from '../utils/response.js';

export async function customersRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/customers', '') || '/';
    const method = request.method;

    // GET /api/customers — admin list all customers
    if (path === '/' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const page = parseInt(url.searchParams.get('page') || '1');
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const offset = (page - 1) * limit;
            const search = url.searchParams.get('q');

            let where = ["role = 'customer'"];
            let binds = [];
            if (search) {
                where.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
                binds.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            }

            const total = await env.DB.prepare(
                `SELECT COUNT(*) as cnt FROM users WHERE ${where.join(' AND ')}`
            ).bind(...binds).first();

            const customers = await env.DB.prepare(
                `SELECT u.id, (u.first_name || ' ' || COALESCE(u.last_name, '')) as name, u.email, u.phone, (CASE WHEN u.is_blocked=1 THEN 0 ELSE 1 END) as is_active, u.created_at,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as order_count,
                (SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.payment_status='paid') as total_spent
         FROM users u WHERE ${where.join(' AND ')}
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
            ).bind(...binds, limit, offset).all();

            return list(customers.results, { page, limit, total: total.cnt });
        } catch (e) { return serverError('Failed to fetch customers'); }
    }

    // PUT /api/customers/:id — admin update customer role (ADDED)
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        const { role } = await request.json();
        if (role && ['customer', 'admin'].includes(role)) {
            await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
            return ok(null, 'Role updated');
        }
        return error('Invalid role');
    }

    // GET /api/customers/addresses
    if (path === '/addresses' && method === 'GET') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        const addresses = await env.DB.prepare(
            'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'
        ).bind(user.id).all();
        return list(addresses.results);
    }

    // POST /api/customers/addresses
    if (path === '/addresses' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { label, name, phone, line1, line2, city, state, pincode, country, is_default } = await request.json();
            if (!name || !phone || !line1 || !city || !state || !pincode) return error('All address fields required');
            if (is_default) {
                await env.DB.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(user.id).run();
            }
            const result = await env.DB.prepare(
                'INSERT INTO addresses (user_id, label, name, phone, line1, line2, city, state, pincode, country, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *'
            ).bind(user.id, label || 'Home', name, phone, line1, line2 || null, city, state, pincode, country || 'India', is_default ? 1 : 0).first();
            return ok(result, 'Address added');
        } catch (e) { return serverError('Failed to add address'); }
    }

    // DELETE /api/customers/addresses/:id
    if (path.startsWith('/addresses/') && method === 'DELETE') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        const id = path.replace('/addresses/', '');
        await env.DB.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').bind(id, user.id).run();
        return ok(null, 'Address deleted');
    }

    // PATCH /api/customers/:id/toggle — admin toggle customer active
    if (path.match(/^\/\d+\/toggle$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.match(/^\/(\d+)\/toggle$/)[1];
        await env.DB.prepare("UPDATE users SET is_blocked = CASE WHEN is_blocked=1 THEN 0 ELSE 1 END WHERE id=?").bind(id).run();
        return ok(null, 'Customer status toggled');
    }

    return error('Route not found', 404);
}