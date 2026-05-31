// ============================================================
// HeelsUp — Shipping Admin Routes
// /api/admin/shipping/*
// Full CRUD: zones, methods, settings, pincodes, couriers, COD
// ============================================================

import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';

export async function shippingAdminRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/admin/shipping', '') || '/';
    const method = request.method;

    const { user, error: authError } = await requireAdmin(request, env);
    if (authError) return authError;

    // ═══════════════════════════════════════════════════════════
    // SHIPPING SETTINGS  — /api/admin/shipping/settings
    // ═══════════════════════════════════════════════════════════

    if (path === '/settings' && method === 'GET') {
        try {
            const row = await env.DB.prepare(
                "SELECT value FROM settings WHERE key = 'shipping_settings'"
            ).first();
            const defaults = {
                free_shipping_threshold: 99900, // ₹999 in paise
                standard_rate: 4900,            // ₹49
                express_rate: 9900,             // ₹99
                processing_days: 1,
                weight_rate_per_kg: 0,
                default_courier: 'shiprocket',
            };
            return ok(row ? { ...defaults, ...JSON.parse(row.value) } : defaults);
        } catch (e) { return serverError('Failed to fetch shipping settings'); }
    }

    if (path === '/settings' && method === 'PUT') {
        try {
            const body = await request.json();
            const current = await env.DB.prepare(
                "SELECT value FROM settings WHERE key = 'shipping_settings'"
            ).first();
            const merged = { ...(current ? JSON.parse(current.value) : {}), ...body };
            await env.DB.prepare(`
                INSERT INTO settings (key, value, updated_at)
                VALUES ('shipping_settings', ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `).bind(JSON.stringify(merged)).run();
            return ok(merged, 'Shipping settings saved');
        } catch (e) { return serverError('Failed to save shipping settings'); }
    }

    // ═══════════════════════════════════════════════════════════
    // SHIPPING ZONES — /api/admin/shipping/zones/*
    // ═══════════════════════════════════════════════════════════

    if (path === '/zones' && method === 'GET') {
        const zones = await env.DB.prepare('SELECT * FROM shipping_zones ORDER BY sort_order ASC').all();
        return list(zones.results);
    }

    if (path === '/zones' && method === 'POST') {
        try {
            const { name, regions = [], sort_order = 0 } = await request.json();
            if (!name) return error('Zone name is required');
            const result = await env.DB.prepare(`
                INSERT INTO shipping_zones (name, regions, sort_order, created_at)
                VALUES (?, ?, ?, datetime('now')) RETURNING *
            `).bind(name, JSON.stringify(regions), sort_order).first();
            return created(result, 'Shipping zone created');
        } catch (e) { return serverError('Failed to create shipping zone'); }
    }

    if (path.match(/^\/zones\/\d+$/) && method === 'PUT') {
        const id = path.match(/(\d+)/)[1];
        const { name, regions, sort_order } = await request.json();
        await env.DB.prepare(`
            UPDATE shipping_zones SET
                name       = COALESCE(?, name),
                regions    = COALESCE(?, regions),
                sort_order = COALESCE(?, sort_order)
            WHERE id = ?
        `).bind(name || null, regions ? JSON.stringify(regions) : null, sort_order || null, id).run();
        return ok(null, 'Shipping zone updated');
    }

    if (path.match(/^\/zones\/\d+$/) && method === 'DELETE') {
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare('DELETE FROM shipping_zones WHERE id = ?').bind(id).run();
        return ok(null, 'Shipping zone deleted');
    }

    // ═══════════════════════════════════════════════════════════
    // SHIPPING METHODS — /api/admin/shipping/methods/*
    // ═══════════════════════════════════════════════════════════

    if (path === '/methods' && method === 'GET') {
        const methods = await env.DB.prepare(`
            SELECT sm.*, sz.name as zone_name
            FROM shipping_methods sm
            LEFT JOIN shipping_zones sz ON sz.id = sm.zone_id
            ORDER BY sm.sort_order ASC
        `).all();
        return list(methods.results);
    }

    if (path === '/methods' && method === 'POST') {
        try {
            const {
                zone_id, name, description, method_type = 'flat_rate',
                cost = 0, min_order = 0, max_order = null,
                estimated_days = '5-7', is_active = 1, sort_order = 0
            } = await request.json();
            if (!zone_id || !name) return error('zone_id and name are required');

            const result = await env.DB.prepare(`
                INSERT INTO shipping_methods
                    (zone_id, name, description, method_type, cost, min_order, max_order, estimated_days, is_active, sort_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING *
            `).bind(zone_id, name, description || null, method_type, cost, min_order, max_order, estimated_days, is_active ? 1 : 0, sort_order).first();
            return created(result, 'Shipping method created');
        } catch (e) { return serverError('Failed to create shipping method'); }
    }

    if (path.match(/^\/methods\/\d+$/) && method === 'PUT') {
        const id = path.match(/(\d+)/)[1];
        try {
            const { name, description, cost, min_order, max_order, estimated_days, is_active, sort_order } = await request.json();
            await env.DB.prepare(`
                UPDATE shipping_methods SET
                    name           = COALESCE(?, name),
                    description    = COALESCE(?, description),
                    cost           = COALESCE(?, cost),
                    min_order      = COALESCE(?, min_order),
                    max_order      = COALESCE(?, max_order),
                    estimated_days = COALESCE(?, estimated_days),
                    is_active      = COALESCE(?, is_active),
                    sort_order     = COALESCE(?, sort_order)
                WHERE id = ?
            `).bind(name || null, description || null, cost || null, min_order || null, max_order || null,
                estimated_days || null, is_active !== undefined ? (is_active ? 1 : 0) : null, sort_order || null, id).run();
            return ok(null, 'Shipping method updated');
        } catch (e) { return serverError('Failed to update shipping method'); }
    }

    if (path.match(/^\/methods\/\d+$/) && method === 'DELETE') {
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare('DELETE FROM shipping_methods WHERE id = ?').bind(id).run();
        return ok(null, 'Shipping method deleted');
    }

    // ═══════════════════════════════════════════════════════════
    // PINCODES — /api/admin/shipping/pincodes/*
    // ═══════════════════════════════════════════════════════════

    if (path === '/pincodes' && method === 'GET') {
        const count = parseInt(url.searchParams.get('count') || '0');
        const pincode = url.searchParams.get('pincode');
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
        const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50'));
        const offset = (page - 1) * limit;

        if (count === 1) {
            const n = await env.DB.prepare('SELECT COUNT(*) as n FROM shipping_pincodes').first();
            return ok({ count: n?.n || 0 });
        }

        let sql = 'SELECT * FROM shipping_pincodes';
        const params = [];
        if (pincode) { sql += ' WHERE pincode LIKE ?'; params.push(pincode + '%'); }
        sql += ' ORDER BY pincode ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = await env.DB.prepare(sql).bind(...params).all();
        return list(rows.results, { page, limit });
    }

    if (path === '/pincodes' && method === 'POST') {
        const { pincode, city, state, is_active = 1, cod_available = 1 } = await request.json();
        if (!pincode || !/^\d{6}$/.test(String(pincode))) return error('Valid 6-digit pincode required');
        try {
            await env.DB.prepare(`
                INSERT INTO shipping_pincodes (pincode, city, state, is_active, is_cod_available, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(pincode) DO UPDATE SET city=excluded.city, state=excluded.state,
                    is_active=excluded.is_active, is_cod_available=excluded.is_cod_available
            `).bind(String(pincode), city || null, state || null, is_active ? 1 : 0, cod_available !== false ? 1 : 0).run();
            return created(null, 'Pincode saved');
        } catch (e) { return serverError('Failed to save pincode'); }
    }

    // POST /api/admin/shipping/pincodes/bulk — bulk upload CSV (ADDED)
    if (path === '/pincodes/bulk' && method === 'POST') {
        try {
            const { pincodes = [] } = await request.json();
            if (!Array.isArray(pincodes) || pincodes.length === 0) return error('pincodes array required');

            let inserted = 0;
            for (const p of pincodes) {
                if (!p.pincode || !/^\d{6}$/.test(String(p.pincode))) continue;
                await env.DB.prepare(`
                    INSERT INTO shipping_pincodes (pincode, zone_id, city, state, is_active, is_cod_available, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(pincode) DO UPDATE SET
                        zone_id = excluded.zone_id,
                        city = excluded.city,
                        state = excluded.state,
                        is_active = excluded.is_active,
                        is_cod_available = excluded.is_cod_available
                `).bind(
                    String(p.pincode),
                    p.zone_id || null,
                    p.city || null,
                    p.state || null,
                    p.is_active !== false ? 1 : 0,
                    p.cod_available !== false ? 1 : 0
                ).run();
                inserted++;
            }
            return ok({ inserted }, `${inserted} pincodes imported`);
        } catch (e) {
            return serverError('Bulk import failed');
        }
    }

    // POST /api/admin/shipping/pincodes/check
    if (path === '/pincodes/check' && method === 'POST') {
        const { pincode } = await request.json();
        if (!pincode) return error('pincode required');
        const row = await env.DB.prepare(
            'SELECT * FROM shipping_pincodes WHERE pincode = ?'
        ).bind(String(pincode)).first();
        return ok({ serviceable: !!row, ...row });
    }

    if (path.match(/^\/pincodes\/\d+$/) && method === 'DELETE') {
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare('DELETE FROM shipping_pincodes WHERE pincode = ?').bind(id).run();
        return ok(null, 'Pincode removed');
    }

    // ═══════════════════════════════════════════════════════════
    // COURIERS — /api/admin/shipping/couriers/*
    // ═══════════════════════════════════════════════════════════

    if (path === '/couriers' && method === 'GET') {
        const couriers = await env.DB.prepare(
            'SELECT * FROM shipping_couriers ORDER BY name ASC'
        ).all();
        return list(couriers.results);
    }

    if (path === '/couriers' && method === 'POST') {
        const { name, api_key, api_secret, is_active = 1, config = {} } = await request.json();
        if (!name) return error('Courier name is required');
        try {
            const result = await env.DB.prepare(`
                INSERT INTO shipping_couriers (name, api_key, api_secret, is_active, config, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING *
            `).bind(name, api_key || null, api_secret || null, is_active ? 1 : 0, JSON.stringify(config)).first();
            return created(result, 'Courier added');
        } catch (e) { return serverError('Failed to add courier'); }
    }

    if (path.match(/^\/couriers\/\d+$/) && method === 'PUT') {
        const id = path.match(/(\d+)/)[1];
        const { name, api_key, api_secret, is_active, config } = await request.json();
        await env.DB.prepare(`
            UPDATE shipping_couriers SET
                name       = COALESCE(?, name),
                api_key    = COALESCE(?, api_key),
                api_secret = COALESCE(?, api_secret),
                is_active  = COALESCE(?, is_active),
                config     = COALESCE(?, config)
            WHERE id = ?
        `).bind(name || null, api_key || null, api_secret || null,
            is_active !== undefined ? (is_active ? 1 : 0) : null,
            config ? JSON.stringify(config) : null, id).run();
        return ok(null, 'Courier updated');
    }

    if (path.match(/^\/couriers\/\d+$/) && method === 'DELETE') {
        const id = path.match(/(\d+)/)[1];
        await env.DB.prepare('DELETE FROM shipping_couriers WHERE id = ?').bind(id).run();
        return ok(null, 'Courier removed');
    }

    // ═══════════════════════════════════════════════════════════
    // COD SETTINGS — /api/admin/shipping/cod
    // ═══════════════════════════════════════════════════════════

    if (path === '/cod' && method === 'GET') {
        const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cod_settings'").first();
        const defaults = { enabled: true, min_order: 0, max_order: 500000, extra_charge: 0, excluded_pincodes: [] };
        return ok(row ? { ...defaults, ...JSON.parse(row.value) } : defaults);
    }

    if (path === '/cod' && method === 'PUT') {
        const body = await request.json();
        const current = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cod_settings'").first();
        const merged = { ...(current ? JSON.parse(current.value) : {}), ...body };
        await env.DB.prepare(`
            INSERT INTO settings (key, value, updated_at) VALUES ('cod_settings', ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).bind(JSON.stringify(merged)).run();
        return ok(merged, 'COD settings saved');
    }

    return error('Route not found', 404);
}