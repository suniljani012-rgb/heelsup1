// ============================================================
// HeelsUp — Shipping Routes
// /api/shipping/*
// ============================================================

import { adminGuard } from '../middleware/adminAuth.js';
import { query, queryOne, run, now } from '../utils/db.js';
import { ok, error } from '../utils/response.js';

export async function handleShipping(request, env, path, method) {

    // ── GET /api/shipping/rates — calculate shipping for cart ──────
    if (method === 'GET' && path === '/api/shipping/rates') {
        const url = new URL(request.url);
        const pincode = url.searchParams.get('pincode') || '';
        const total = parseInt(url.searchParams.get('total') || '0'); // in paise

        // Free shipping above ₹999 (99900 paise)
        const freeThreshold = 99900;
        const isFree = total >= freeThreshold;

        const rates = [
            {
                id: 'standard',
                name: 'Standard Delivery',
                description: '5–7 business days',
                price: isFree ? 0 : 4900, // ₹49
                is_free: isFree,
                estimated_days: '5-7',
            },
            {
                id: 'express',
                name: 'Express Delivery',
                description: '2–3 business days',
                price: 9900, // ₹99
                is_free: false,
                estimated_days: '2-3',
            },
        ];

        // Check if pincode is serviceable (basic check)
        const pinAvailable = pincode.length === 6 && /^\d{6}$/.test(pincode);

        return ok({
            rates,
            pincode_serviceable: pinAvailable,
            free_shipping_above: freeThreshold,
            cart_total: total,
        });
    }

    // ── POST /api/shipping/check-pincode ───────────────────────────
    if (method === 'POST' && path === '/api/shipping/check-pincode') {
        const { pincode } = await request.json();
        if (!pincode || !/^\d{6}$/.test(String(pincode))) {
            return error('Invalid pincode — must be 6 digits');
        }

        // In production: integrate with Shiprocket / Delhivery API
        // For now: all Indian pincodes are serviceable
        return ok({
            pincode,
            serviceable: true,
            cod_available: false,
            prepaid_available: true,
            estimated_days: '5-7',
        });
    }

    // ── GET /api/shipping/track/:awb ──────────────────────────────
    const trackMatch = path.match(/^\/api\/shipping\/track\/(.+)$/);
    if (method === 'GET' && trackMatch) {
        const awb = trackMatch[1];

        // In production: call Shiprocket/Delhivery tracking API
        // Stub response for development
        return ok({
            awb,
            status: 'In Transit',
            events: [
                {
                    timestamp: new Date(Date.now() - 86400000).toISOString(),
                    location: 'Jodhpur, Rajasthan',
                    description: 'Shipment picked up',
                },
                {
                    timestamp: new Date(Date.now() - 43200000).toISOString(),
                    location: 'Jaipur Hub',
                    description: 'In transit to destination city',
                },
            ],
        });
    }

    // ── Admin: GET /api/shipping/zones ────────────────────────────
    if (method === 'GET' && path === '/api/shipping/zones') {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const zones = await query(env.DB, 'SELECT * FROM shipping_zones ORDER BY name');
        return ok({ zones });
    }

    // ── Admin: POST /api/shipping/zones ───────────────────────────
    if (method === 'POST' && path === '/api/shipping/zones') {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const body = await request.json();
        const { name, states, base_rate, free_above } = body;

        if (!name || !states) return error('name and states are required');

        const result = await run(env.DB,
            'INSERT INTO shipping_zones (name, states, base_rate, free_above, created_at) VALUES (?,?,?,?,?)',
            [name, JSON.stringify(states), base_rate || 4900, free_above || 99900, now()]
        );

        return ok({ id: result.meta.last_row_id, message: 'Shipping zone created' }, 201);
    }

    // ── Admin: PUT /api/shipping/zones/:id ────────────────────────
    const zoneMatch = path.match(/^\/api\/shipping\/zones\/(\d+)$/);
    if (method === 'PUT' && zoneMatch) {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const id = parseInt(zoneMatch[1]);
        const body = await request.json();
        const { name, states, base_rate, free_above, is_active } = body;

        await run(env.DB,
            'UPDATE shipping_zones SET name=?, states=?, base_rate=?, free_above=?, is_active=?, updated_at=? WHERE id=?',
            [name, JSON.stringify(states), base_rate, free_above, is_active ?? 1, now(), id]
        );

        return ok({ message: 'Shipping zone updated' });
    }

    // ── Admin: GET /api/shipping/methods ──────────────────────────
    if (method === 'GET' && path === '/api/shipping/methods') {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const methods = await query(env.DB, 'SELECT * FROM shipping_methods ORDER BY sort_order');
        return ok({ methods });
    }

    return error('Not found', 404);
}