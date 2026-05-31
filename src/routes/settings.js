// worker/src/routes/settings.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, error, serverError } from '../utils/response.js';

export async function settingsRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/settings', '') || '/';
    const method = request.method;

    // GET /api/settings — public settings (store name, currency etc)
    if (path === '/' && method === 'GET') {
        try {
            const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
            const settings = {};
            for (const row of rows.results) {
                try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
            }
            return ok(settings);
        } catch (e) { return serverError('Failed to fetch settings'); }
    }

    // PUT /api/settings — admin update (partial merge)
    if (path === '/' && method === 'PUT') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const body = await request.json();
            // Get existing settings
            const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
            const current = {};
            for (const row of rows.results) {
                try { current[row.key] = JSON.parse(row.value); } catch { current[row.key] = row.value; }
            }
            // Merge new values
            const merged = { ...current, ...body };
            // Save each key individually
            for (const [key, value] of Object.entries(merged)) {
                await env.DB.prepare(
                    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
                ).bind(key, typeof value === 'string' ? JSON.stringify(value) : String(value)).run();
            }
            return ok(null, 'Settings updated');
        } catch (e) { return serverError('Failed to update settings'); }
    }

    return error('Route not found', 404);
}