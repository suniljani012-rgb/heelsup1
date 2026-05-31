// ============================================================
// HeelsUp — Reports Routes
// /api/reports/*
// Admin-only — sales, inventory, customer reports
// ============================================================

import { adminGuard } from '../middleware/adminAuth.js';
import { query, queryOne } from '../utils/db.js';
import { ok, error } from '../utils/response.js';

export async function handleReports(request, env, path, method) {

    // All reports are admin-only
    const { user, earlyReturn } = await adminGuard(request, env);
    if (earlyReturn) return earlyReturn;

    const url = new URL(request.url);
    const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    const fromDt = `${from} 00:00:00`;
    const toDt = `${to} 23:59:59`;

    // ── GET /api/reports/sales ─────────────────────────────────
    if (method === 'GET' && path === '/api/reports/sales') {
        try {
            const [summary, daily, byCategory, topProducts] = await Promise.all([
                // Overall summary
                queryOne(env.DB, `
            SELECT
              COUNT(*) as total_orders,
              SUM(total_amount) as total_revenue,
              AVG(total_amount) as avg_order_value,
              COUNT(DISTINCT user_id) as unique_customers
            FROM orders
            WHERE order_status NOT IN ('cancelled','returned')
              AND created_at BETWEEN ? AND ?
          `, [fromDt, toDt]),

                // Daily breakdown
                query(env.DB, `
            SELECT
              DATE(created_at) as date,
              COUNT(*) as orders,
              SUM(total_amount) as revenue
            FROM orders
            WHERE order_status NOT IN ('cancelled','returned')
              AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date ASC
          `, [fromDt, toDt]),

                // Sales by category
                query(env.DB, `
            SELECT
              p.category as category,
              COUNT(oi.id) as items_sold,
              SUM(oi.unit_price * oi.quantity) as revenue
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            JOIN orders o ON o.id = oi.order_id
            WHERE o.order_status NOT IN ('cancelled','returned')
              AND o.created_at BETWEEN ? AND ?
            GROUP BY p.category
            ORDER BY revenue DESC
          `, [fromDt, toDt]),

                // Top 10 products
                query(env.DB, `
            SELECT
              p.name,
              p.sku as product_sku,
              SUM(oi.quantity) as units_sold,
              SUM(oi.unit_price * oi.quantity) as revenue
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            JOIN orders o ON o.id = oi.order_id
            WHERE o.order_status NOT IN ('cancelled','returned')
              AND o.created_at BETWEEN ? AND ?
            GROUP BY p.id
            ORDER BY revenue DESC
            LIMIT 10
          `, [fromDt, toDt]),
            ]);

            return ok({ from, to, summary, daily, by_category: byCategory, top_products: topProducts });
        } catch (e) {
            console.error('Sales report error:', e);
            return error('Failed to generate sales report');
        }
    }

    // ── GET /api/reports/inventory ─────────────────────────────
    if (method === 'GET' && path === '/api/reports/inventory') {
        try {
            const [lowStock, outOfStock, totalValue] = await Promise.all([
                query(env.DB, `
            SELECT p.name, p.sku, p.stock
            FROM products p
            WHERE p.active = 1 AND p.stock > 0 AND p.stock <= 5
            ORDER BY p.stock ASC
            LIMIT 50
          `),

                query(env.DB, `
            SELECT p.name, p.sku
            FROM products p
            WHERE p.active = 1 AND p.stock = 0
            ORDER BY p.name
            LIMIT 50
          `),

                queryOne(env.DB, `
            SELECT SUM(p.stock * p.price) as value
            FROM products p
            WHERE p.active = 1
          `),
            ]);

            return ok({ low_stock: lowStock, out_of_stock: outOfStock, total_inventory_value: totalValue?.value || 0 });
        } catch (e) {
            console.error('Inventory report error:', e);
            return error('Failed to generate inventory report');
        }
    }

    // ── GET /api/reports/customers ─────────────────────────────
    if (method === 'GET' && path === '/api/reports/customers') {
        try {
            const [newCustomers, topCustomers, retention] = await Promise.all([
                // New customers per day
                query(env.DB, `
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users
            WHERE role = 'customer' AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date ASC
          `, [fromDt, toDt]),

                // Top 10 customers by spend
                query(env.DB, `
            SELECT (u.first_name || ' ' || COALESCE(u.last_name, '')) as first_name, u.email, u.phone,
              COUNT(o.id) as total_orders,
              SUM(o.total_amount) as total_spent
            FROM users u
            JOIN orders o ON o.user_id = u.id
            WHERE o.order_status NOT IN ('cancelled','returned')
            GROUP BY u.id
            ORDER BY total_spent DESC
            LIMIT 10
          `),

                // Repeat vs new buyers
                queryOne(env.DB, `
            SELECT
              COUNT(DISTINCT CASE WHEN order_count > 1 THEN user_id END) as repeat_customers,
              COUNT(DISTINCT CASE WHEN order_count = 1 THEN user_id END) as one_time_customers
            FROM (
              SELECT user_id, COUNT(*) as order_count
              FROM orders
              WHERE order_status NOT IN ('cancelled','returned')
              GROUP BY user_id
            )
          `),
            ]);

            return ok({ from, to, new_customers: newCustomers, top_customers: topCustomers, retention });
        } catch (e) {
            console.error('Customer report error:', e);
            return error('Failed to generate customer report');
        }
    }

    // ── GET /api/reports/orders ────────────────────────────────
    if (method === 'GET' && path === '/api/reports/orders') {
        try {
            const [byStatus, byPayment, refunds] = await Promise.all([
                query(env.DB, `
            SELECT order_status as status, COUNT(*) as count, SUM(total_amount) as total
            FROM orders
            WHERE created_at BETWEEN ? AND ?
            GROUP BY order_status
          `, [fromDt, toDt]),

                query(env.DB, `
            SELECT payment_method, COUNT(*) as count, SUM(total_amount) as total
            FROM orders
            WHERE created_at BETWEEN ? AND ?
            GROUP BY payment_method
          `, [fromDt, toDt]),

                queryOne(env.DB, `
            SELECT COUNT(*) as count, SUM(total_amount) as total
            FROM orders
            WHERE order_status IN ('returned','refunded')
              AND created_at BETWEEN ? AND ?
          `, [fromDt, toDt]),
            ]);

            return ok({ from, to, by_status: byStatus, by_payment: byPayment, refunds });
        } catch (e) {
            console.error('Orders report error:', e);
            return error('Failed to generate orders report');
        }
    }

    return error('Not found', 404);
}