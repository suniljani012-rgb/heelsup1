// src/routes/brands.js — HeelsUp Brands Router
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

function slugify(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

export async function brandsRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/brands', '') || '/';
    const method = request.method;

    // ── GET /api/brands — public or admin list of brands ─────────────────────
    if (path === '/' && method === 'GET') {
        try {
            const isAll = url.searchParams.get('all') === 'true';
            let query = `SELECT id, name, slug, description, logo_url, sort_order, is_active FROM brands ORDER BY sort_order ASC, name ASC`;
            
            if (!isAll) {
                query = `SELECT id, name, slug, description, logo_url, sort_order, is_active FROM brands WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`;
            } else {
                const { user, error: authError } = await requireAdmin(request, env);
                if (authError) return authError;
            }

            const rows = await env.DB.prepare(query).all();
            return list(rows.results || []);
        } catch (e) {
            console.error('Brands list error:', e);
            return serverError('Failed to fetch brands');
        }
    }

    // ── GET /api/brands/:id — single brand (public) ──────────────────────────
    if (path.match(/^\/\d+$/) && method === 'GET') {
        const id = path.slice(1);
        try {
            const brand = await env.DB.prepare(
                'SELECT * FROM brands WHERE id = ?'
            ).bind(id).first();
            if (!brand) return notFound('Brand not found');
            return ok(brand);
        } catch (e) {
            console.error('Brand fetch error:', e);
            return serverError('Failed to fetch brand');
        }
    }

    // ── POST /api/brands — admin only, create brand ──────────────────────────
    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        try {
            const { name, description, logo_url, sort_order = 0, is_active = 1 } = await request.json();
            if (!name || !name.trim()) return error('Brand name is required');

            const slug = slugify(name);
            if (!slug) return error('Could not generate a valid slug from the provided name');

            // Uniqueness check
            const existing = await env.DB.prepare(
                'SELECT id FROM brands WHERE slug = ?'
            ).bind(slug).first();
            if (existing) return error('A brand with this name (or similar slug) already exists', 409);

            const result = await env.DB.prepare(`
                INSERT INTO brands (name, slug, description, logo_url, is_active, sort_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `).bind(
                name.trim(),
                slug,
                description || null,
                logo_url || null,
                is_active ? 1 : 0,
                parseInt(sort_order) || 0
            ).run();

            const newBrand = await env.DB.prepare(
                'SELECT * FROM brands WHERE id = ?'
            ).bind(result.meta.last_row_id).first();

            return created(newBrand, 'Brand created');
        } catch (e) {
            console.error('Brand create error:', e);
            return serverError('Failed to create brand');
        }
    }

    // ── PUT /api/brands/:id — admin only, full update ────────────────────────
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        const id = path.slice(1);
        try {
            const existing = await env.DB.prepare(
                'SELECT * FROM brands WHERE id = ?'
            ).bind(id).first();
            if (!existing) return notFound('Brand not found');

            const { name, description, logo_url, sort_order, is_active } = await request.json();

            // Recompute slug if name changed
            let newSlug = existing.slug;
            if (name && name.trim() && name.trim() !== existing.name) {
                newSlug = slugify(name.trim());
                if (!newSlug) return error('Could not generate a valid slug from the provided name');

                // Uniqueness check — exclude current record
                const conflict = await env.DB.prepare(
                    'SELECT id FROM brands WHERE slug = ? AND id != ?'
                ).bind(newSlug, id).first();
                if (conflict) return error('Another brand with this name (or similar slug) already exists', 409);
            }

            await env.DB.prepare(`
                UPDATE brands SET
                    name        = COALESCE(?, name),
                    slug        = ?,
                    description = COALESCE(?, description),
                    logo_url    = COALESCE(?, logo_url),
                    sort_order  = COALESCE(?, sort_order),
                    is_active   = COALESCE(?, is_active)
                WHERE id = ?
            `).bind(
                name ? name.trim() : null,
                newSlug,
                description !== undefined ? (description || null) : null,
                logo_url !== undefined ? (logo_url || null) : null,
                sort_order !== undefined ? (parseInt(sort_order) || 0) : null,
                is_active !== undefined ? (is_active ? 1 : 0) : null,
                id
            ).run();

            const updated = await env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
            return ok(updated, 'Brand updated');
        } catch (e) {
            console.error('Brand update error:', e);
            return serverError('Failed to update brand');
        }
    }

    // ── PATCH /api/brands/:id — admin only, toggle is_active ────────────────
    if (path.match(/^\/\d+$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        const id = path.slice(1);
        try {
            const brand = await env.DB.prepare(
                'SELECT id, is_active FROM brands WHERE id = ?'
            ).bind(id).first();
            if (!brand) return notFound('Brand not found');

            const flipped = brand.is_active ? 0 : 1;
            await env.DB.prepare(
                'UPDATE brands SET is_active = ? WHERE id = ?'
            ).bind(flipped, id).run();

            return ok({ id: parseInt(id), is_active: flipped }, `Brand ${flipped ? 'activated' : 'deactivated'}`);
        } catch (e) {
            console.error('Brand toggle error:', e);
            return serverError('Failed to toggle brand status');
        }
    }

    // ── DELETE /api/brands/:id — super admin only ────────────────────────────
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;

        // Only role === 'admin' (super admin) may delete brands
        if (user.role !== 'admin') {
            return error('Only super admins can delete brands', 403);
        }

        const id = path.slice(1);
        try {
            const brand = await env.DB.prepare(
                'SELECT id FROM brands WHERE id = ?'
            ).bind(id).first();
            if (!brand) return notFound('Brand not found');

            await env.DB.prepare('DELETE FROM brands WHERE id = ?').bind(id).run();
            return ok(null, 'Brand deleted');
        } catch (e) {
            console.error('Brand delete error:', e);
            return serverError('Failed to delete brand');
        }
    }

    return error('Route not found', 404);
}
