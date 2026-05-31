// ============================================================
// HeelsUp — Static Pages Admin Routes
// /api/admin/pages/*
// Custom pages like About, FAQ, Terms, Privacy etc.
// ============================================================

import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function pagesAdminRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/admin/pages', '') || '/';
    const method = request.method;

    const { user, error: authError } = await requireAdmin(request, env);
    if (authError) return authError;

    // ── GET /api/admin/pages — list all pages ──────────────────
    if (path === '/' && method === 'GET') {
        try {
            const pages = await env.DB.prepare(
                'SELECT id, title, slug, status, template, updated_at FROM pages ORDER BY title ASC'
            ).all();
            return list(pages.results);
        } catch (e) { return serverError('Failed to fetch pages'); }
    }

    // ── GET /api/admin/pages/:id ───────────────────────────────
    if (path.match(/^\/\d+$/) && method === 'GET') {
        const id = path.slice(1);
        const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
        if (!page) return notFound('Page not found');
        return ok(page);
    }

    // ── POST /api/admin/pages — create page ───────────────────
    if (path === '/' && method === 'POST') {
        try {
            const {
                title, content, excerpt,
                template = 'default',
                status = 'published',
                meta_title, meta_desc,
                show_in_footer = 0, show_in_nav = 0
            } = await request.json();

            if (!title || !content) return error('Title and content are required');
            const slug = slugify(title);

            // Check slug uniqueness
            const exists = await env.DB.prepare('SELECT id FROM pages WHERE slug = ?').bind(slug).first();
            if (exists) return error('A page with this title already exists');

            const result = await env.DB.prepare(`
                INSERT INTO pages
                    (title, slug, content, excerpt, template, status,
                     meta_title, meta_desc, show_in_footer, show_in_nav,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                RETURNING *
            `).bind(
                title, slug, content, excerpt || null, template, status,
                meta_title || title, meta_desc || null,
                show_in_footer ? 1 : 0, show_in_nav ? 1 : 0
            ).first();

            return created(result, 'Page created');
        } catch (e) {
            console.error('Page create error:', e);
            return serverError('Failed to create page');
        }
    }

    // ── PUT /api/admin/pages/:id — update page ─────────────────
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const id = path.slice(1);
        try {
            const existing = await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(id).first();
            if (!existing) return notFound('Page not found');

            const {
                title, content, excerpt, template, status,
                meta_title, meta_desc, show_in_footer, show_in_nav
            } = await request.json();

            await env.DB.prepare(`
                UPDATE pages SET
                    title          = COALESCE(?, title),
                    content        = COALESCE(?, content),
                    excerpt        = COALESCE(?, excerpt),
                    template       = COALESCE(?, template),
                    status         = COALESCE(?, status),
                    meta_title     = COALESCE(?, meta_title),
                    meta_desc      = COALESCE(?, meta_desc),
                    show_in_footer = COALESCE(?, show_in_footer),
                    show_in_nav    = COALESCE(?, show_in_nav),
                    updated_at     = datetime('now')
                WHERE id = ?
            `).bind(
                title || null, content || null, excerpt || null,
                template || null, status || null,
                meta_title || null, meta_desc || null,
                show_in_footer !== undefined ? (show_in_footer ? 1 : 0) : null,
                show_in_nav !== undefined ? (show_in_nav ? 1 : 0) : null,
                id
            ).run();

            const updated = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
            return ok(updated, 'Page updated');
        } catch (e) { return serverError('Failed to update page'); }
    }

    // ── PATCH /api/admin/pages/:id/status ─────────────────────
    if (path.match(/^\/\d+\/status$/) && method === 'PATCH') {
        const id = path.match(/(\d+)/)[1];
        const { status } = await request.json();
        if (!['draft', 'published'].includes(status)) return error('Invalid status');
        await env.DB.prepare(
            "UPDATE pages SET status = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(status, id).run();
        return ok(null, `Page ${status}`);
    }

    // ── DELETE /api/admin/pages/:id ────────────────────────────
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const id = path.slice(1);
        const existing = await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(id).first();
        if (!existing) return notFound('Page not found');
        await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
        return ok(null, 'Page deleted');
    }

    return error('Route not found', 404);
}

// ── Public pages route ────────────────────────────────────────
export async function pagesPublicRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/pages', '') || '/';
    const method = request.method;

    if (path === '/' && method === 'GET') {
        const pages = await env.DB.prepare(
            "SELECT id, title, slug, excerpt, show_in_footer, show_in_nav FROM pages WHERE status='published'"
        ).all();
        return list(pages.results);
    }

    if (path.match(/^\/[a-z0-9-]+$/) && method === 'GET') {
        const slug = path.slice(1);
        const page = await env.DB.prepare(
            "SELECT * FROM pages WHERE slug = ? AND status = 'published'"
        ).bind(slug).first();
        if (!page) return error('Page not found', 404);
        return ok(page);
    }

    return error('Route not found', 404);
}