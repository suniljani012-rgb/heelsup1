// ============================================================
// HeelsUp — Blog Posts Admin Routes
// /api/admin/blogs/*
// ============================================================

import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function blogsAdminRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/admin/blogs', '') || '/';
    const method = request.method;

    const { user, error: authError } = await requireAdmin(request, env);
    if (authError) return authError;

    // ── GET /api/admin/blogs — list all posts ──────────────────
    if (path === '/' && method === 'GET') {
        try {
            const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
            const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));
            const offset = (page - 1) * limit;
            const status = url.searchParams.get('status'); // draft | published | archived

            let sql = `SELECT b.*, (u.first_name || ' ' || COALESCE(u.last_name, '')) as author_name
                       FROM blog_posts b
                       LEFT JOIN users u ON b.author_id = u.id`;
            const params = [];

            if (status) {
                sql += ' WHERE b.status = ?';
                params.push(status);
            }

            sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const rows = await env.DB.prepare(sql).bind(...params).all();
            const countR = await env.DB.prepare(
                status
                    ? 'SELECT COUNT(*) as n FROM blog_posts WHERE status = ?'
                    : 'SELECT COUNT(*) as n FROM blog_posts'
            ).bind(...(status ? [status] : [])).first();

            return list(rows.results, { page, limit, total: countR?.n || 0 });
        } catch (e) { return serverError('Failed to fetch blog posts'); }
    }

    // ── GET /api/admin/blogs/:id ───────────────────────────────
    if (path.match(/^\/\d+$/) && method === 'GET') {
        const id = path.slice(1);
        const post = await env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first();
        if (!post) return notFound('Blog post not found');
        return ok(post);
    }

    // ── POST /api/admin/blogs — create post ───────────────────
    if (path === '/' && method === 'POST') {
        try {
            const {
                title, content, excerpt, cover_image_url,
                category, tags = [], status = 'draft',
                meta_title, meta_desc, published_at
            } = await request.json();

            if (!title || !content) return error('Title and content are required');

            const slug = slugify(title) + '-' + Date.now().toString(36);

            await env.DB.prepare(`
                INSERT INTO blog_posts
                    (author_id, title, slug, content, excerpt, cover_image_url,
                     category, tags, status, meta_title, meta_desc, published_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(
                user.id, title, slug, content, excerpt || null, cover_image_url || null,
                category || null, JSON.stringify(tags), status,
                meta_title || title, meta_desc || excerpt || null,
                status === 'published' ? (published_at || new Date().toISOString()) : null
            ).run();

            const newPost = await env.DB.prepare(
                'SELECT * FROM blog_posts WHERE slug = ?'
            ).bind(slug).first();

            return created(newPost, 'Blog post created');
        } catch (e) {
            console.error('Blog create error:', e);
            return serverError('Failed to create blog post');
        }
    }

    // ── PUT /api/admin/blogs/:id — update post ─────────────────
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const id = path.slice(1);
        try {
            const existing = await env.DB.prepare('SELECT id, status FROM blog_posts WHERE id = ?').bind(id).first();
            if (!existing) return notFound('Blog post not found');

            const {
                title, content, excerpt, cover_image_url,
                category, tags, status, meta_title, meta_desc, published_at
            } = await request.json();

            const newStatus = status || existing.status;
            const pubAt = newStatus === 'published' && existing.status !== 'published'
                ? new Date().toISOString()
                : (published_at || null);

            await env.DB.prepare(`
                UPDATE blog_posts SET
                    title           = COALESCE(?, title),
                    content         = COALESCE(?, content),
                    excerpt         = COALESCE(?, excerpt),
                    cover_image_url = COALESCE(?, cover_image_url),
                    category        = COALESCE(?, category),
                    tags            = COALESCE(?, tags),
                    status          = ?,
                    meta_title      = COALESCE(?, meta_title),
                    meta_desc       = COALESCE(?, meta_desc),
                    published_at    = COALESCE(?, published_at),
                    updated_at      = datetime('now')
                WHERE id = ?
            `).bind(
                title || null, content || null, excerpt || null,
                cover_image_url || null, category || null,
                tags ? JSON.stringify(tags) : null,
                newStatus,
                meta_title || null, meta_desc || null, pubAt,
                id
            ).run();

            const updated = await env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first();
            return ok(updated, 'Blog post updated');
        } catch (e) { return serverError('Failed to update blog post'); }
    }

    // ── PATCH /api/admin/blogs/:id/status — quick status change ─
    if (path.match(/^\/\d+\/status$/) && method === 'PATCH') {
        const id = path.match(/(\d+)/)[1];
        const { status } = await request.json();
        if (!['draft', 'published', 'archived'].includes(status)) {
            return error('status must be draft, published, or archived');
        }
        const pubAt = status === 'published' ? new Date().toISOString() : null;
        await env.DB.prepare(
            `UPDATE blog_posts SET status = ?, published_at = COALESCE(?, published_at), updated_at = datetime('now') WHERE id = ?`
        ).bind(status, pubAt, id).run();
        return ok(null, `Post ${status}`);
    }

    // ── DELETE /api/admin/blogs/:id ────────────────────────────
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const id = path.slice(1);
        const existing = await env.DB.prepare('SELECT id FROM blog_posts WHERE id = ?').bind(id).first();
        if (!existing) return notFound('Blog post not found');
        await env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id).run();
        return ok(null, 'Blog post deleted');
    }

    return error('Route not found', 404);
}

// ── Public blog routes (for /api/blogs/* frontend) ───────────
export async function blogsPublicRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/blogs', '') || '/';
    const method = request.method;

    // GET /api/blogs — published posts
    if (path === '/' && method === 'GET') {
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const limit = Math.min(20, parseInt(url.searchParams.get('limit') || '9'));
        const offset = (page - 1) * limit;
        const category = url.searchParams.get('category');

        let sql = `SELECT id, title, slug, excerpt, cover_image_url, category, tags, published_at
                   FROM blog_posts WHERE status = 'published'`;
        const params = [];
        if (category) { sql += ' AND category = ?'; params.push(category); }
        sql += ' ORDER BY published_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = await env.DB.prepare(sql).bind(...params).all();
        const countR = await env.DB.prepare(
            category
                ? "SELECT COUNT(*) as n FROM blog_posts WHERE status='published' AND category=?"
                : "SELECT COUNT(*) as n FROM blog_posts WHERE status='published'"
        ).bind(...(category ? [category] : [])).first();

        return list(rows.results, { page, limit, total: countR?.n || 0 });
    }

    // GET /api/blogs/:slug
    if (path.match(/^\/[a-z0-9-]+$/) && method === 'GET') {
        const slug = path.slice(1);
        const post = await env.DB.prepare(
            "SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'"
        ).bind(slug).first();
        if (!post) return notFound('Blog post not found');
        return ok(post);
    }

    return error('Route not found', 404);
}