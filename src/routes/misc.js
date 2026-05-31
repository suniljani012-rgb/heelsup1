// worker/src/routes/misc.js
// Contact form, newsletter, inventory management
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, error, serverError } from '../utils/response.js';

export async function contactRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/contact', '') || '/';
    const method = request.method;

    if (path === '/' && method === 'POST') {
        try {
            const { name, email, phone, order, subject, message } = await request.json();
            if (!name || !email || !message) return error('Name, email and message required');
            await env.DB.prepare(
                'INSERT INTO contact_messages (name, email, phone, order_ref, subject, message) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(name, email, phone || null, order || null, subject || null, message).run();
            return ok(null, 'Message sent! We will reply within 24 hours.');
        } catch (e) { return serverError('Failed to send message'); }
    }

    if (path === '/admin/all' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const msgs = await env.DB.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all();
        return list(msgs.results || []);
    }

    return error('Route not found', 404);
}

export async function newsletterRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/newsletter', '') || '/';
    const method = request.method;

    if (path === '/' && method === 'POST') {
        try {
            const { email } = await request.json();
            if (!email || !email.includes('@')) return error('Valid email required');
            await env.DB.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)').bind(email.toLowerCase()).run();
            return ok(null, 'Subscribed successfully!');
        } catch (e) { return serverError('Subscription failed'); }
    }

    return error('Route not found', 404);
}

export async function inventoryRouter(request, env) {
    const { user, error: authError } = await requireAdmin(request, env);
    if (authError) return authError;

    const url = new URL(request.url);
    const path = url.pathname.replace('/api/inventory', '') || '/';
    const method = request.method;

    // GET /api/inventory — list stock matrix
    if (path === '/' && method === 'GET') {
        try {
            const search = url.searchParams.get("q") || "";
            const category = url.searchParams.get("category") || "";
            const stock = url.searchParams.get("stock") || "";

            let sql = "SELECT id, name, sku, category, price, stock, active, image_url FROM products WHERE 1=1";
            const binds = [];

            if (search) {
                sql += " AND (LOWER(name) LIKE LOWER(?) OR sku LIKE ?)";
                binds.push(`%${search}%`, `%${search}%`);
            }
            if (category) {
                sql += " AND LOWER(category)=LOWER(?)";
                binds.push(category);
            }
            if (stock === "low") { sql += " AND stock>0 AND stock<=10"; }
            if (stock === "out") { sql += " AND stock=0"; }
            if (stock === "in") { sql += " AND stock>10"; }

            sql += " ORDER BY stock ASC, name ASC LIMIT 500";
            const { results } = await env.DB.prepare(sql).bind(...binds).all();
            return ok({ products: results || [] });
        } catch (e) {
            console.error('Fetch inventory error:', e);
            return serverError('Failed to fetch inventory');
        }
    }

    // GET /api/inventory/log — audit log
    if (path === '/log' && method === 'GET') {
        try {
            const productId = url.searchParams.get("product_id") || "";
            const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);

            let sql = "SELECT * FROM inventory_log WHERE 1=1";
            const binds = [];

            if (productId) {
                sql += " AND product_id=?";
                binds.push(parseInt(productId));
            }
            sql += " ORDER BY id DESC LIMIT ?";
            binds.push(limit);

            const { results } = await env.DB.prepare(sql).bind(...binds).all();
            return ok({ logs: results || [] });
        } catch (e) {
            console.error('Fetch inventory logs error:', e);
            return serverError('Failed to fetch logs');
        }
    }

    // PUT /api/inventory/bulk — bulk update stock
    if (path === '/bulk' && method === 'PUT') {
        try {
            const body = await request.json();
            if (!Array.isArray(body?.updates)) return error("updates array required", 400);

            let updated = 0;
            const now = new Date().toISOString();

            for (const u of body.updates) {
                const id = parseInt(u.id);
                const stock = Math.max(0, parseInt(u.stock || 0));
                if (!id) continue;

                const prod = await env.DB.prepare("SELECT id, name, stock FROM products WHERE id=?").bind(id).first();
                if (!prod) continue;

                const diff = stock - (prod.stock || 0);

                await env.DB.prepare("UPDATE products SET stock=?, updated_at=? WHERE id=?").bind(stock, now, id).run();

                await env.DB.prepare(
                    "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'adjustment',?,?,?,?,?)"
                ).bind(prod.id, prod.name, prod.stock || 0, diff, stock, String(u.reason || "Admin adjustment"), now).run();

                updated++;
            }

            return ok({ updated }, "Inventory updated");
        } catch (e) {
            console.error('Bulk update stock error:', e);
            return serverError('Failed to update inventory');
        }
    }

    return error('Route not found', 404);
}