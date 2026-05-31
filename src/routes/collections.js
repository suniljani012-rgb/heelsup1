// ============================================================
// HeelsUp — Collections Admin Routes
// /api/admin/collections/*
// ============================================================

import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function collectionsAdminRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/admin/collections', '') || '/';
    const method = request.method;

    const { user, error: authError } = await requireAdmin(request, env);
    if (authError) return authError;

    // ── GET /api/admin/collections ─────────────────────────────
    if (path === '/' && method === 'GET') {
        try {
            const collections = await env.DB.prepare(`
                SELECT c.*,
                       COUNT(cp.product_id) as product_count
                FROM collections c
                LEFT JOIN collection_products cp ON cp.collection_id = c.id
                GROUP BY c.id
                ORDER BY c.sort_order ASC, c.created_at DESC
            `).all();
            return list(collections.results);
        } catch (e) { return serverError('Failed to fetch collections'); }
    }

    // ── GET /api/admin/collections/:id ─────────────────────────
    if (path.match(/^\/\d+$/) && method === 'GET') {
        const id = path.slice(1);
        const col = await env.DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first();
        if (!col) return notFound('Collection not found');

        // Fetch products in collection
        const products = await env.DB.prepare(`
            SELECT p.id, p.name, p.slug, p.sku, p.price, p.images_json, cp.sort_order
            FROM collection_products cp
            JOIN products p ON p.id = cp.product_id
            WHERE cp.collection_id = ?
            ORDER BY cp.sort_order ASC
        `).bind(id).all();

        return ok({ ...col, products: products.results });
    }

    // ── POST /api/admin/collections — create ───────────────────
    if (path === '/' && method === 'POST') {
        try {
            const {
                name, description, image_url,
                condition = '{}', is_active = 1, sort_order = 0,
                product_ids = []
            } = await request.json();

            if (!name) return error('Collection name is required');
            const slug = slugify(name) + '-' + Date.now().toString(36);

            const result = await env.DB.prepare(`
                INSERT INTO collections (name, slug, description, image_url, condition, is_active, sort_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                RETURNING *
            `).bind(
                name, slug, description || null, image_url || null,
                JSON.stringify(condition), is_active ? 1 : 0, sort_order
            ).first();

            // Add products if provided
            if (product_ids.length > 0) {
                for (let i = 0; i < product_ids.length; i++) {
                    await env.DB.prepare(
                        'INSERT OR IGNORE INTO collection_products (collection_id, product_id, sort_order) VALUES (?, ?, ?)'
                    ).bind(result.id, product_ids[i], i).run();
                }
            }

            return created(result, 'Collection created');
        } catch (e) {
            console.error('Collection create error:', e);
            return serverError('Failed to create collection');
        }
    }

    // ── PUT /api/admin/collections/:id — update ────────────────
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const id = path.slice(1);
        try {
            const existing = await env.DB.prepare('SELECT id FROM collections WHERE id = ?').bind(id).first();
            if (!existing) return notFound('Collection not found');

            const {
                name, description, image_url,
                condition, is_active, sort_order, product_ids
            } = await request.json();

            await env.DB.prepare(`
                UPDATE collections SET
                    name        = COALESCE(?, name),
                    description = COALESCE(?, description),
                    image_url   = COALESCE(?, image_url),
                    condition   = COALESCE(?, condition),
                    is_active   = COALESCE(?, is_active),
                    sort_order  = COALESCE(?, sort_order)
                WHERE id = ?
            `).bind(
                name || null, description || null, image_url || null,
                condition ? JSON.stringify(condition) : null,
                is_active !== undefined ? (is_active ? 1 : 0) : null,
                sort_order !== undefined ? sort_order : null,
                id
            ).run();

            // Sync products if provided
            if (Array.isArray(product_ids)) {
                await env.DB.prepare('DELETE FROM collection_products WHERE collection_id = ?').bind(id).run();
                for (let i = 0; i < product_ids.length; i++) {
                    await env.DB.prepare(
                        'INSERT OR IGNORE INTO collection_products (collection_id, product_id, sort_order) VALUES (?, ?, ?)'
                    ).bind(id, product_ids[i], i).run();
                }
            }

            const updated = await env.DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first();
            return ok(updated, 'Collection updated');
        } catch (e) { return serverError('Failed to update collection'); }
    }

    // ── PATCH /api/admin/collections/:id/toggle — toggle active ─
    if (path.match(/^\/\d+\/toggle$/) && method === 'PATCH') {
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare(
            'UPDATE collections SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id = ?'
        ).bind(id).run();
        return ok(null, 'Collection toggled');
    }

    // ── POST /api/admin/collections/:id/products — add product ──
    if (path.match(/^\/\d+\/products$/) && method === 'POST') {
        const colId = path.match(/(\d+)/)[1];
        const { product_id, sort_order = 0 } = await request.json();
        try {
            await env.DB.prepare(
                'INSERT OR IGNORE INTO collection_products (collection_id, product_id, sort_order) VALUES (?, ?, ?)'
            ).bind(colId, product_id, sort_order).run();
            return ok(null, 'Product added to collection');
        } catch (e) { return serverError('Failed to add product'); }
    }

    // ── DELETE /api/admin/collections/:id/products/:pid ─────────
    if (path.match(/^\/\d+\/products\/\d+$/) && method === 'DELETE') {
        const [, colId, pid] = path.match(/^\/(\d+)\/products\/(\d+)$/);
        await env.DB.prepare(
            'DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?'
        ).bind(colId, pid).run();
        return ok(null, 'Product removed from collection');
    }

    // ── DELETE /api/admin/collections/:id ──────────────────────
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const id = path.slice(1);
        const existing = await env.DB.prepare('SELECT id FROM collections WHERE id = ?').bind(id).first();
        if (!existing) return notFound('Collection not found');
        await env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(id).run();
        return ok(null, 'Collection deleted');
    }

    return error('Route not found', 404);
}

// ── Public collections route ──────────────────────────────────
export async function collectionsPublicRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/collections', '') || '/';
    const method = request.method;

    if (path === '/' && method === 'GET') {
        const cols = await env.DB.prepare(
            "SELECT * FROM collections WHERE is_active = 1 ORDER BY sort_order ASC"
        ).all();
        return list(cols.results);
    }

    if (path.match(/^\/[a-z0-9-]+$/) && method === 'GET') {
        const slug = path.slice(1);
        const col = await env.DB.prepare(
            'SELECT * FROM collections WHERE slug = ? AND is_active = 1'
        ).bind(slug).first();
        if (!col) return error('Collection not found', 404);

        const products = await env.DB.prepare(`
            SELECT p.id, p.name, p.slug, p.price, p.original_price, p.images_json, p.featured
            FROM collection_products cp
            JOIN products p ON p.id = cp.product_id
            WHERE cp.collection_id = ? AND p.active = 1
            ORDER BY cp.sort_order ASC
        `).bind(col.id).all();

        return ok({ ...col, products: products.results });
    }

    return error('Route not found', 404);
}