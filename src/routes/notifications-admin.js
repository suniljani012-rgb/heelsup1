// ============================================================
// HeelsUp — Notifications Admin Router
// Maps /api/admin/notifications/* → correct DB queries
// Separate from customer notifications router
// ============================================================

import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

export async function notificationsAdminRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/admin/notifications', '') || '/';
    const method = request.method;

    const { user, error: authError } = await requireAdmin(request, env);
    if (authError) return authError;

    // ── GET /api/admin/notifications — all notifications ───────
    if (path === '/' && method === 'GET') {
        try {
            const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
            const offset = parseInt(url.searchParams.get('offset') || '0');
            const type = url.searchParams.get('type');

            let sql = `
                SELECT n.*, (u.first_name || ' ' || COALESCE(u.last_name, '')) as user_name, u.email as user_email
                FROM notifications n
                LEFT JOIN users u ON u.id = n.user_id
            `;
            const params = [];
            if (type) { sql += ' WHERE n.type = ?'; params.push(type); }
            sql += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const rows = await env.DB.prepare(sql).bind(...params).all();
            const countR = await env.DB.prepare(
                type
                    ? 'SELECT COUNT(*) as n FROM notifications WHERE type = ?'
                    : 'SELECT COUNT(*) as n FROM notifications'
            ).bind(...(type ? [type] : [])).first();

            return list(rows.results, { limit, offset, total: countR?.n || 0 });
        } catch (e) { return serverError('Failed to fetch notifications'); }
    }

    // ── POST /api/admin/notifications — send/broadcast ─────────
    if (path === '/' && method === 'POST') {
        try {
            const { user_id, type = 'info', title, message, link } = await request.json();
            if (!title || !message) return error('title and message are required');

            if (user_id) {
                // Send to specific user
                await env.DB.prepare(
                    'INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
                ).bind(user_id, type, title, message, link || null).run();
                return created(null, 'Notification sent');
            } else {
                // Broadcast to all active customers
                const users = await env.DB.prepare(
                    "SELECT id FROM users WHERE role = 'customer' AND is_blocked = 0"
                ).all();
                for (const u of users.results) {
                    await env.DB.prepare(
                        'INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
                    ).bind(u.id, type, title, message, link || null).run();
                }
                return created({ sent_to: users.results.length }, `Broadcast sent to ${users.results.length} customers`);
            }
        } catch (e) { return serverError('Failed to send notification'); }
    }

    // ── PATCH /api/admin/notifications/read-all ────────────────
    if (path === '/read-all' && method === 'PATCH') {
        await env.DB.prepare(
            "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE is_read = 0"
        ).run();
        return ok(null, 'All notifications marked as read');
    }

    // ── PATCH /api/admin/notifications/:id/read ────────────────
    if (path.match(/^\/\d+\/read$/) && method === 'PATCH') {
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare(
            "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id = ?"
        ).bind(id).run();
        return ok(null, 'Notification marked as read');
    }

    // ── DELETE /api/admin/notifications/:id ────────────────────
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const id = path.slice(1);
        await env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
        return ok(null, 'Notification deleted');
    }

    // ── DELETE /api/admin/notifications — bulk delete ──────────
    if (path === '/' && method === 'DELETE') {
        const { ids } = await request.json();
        if (!Array.isArray(ids) || ids.length === 0) return error('ids array required');
        const placeholders = ids.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).bind(...ids).run();
        return ok(null, `${ids.length} notifications deleted`);
    }

    return error('Route not found', 404);
}