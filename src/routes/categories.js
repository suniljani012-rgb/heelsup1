// worker/src/routes/categories.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

export async function categoriesRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/categories', '') || '/';
    const method = request.method;

    if (path === '/' && method === 'GET') {
        try {
            const cats = await env.DB.prepare(
                `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) as product_count
         FROM categories c WHERE c.active = 1 ORDER BY c.sort_order ASC`
            ).all();
            return list(cats.results);
        } catch (e) { return serverError('Failed to fetch categories'); }
    }

    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const { name, slug, description, image_url, sort_order, active } = await request.json();
            if (!name || !slug) return error('Name and slug are required');
            const result = await env.DB.prepare(
                'INSERT INTO categories (name, slug, description, image_url, sort_order, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
            ).bind(name, slug.toLowerCase(), description || null, image_url || null, sort_order || 0, active !== undefined ? (active ? 1 : 0) : 1).first();
            return created(result, 'Category created');
        } catch (e) {
            if (e.message?.includes('UNIQUE')) return error('Slug already exists', 409);
            return serverError('Failed to create category');
        }
    }

    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        const { name, slug, description, image_url, sort_order, active, is_active } = await request.json();
        const activeVal = active !== undefined ? active : is_active;
        await env.DB.prepare(
            'UPDATE categories SET name=?, slug=?, description=?, image_url=?, sort_order=?, active=? WHERE id=?'
        ).bind(name, slug, description, image_url, sort_order, activeVal ? 1 : 0, id).run();
        return ok(null, 'Category updated');
    }

    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
        return ok(null, 'Category deleted');
    }

    return error('Route not found', 404);
}