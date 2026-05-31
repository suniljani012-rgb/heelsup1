// ============================================================
// HeelsUp — Notifications Routes
// /api/notifications/*
// ============================================================

import { adminGuard } from '../middleware/adminAuth.js';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, run, now } from '../utils/db.js';
import { ok, error, unauthorized } from '../utils/response.js';

export async function handleNotifications(request, env, path, method) {

    // ── GET /api/notifications — customer: own notifs, admin: all ──
    if (method === 'GET' && path === '/api/notifications') {
        const { user, error: authError } = await authenticate(request, env);
        if (authError) return authError;

        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const unread = url.searchParams.get('unread');

        let sql = 'SELECT * FROM notifications WHERE user_id = ?';
        const params = [user.id];

        if (unread === '1') { sql += ' AND is_read = 0'; }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = await query(env.DB, sql, params);

        const unreadCount = await queryOne(env.DB,
            'SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0',
            [user.id]
        );

        return ok({ notifications: rows, unread_count: unreadCount?.n || 0 });
    }

    // ── GET /api/notifications/admin/all — admin: all notifications ──
    if (method === 'GET' && path === '/api/notifications/admin/all') {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const type = url.searchParams.get('type');

        let sql = 'SELECT n.*, u.first_name, u.email FROM notifications n LEFT JOIN users u ON u.id = n.user_id';
        const params = [];

        if (type) {
            sql += ' WHERE n.type = ?';
            params.push(type);
        }

        sql += ' ORDER BY n.created_at DESC LIMIT ?';
        params.push(limit);

        const rows = await query(env.DB, sql, params);
        return ok({ notifications: rows });
    }

    // ── PATCH /api/notifications/:id/read — mark as read ──────────
    const readMatch = path.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (method === 'PATCH' && readMatch) {
        const { user, error: authError } = await authenticate(request, env);
        if (authError) return authError;

        const id = parseInt(readMatch[1]);
        await run(env.DB,
            'UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ?',
            [now(), id, user.id]
        );
        return ok({ message: 'Marked as read' });
    }

    // ── PATCH /api/notifications/read-all — mark all read ─────────
    if (method === 'PATCH' && path === '/api/notifications/read-all') {
        const { user, error: authError } = await authenticate(request, env);
        if (authError) return authError;

        await run(env.DB,
            'UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0',
            [now(), user.id]
        );
        return ok({ message: 'All notifications marked as read' });
    }

    // ── DELETE /api/notifications/:id ─────────────────────────────
    const deleteMatch = path.match(/^\/api\/notifications\/(\d+)$/);
    if (method === 'DELETE' && deleteMatch) {
        const { user, error: authError } = await authenticate(request, env);
        if (authError) return authError;

        const id = parseInt(deleteMatch[1]);
        await run(env.DB,
            'DELETE FROM notifications WHERE id = ? AND user_id = ?',
            [id, user.id]
        );
        return ok({ message: 'Notification deleted' });
    }

    // ── POST /api/notifications/send — admin: broadcast ───────────
    if (method === 'POST' && path === '/api/notifications/send') {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const body = await request.json();
        const { user_id, type = 'info', title, message, link } = body;

        if (!title || !message) return error('title and message are required');

        if (user_id) {
            // Send to specific user
            await run(env.DB,
                'INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?,?,?,?,?,?)',
                [user_id, type, title, message, link || null, now()]
            );
        } else {
            // Broadcast to all active customers
            const users = await query(env.DB,
                "SELECT id FROM users WHERE role = 'customer' AND is_blocked = 0"
            );
            for (const u of users) {
                await run(env.DB,
                    'INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?,?,?,?,?,?)',
                    [u.id, type, title, message, link || null, now()]
                );
            }
        }

        return ok({ message: 'Notification(s) sent' }, 201);
    }

    return error('Not found', 404);
}