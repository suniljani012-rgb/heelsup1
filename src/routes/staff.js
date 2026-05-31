// worker/src/routes/staff.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, error, serverError } from '../utils/response.js';

export async function staffRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/staff', '') || '/';
    const method = request.method;

    // GET /api/staff
    if (path === '/' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const staff = await env.DB.prepare(
            `SELECT s.*, (u.first_name || ' ' || COALESCE(u.last_name, '')) as name, u.email, u.phone, (CASE WHEN u.is_blocked=1 THEN 0 ELSE 1 END) as is_active, u.last_login_at 
             FROM staff s JOIN users u ON s.user_id = u.id 
             ORDER BY s.created_at DESC`
        ).all();
        return list(staff.results);
    }

    // POST /api/staff — add staff (creates user + staff record)
    if (path === '/' && method === 'POST') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const { first_name, last_name, email, phone, password, role, notes, permissions, is_active } = await request.json();
            if (!first_name || !email || !password) return error('First name, email and password required');

            const { hashPassword } = await import('../utils/password.js');
            const hashed = await hashPassword(password);
            const newUser = await env.DB.prepare(
                "INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_blocked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')) RETURNING id"
            ).bind(
                first_name, last_name || '', email.toLowerCase(), phone || null, hashed, role || 'staff', 
                (is_active !== undefined && !is_active) ? 1 : 0
            ).first();

            await env.DB.prepare(
                'INSERT INTO staff (user_id, role, notes, permissions) VALUES (?, ?, ?, ?)'
            ).bind(newUser.id, role || 'support', notes || null, JSON.stringify(permissions || [])).run();

            return ok({ id: newUser.id }, 'Staff member added');
        } catch (e) {
            if (e.message?.includes('UNIQUE')) return error('Email already exists', 409);
            return serverError('Failed to add staff');
        }
    }

    // PUT /api/staff/:id — update staff details
    if (path.match(/^\/\d+$/) && method === 'PUT') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        const { first_name, last_name, email, phone, role, notes, permissions, is_active } = await request.json();
        try {
            await env.DB.prepare(
                "UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, role = ?, is_blocked = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(
                first_name, last_name || '', email.toLowerCase(), phone || null, role || 'staff', 
                (is_active !== undefined && !is_active) ? 1 : 0, id
            ).run();
            await env.DB.prepare(
                "UPDATE staff SET role = ?, notes = ?, permissions = ? WHERE user_id = ?"
            ).bind(role || 'support', notes || null, JSON.stringify(permissions || []), id).run();
            return ok(null, 'Staff updated');
        } catch (e) {
            return serverError('Failed to update staff');
        }
    }

    // PATCH /api/staff/:id/suspend
    if (path.match(/^\/\d+\/suspend$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare("UPDATE users SET is_blocked = 1 WHERE id = ?").bind(id).run();
        return ok(null, 'Staff suspended');
    }
 
    // PATCH /api/staff/:id/activate
    if (path.match(/^\/\d+\/activate$/) && method === 'PATCH') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare("UPDATE users SET is_blocked = 0 WHERE id = ?").bind(id).run();
        return ok(null, 'Staff activated');
    }

    // POST /api/staff/:id/resend-invite
    if (path.match(/^\/\d+\/resend-invite$/) && method === 'POST') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare("UPDATE staff SET invite_sent_at = datetime('now') WHERE user_id = ?").bind(id).run();
        return ok(null, 'Invitation resent');
    }

    // PUT /api/staff/:id/permissions
    if (path.match(/^\/\d+\/permissions$/) && method === 'PUT') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.match(/(\d+)/)[1];
        const { permissions } = await request.json();
        await env.DB.prepare("UPDATE staff SET permissions = ? WHERE user_id = ?").bind(JSON.stringify(permissions), id).run();
        return ok(null, 'Permissions updated');
    }

    // DELETE /api/staff/:id
    if (path.match(/^\/\d+$/) && method === 'DELETE') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        const id = path.slice(1);
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
        return ok(null, 'Staff removed');
    }

    return error('Route not found', 404);
}