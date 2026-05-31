// ============================================================
// HeelsUp — Unified Admin Router (FULLY INTEGRATED)
// Maps /api/admin/* → existing + new backend handlers
// All routes require admin role
// ============================================================

import { requireAdmin } from '../middleware/auth.js';
import {
    ok, list, created, error, notFound, serverError
} from '../utils/response.js';

// ── Existing routers (delegated with URL rewrite) ────────────
import { reviewsRouter } from './reviews.js';
import { ordersRouter } from './orders.js';
import { productsRouter } from './products.js';
import { customersRouter } from './customers.js';
import { bannersRouter } from './banners.js';
import { categoriesRouter } from './categories.js';
import { couponsRouter } from './coupons.js';
import { staffRouter } from './staff.js';
import { settingsRouter } from './settings.js';
import { inventoryRouter } from './misc.js';

// ── New admin-only routers ───────────────────────────────────
import { blogsAdminRouter } from './blogs.js';
import { collectionsAdminRouter } from './collections.js';
import { pagesAdminRouter } from './pages.js';
import { taxesAdminRouter } from './taxes.js';
import { returnsAdminRouter } from './returns.js';
import { shippingAdminRouter } from './shippings-admin.js';
import { notificationsAdminRouter } from './notifications-admin.js';
import { analyticsRouter, dashboardStatsRouter } from './analytics.js';
import { uploadRouter } from './upload.js';
import { posRouter } from './pos.js';

// ── Helper: rewrite request URL pathname ────────────────────
function rewritePath(request, newPathname) {
    const url = new URL(request.url);
    url.pathname = newPathname;
    return new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        duplex: 'half',
    });
}

// ── Main admin router ─────────────────────────────────────────
export async function adminRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname; // e.g. /api/admin/reviews

    // ── /api/admin/dashboard ─────────────────────────────────────
    // Returns dashboard KPIs in the shape the admin frontend expects
    if (path.startsWith('/api/admin/dashboard')) {
        return dashboardStatsRouter(request, env);
    }

    // ── /api/admin/reviews/* → /api/reviews/* ─────────────────
    if (path.startsWith('/api/admin/reviews')) {
        const sub = path.replace('/api/admin/reviews', '') || '/';
        if (sub === '/' || sub === '') {
            const req = rewritePath(request, '/api/reviews/admin/all');
            return reviewsRouter(req, env);
        }
        const req = rewritePath(request, '/api/reviews' + sub);
        return reviewsRouter(req, env);
    }

    // ── /api/admin/orders/* → /api/orders/* ───────────────────
    if (path.startsWith('/api/admin/orders')) {
        const sub = path.replace('/api/admin/orders', '') || '/';
        if (sub === '/' || sub === '') {
            const req = rewritePath(request, '/api/orders/admin');
            return ordersRouter(req, env);
        }
        const req = rewritePath(request, '/api/orders/admin' + sub);
        return ordersRouter(req, env);
    }

    // ── /api/admin/products/* → /api/products/* ───────────────
    if (path.startsWith('/api/admin/products')) {
        const sub = path.replace('/api/admin/products', '') || '/';
        const req = rewritePath(request, '/api/products' + sub);
        return productsRouter(req, env);
    }

    // ── /api/admin/customers/* → /api/customers/* ─────────────
    if (path.startsWith('/api/admin/customers')) {
        const sub = path.replace('/api/admin/customers', '') || '/';
        const req = rewritePath(request, '/api/customers' + sub);
        return customersRouter(req, env);
    }

    // ── /api/admin/banners/* → /api/banners/* ─────────────────
    if (path.startsWith('/api/admin/banners')) {
        const sub = path.replace('/api/admin/banners', '') || '/';
        if ((sub === '/' || sub === '') && request.method === 'GET') {
            const req = rewritePath(request, '/api/banners/admin/all');
            return bannersRouter(req, env);
        }
        const req = rewritePath(request, '/api/banners' + sub);
        return bannersRouter(req, env);
    }

    // ── /api/admin/categories/* → /api/categories/* ───────────
    if (path.startsWith('/api/admin/categories')) {
        const sub = path.replace('/api/admin/categories', '') || '/';
        const req = rewritePath(request, '/api/categories' + sub);
        return categoriesRouter(req, env);
    }

    // ── /api/admin/coupons/* → /api/coupons/* ─────────────────
    if (path.startsWith('/api/admin/coupons')) {
        const sub = path.replace('/api/admin/coupons', '') || '/';
        const req = rewritePath(request, '/api/coupons' + sub);
        return couponsRouter(req, env);
    }

    // ── /api/admin/staff/* → /api/staff/* ─────────────────────
    if (path.startsWith('/api/admin/staff')) {
        const sub = path.replace('/api/admin/staff', '') || '/';
        const req = rewritePath(request, '/api/staff' + sub);
        return staffRouter(req, env);
    }

    // ── /api/admin/settings/* → /api/settings/* ───────────────
    if (path.startsWith('/api/admin/settings')) {
        const sub = path.replace('/api/admin/settings', '') || '/';
        const req = rewritePath(request, '/api/settings' + sub);
        return settingsRouter(req, env);
    }

    // ── /api/admin/inventory/* → /api/inventory/* ─────────────
    if (path.startsWith('/api/admin/inventory')) {
        const sub = path.replace('/api/admin/inventory', '') || '/';
        const req = rewritePath(request, '/api/inventory' + sub);
        return inventoryRouter(req, env);
    }

    // ── /api/admin/notifications/* ─────────────────────────────
    if (path.startsWith('/api/admin/notifications')) {
        return notificationsAdminRouter(request, env);
    }

    // ── /api/admin/shipping/* ──────────────────────────────────
    if (path.startsWith('/api/admin/shipping')) {
        return shippingAdminRouter(request, env);
    }

    // ── /api/admin/blogs/* ─────────────────────────────────────
    if (path.startsWith('/api/admin/blogs')) {
        return blogsAdminRouter(request, env);
    }

    // ── /api/admin/collections/* ───────────────────────────────
    if (path.startsWith('/api/admin/collections')) {
        return collectionsAdminRouter(request, env);
    }

    // ── /api/admin/pages/* ─────────────────────────────────────
    if (path.startsWith('/api/admin/pages')) {
        return pagesAdminRouter(request, env);
    }

    // ── /api/admin/taxes/* ─────────────────────────────────────
    if (path.startsWith('/api/admin/taxes')) {
        return taxesAdminRouter(request, env);
    }

    // ── /api/admin/returns/* ───────────────────────────────────
    if (path.startsWith('/api/admin/returns')) {
        return returnsAdminRouter(request, env);
    }

    // ── /api/admin/analytics/* ────────────────────────────────── (ADDED)
    if (path.startsWith('/api/admin/analytics')) {
        return analyticsRouter(request, env);
    }

    // ── /api/admin/upload/* ──────────────────────────────────── (ADDED)
    if (path.startsWith('/api/admin/upload')) {
        return uploadRouter(request, env);
    }

    // ── /api/admin/pos/* ─────────────────────────────────────── (ADDED)
    if (path.startsWith('/api/admin/pos')) {
        return posRouter(request, env);
    }

    return notFound('Admin route not found');
}