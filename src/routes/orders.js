// worker/src/routes/orders.js
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, notFound, serverError } from '../utils/response.js';
import { razorpay } from '../utils/razorpay.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSetting(env, key, fallback = '') {
    try {
        const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
        return row ? row.value : fallback;
    } catch {
        return fallback;
    }
}

async function generateOrderNumber(env) {
    const today = new Date();
    const prefix = `HU-${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
    const row = await env.DB.prepare("SELECT COUNT(*) as c FROM orders WHERE order_number LIKE ?").bind(`${prefix}-%`).first();
    const seq = String((row?.c || 0) + 1).padStart(4, "0");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${seq}-${rand}`;
}

function normalizeEmail(e) {
    return String(e || "").trim().toLowerCase();
}

function toInt(v, def) {
    const n = parseInt(v);
    return isNaN(n) ? def : n;
}

function formatOrder(o, items = null) {
    return {
        id: o.id,
        order_number: o.order_number,
        customer_name: o.customer_name || '',
        customer_email: o.customer_email || '',
        customer_phone: o.customer_phone || '',
        address_line1: o.address_line1 || '',
        address_line2: o.address_line2 || '',
        city: o.city || '',
        state: o.state || '',
        pincode: o.pincode || '',
        country: o.country || 'India',
        delivery_method: o.delivery_method || 'Standard',
        order_status: o.order_status || 'placed',
        payment_status: o.payment_status || 'pending',
        payment_method: o.payment_method || '',
        source: o.source || 'online',
        razorpay_order_id: o.razorpay_order_id || null,
        razorpay_payment_id: o.razorpay_payment_id || null,
        razorpay_signature: o.razorpay_signature || null,
        subtotal_amount: o.subtotal_amount || 0,
        discount_amount: o.discount_amount || 0,
        shipping_amount: o.shipping_amount || 0,
        tax_amount: o.tax_amount || 0,
        total_amount: o.total_amount || 0,
        coupon_code: o.coupon_code || null,
        tracking_number: o.tracking_number || null,
        tracking_url: o.tracking_url || null,
        exchange_reason: o.exchange_reason || null,
        exchange_product: o.exchange_product || null,
        paid_at: o.paid_at || null,
        confirmed_at: o.confirmed_at || null,
        shipped_at: o.shipped_at || null,
        out_for_delivery_at: o.out_for_delivery_at || null,
        delivered_at: o.delivered_at || null,
        cancelled_at: o.cancelled_at || null,
        created_at: o.created_at || null,
        updated_at: o.updated_at || null,
        notes: o.notes || null,
        ...(items !== null ? { items } : {}),
    };
}

function formatItem(it) {
    return {
        id: it.id,
        product_id: it.product_id,
        product_name: it.product_name || 'Product',
        sku: it.product_sku || null,
        image: it.image_url || null,
        size: it.size_label || null,
        color: null,
        quantity: it.quantity || 1,
        price: it.unit_price || 0,
        total_price: it.line_total || 0,
    };
}

// ── STOCK HELPERS ──────────────────────────────────────────────────────────────

async function deductSizeStock(env, productId, sizeLabel, qty) {
    // Deduct from size-specific stock if available
    if (sizeLabel) {
        const row = await env.DB.prepare(
            "SELECT stock FROM product_size_stock WHERE product_id=? AND size_label=?"
        ).bind(productId, sizeLabel).first();
        if (row) {
            const newStock = Math.max(0, (row.stock || 0) - qty);
            await env.DB.prepare(
                "UPDATE product_size_stock SET stock=?, updated_at=datetime('now') WHERE product_id=? AND size_label=?"
            ).bind(newStock, productId, sizeLabel).run();
        }
    }
    // Always deduct from legacy stock column (sum)
    await env.DB.prepare(
        "UPDATE products SET stock=MAX(0, stock-?), sold_count=COALESCE(sold_count,0)+?, updated_at=datetime('now') WHERE id=?"
    ).bind(qty, qty, productId).run();
}

async function restoreSizeStock(env, orderId) {
    // Restore stock for all items in an order (used on cancellation)
    try {
        const items = await env.DB.prepare(
            "SELECT product_id, quantity, size_label FROM order_items WHERE order_id=?"
        ).bind(orderId).all();
        for (const item of (items.results || [])) {
            if (!item.product_id) continue;
            if (item.size_label) {
                await env.DB.prepare(
                    "UPDATE product_size_stock SET stock=stock+?, updated_at=datetime('now') WHERE product_id=? AND size_label=?"
                ).bind(item.quantity, item.product_id, item.size_label).run();
            }
            await env.DB.prepare(
                "UPDATE products SET stock=stock+?, sold_count=MAX(0,COALESCE(sold_count,0)-?), updated_at=datetime('now') WHERE id=?"
            ).bind(item.quantity, item.quantity, item.product_id).run();
        }
    } catch (e) {
        console.error('restoreSizeStock error:', e);
    }
}

// ── CREATE ORDER RECORD (Used on successful verification) ─────────────────────
export async function createOrderRecord(env, input) {
    const customer = input.customer || {};
    const itemsRaw = Array.isArray(input.items) ? input.items : [];
    if (!itemsRaw.length) return { ok: false, error: "Order items are required" };

    const customerName = String(customer.name || "").trim();
    const customerEmail = normalizeEmail(customer.email);
    const customerPhone = String(customer.phone || "").trim();
    const addressLine1 = String(customer.addressLine1 || customer.address_line1 || "").trim();
    const addressLine2 = String(customer.addressLine2 || customer.address_line2 || "").trim();
    const city = String(customer.city || "").trim();
    const state = String(customer.state || "").trim();
    const pincode = String(customer.pincode || "").trim();
    const country = String(customer.country || "India").trim();

    const isPos = input.deliveryMethod === 'pos' || input.deliveryMethod === 'store';
    if (!customerName || !customerEmail || !customerPhone || (!isPos && (!addressLine1 || !city || !state || !pincode)))
        return { ok: false, error: "Incomplete customer details. name, email, phone, address, city, state, pincode required." };

    const finalAddressLine1 = isPos ? (addressLine1 || 'In-Store Purchase') : addressLine1;
    const finalCity = isPos ? (city || 'Store City') : city;
    const finalState = isPos ? (state || 'Store State') : state;
    const finalPincode = isPos ? (pincode || '000000') : pincode;

    const items = [];
    for (const item of itemsRaw) {
        const qty = Math.max(1, toInt(item.qty || item.quantity, 1));
        const unitPrice = Number(item.price || item.unitPrice || 0);
        if (!item.name || unitPrice <= 0) continue;
        items.push({
            productId: item.productId ? toInt(item.productId, 0) : null,
            name: String(item.name),
            sku: String(item.sku || ""),
            qty, unitPrice,
            lineTotal: Number((unitPrice * qty).toFixed(2)),
            size: String(item.size || ""),
            image: String(item.image || item.img || "")
        });
    }
    if (!items.length) return { ok: false, error: "No valid order items" };

    const subtotalAmount = Number(items.reduce((s, i) => s + i.lineTotal, 0).toFixed(2));
    const freeShipAbove = Number(await getSetting(env, "shipping_free_above", "799")) || 799;
    const shipCharge = Number(await getSetting(env, "shipping_standard_charge", "49")) || 49;
    const shippingAmount = subtotalAmount >= freeShipAbove ? 0 : shipCharge;
    const discountAmount = Number(input.discountAmount || 0);
    const taxAmount = Number(input.taxAmount || 0);
    const totalAmount = Math.max(0, Number((subtotalAmount + shippingAmount + taxAmount - discountAmount).toFixed(2)));
    const orderNumber = input.orderNumber || await generateOrderNumber(env);
    const createdAt = new Date().toISOString();
    const source = String(input.source || "online");

    const result = await env.DB.prepare(
        `INSERT INTO orders (order_number, user_id, customer_name, customer_email, customer_phone,
         address_line1, address_line2, city, state, pincode, country, delivery_method, coupon_code,
         payment_method, payment_status, order_status, subtotal_amount, shipping_amount, tax_amount, discount_amount,
         total_amount, notes, source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
        orderNumber, input.userId, customerName, customerEmail, customerPhone,
        finalAddressLine1, addressLine2, finalCity, finalState, finalPincode, country,
        String(input.deliveryMethod || "standard"), input.couponCode || null,
        input.paymentMethod, input.paymentStatus, input.orderStatus,
        subtotalAmount, shippingAmount, taxAmount, discountAmount,
        totalAmount, String(input.notes || "").trim(), source, createdAt, createdAt
    ).run();

    const orderId = result.meta?.last_row_id;
    for (const item of items) {
        await env.DB.prepare(
            "INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, line_total, size_label, image_url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
        ).bind(orderId, item.productId, item.name, item.sku, item.qty, item.unitPrice, item.lineTotal, item.size, item.image, createdAt).run();
        // Deduct stock per size
        if (item.productId) {
            await deductSizeStock(env, item.productId, item.size, item.qty);
        }
    }

    return { ok: true, order: { id: orderId, order_number: orderNumber, total_amount: totalAmount, subtotal_amount: subtotalAmount, shipping_amount: shippingAmount, tax_amount: taxAmount, discount_amount: discountAmount } };
}

// ── MAIN ROUTER ──────────────────────────────────────────────────────────────
export async function ordersRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/orders', '') || '/';
    const method = request.method;
    const params = url.searchParams;

    // ── POST /api/orders/initiate ───────────────────────────────────────────
    if (path === '/initiate' && method === 'POST') {
        try {
            const { user, error: authErr } = await requireAuth(request, env);
            if (authErr) return authErr;

            const body = await request.json();
            if (!body) return error('Invalid JSON', 400);

            const rzpKeyId = String(await getSetting(env, "razorpay_key_id", env.RAZORPAY_KEY_ID || "")).trim();
            const rzpKeySecret = String(await getSetting(env, "razorpay_key_secret", env.RAZORPAY_KEY_SECRET || "")).trim();
            if (!rzpKeyId || !rzpKeySecret) return error("Payment gateway not configured. Contact admin.", 503);

            const items = Array.isArray(body.items) ? body.items : [];
            if (!items.length) return error("Order items required", 400);

            // Validate stock — per-size if size selected, else total stock
            for (const item of items) {
                if (item.productId) {
                    const prod = await env.DB.prepare("SELECT id, name, stock FROM products WHERE id=?").bind(item.productId).first();
                    if (!prod) {
                        return error(`Product "${item.name}" not found.`, 404);
                    }
                    const qty = Math.max(1, toInt(item.qty || item.quantity, 1));
                    const sizeLabel = String(item.size || '').trim();
                    if (sizeLabel) {
                        // Check per-size stock
                        const sizeRow = await env.DB.prepare(
                            "SELECT stock FROM product_size_stock WHERE product_id=? AND size_label=?"
                        ).bind(item.productId, sizeLabel).first();
                        if (sizeRow) {
                            if ((sizeRow.stock || 0) < qty) {
                                return error(`Size ${sizeLabel} of "${prod.name}" is out of stock. Only ${sizeRow.stock} left.`, 400);
                            }
                        } else {
                            // No per-size record; fall back to total stock
                            if ((prod.stock || 0) < qty) {
                                return error(`Insufficient stock for "${prod.name}" (size ${sizeLabel}). Only ${prod.stock} left.`, 400);
                            }
                        }
                    } else {
                        // No size selected; check total stock
                        if ((prod.stock || 0) < qty) {
                            return error(`Insufficient stock for "${prod.name}". Only ${prod.stock} left.`, 400);
                        }
                    }
                }
            }

            let discountAmount = 0;
            let couponCode = String(body.couponCode || "").trim().toUpperCase();
            const subtotalAmount = Number(items.reduce((s, i) => s + (Number(i.price || 0) * Math.max(1, i.qty || i.quantity || 1)), 0).toFixed(2));
            if (couponCode) {
                const coupon = await env.DB.prepare("SELECT * FROM coupons WHERE code=? AND active = 1").bind(couponCode).first();
                if (coupon && subtotalAmount >= coupon.min_order) {
                    let disc = coupon.type === "percent" ? Math.round(subtotalAmount * (coupon.value / 100)) : coupon.value;
                    if (coupon.max_discount) disc = Math.min(disc, coupon.max_discount);
                    discountAmount = disc;
                }
            }

            const freeShipAbove = Number(await getSetting(env, "shipping_free_above", "799")) || 799;
            const shipCharge = Number(await getSetting(env, "shipping_standard_charge", "49")) || 49;
            const shippingAmount = subtotalAmount >= freeShipAbove ? 0 : shipCharge;
            const taxAmount = 0;
            const totalAmount = Math.max(0, Number((subtotalAmount + shippingAmount + taxAmount - discountAmount).toFixed(2)));

            const orderNumber = await generateOrderNumber(env);

            const itemsValidated = items.map(item => {
                const qty = Math.max(1, toInt(item.qty || item.quantity, 1));
                const unitPrice = Number(item.price || 0);
                return {
                    productId: item.productId ? toInt(item.productId, 0) : null,
                    name: String(item.name),
                    sku: String(item.sku || ""),
                    qty,
                    unitPrice,
                    lineTotal: Number((unitPrice * qty).toFixed(2)),
                    size: String(item.size || ""),
                    image: String(item.image || item.img || "")
                };
            });

            const amountPaise = Math.round(totalAmount * 100);

            // Free order bypass
            if (amountPaise <= 0) {
                const createdRes = await createOrderRecord(env, {
                    userId: user.id,
                    customer: body.customer || {
                        name: `${user.first_name} ${user.last_name || ""}`.trim(),
                        email: user.email,
                        phone: user.phone || body.phone || ""
                    },
                    items: itemsValidated,
                    deliveryMethod: body.deliveryMethod || "standard",
                    notes: body.notes || "",
                    paymentMethod: "FREE",
                    paymentStatus: "paid",
                    orderStatus: "confirmed",
                    couponCode: couponCode || null,
                    discountAmount,
                    orderNumber
                });
                if (!createdRes.ok) return error(createdRes.error, 400);
                if (couponCode) await env.DB.prepare("UPDATE coupons SET used_count=used_count+1 WHERE code=?").bind(couponCode).run();
                return ok({ key: "free_order", order: { id: createdRes.order.id, orderNumber: createdRes.order.order_number, amount: 0, discount: discountAmount } });
            }

            // Call Razorpay API
            const basicAuth = btoa(`${rzpKeyId}:${rzpKeySecret}`);
            const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
                method: "POST",
                headers: { Authorization: `Basic ${basicAuth}`, "content-type": "application/json" },
                body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: String(orderNumber) })
            });
            if (!rzpRes.ok) {
                const t = await rzpRes.text();
                return error("Payment gateway error: " + t, 502);
            }
            const rzpOrder = await rzpRes.json();

            // Save pending payload in KV (expires in 24 hours)
            const pendingPayload = {
                userId: user.id,
                customer: body.customer || {
                    name: `${user.first_name} ${user.last_name || ""}`.trim(),
                    email: user.email,
                    phone: user.phone || body.phone || ""
                },
                items: itemsValidated,
                deliveryMethod: body.deliveryMethod || "standard",
                notes: body.notes || "",
                paymentMethod: "RAZORPAY",
                couponCode: couponCode || null,
                discountAmount,
                subtotalAmount,
                shippingAmount,
                taxAmount,
                totalAmount,
                orderNumber
            };
            await env.KV.put(`pending_order:${rzpOrder.id}`, JSON.stringify(pendingPayload), { expirationTtl: 86400 });

            return ok({
                key: rzpKeyId,
                order: {
                    id: null,
                    orderNumber: orderNumber,
                    amount: totalAmount,
                    discount: discountAmount
                },
                razorpayOrder: rzpOrder
            });
        } catch (e) {
            console.error('Initiate order error:', e);
            return serverError('Failed to initiate order');
        }
    }

    // ── GET /api/orders/my ──────────────────────────────────────────────────
    if (path === '/my' && method === 'GET') {
        const { user, error: authErr } = await requireAuth(request, env);
        if (authErr) return authErr;
        try {
            const page = Math.max(1, parseInt(params.get('page') || '1'));
            const limit = Math.min(50, parseInt(params.get('limit') || '10'));
            const offset = (page - 1) * limit;

            const countRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM orders WHERE user_id = ?').bind(user.id).first();
            const ordersRes = await env.DB.prepare(
                `SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
            ).bind(user.id, limit, offset).all();

            const orders = [];
            for (const o of (ordersRes.results || [])) {
                const itemsRes = await env.DB.prepare(
                    `SELECT product_name, image_url, size_label, quantity, unit_price FROM order_items WHERE order_id = ? LIMIT 4`
                ).bind(o.id).all();
                const items = (itemsRes.results || []).map(it => ({
                    name: it.product_name,
                    image: it.image_url,
                    size: it.size_label,
                    qty: it.quantity,
                    price: it.unit_price
                }));
                orders.push({ ...formatOrder(o), items });
            }

            const total = countRow?.cnt || 0;
            return list(orders, { page, limit, total, pages: Math.ceil(total / limit) });
        } catch (e) {
            console.error('My orders error:', e);
            return serverError('Failed to fetch orders');
        }
    }

    // ── GET /api/orders/track/:orderNumber ──────────────────────────────────
    if (path.startsWith('/track/') && method === 'GET') {
        const orderNumber = path.replace('/track/', '');
        if (!orderNumber) return error('Order number required', 400);
        try {
            const order = await env.DB.prepare(
                `SELECT order_number, order_status, payment_status, tracking_number, tracking_url, shipped_at, delivered_at, created_at
                 FROM orders WHERE order_number = ?`
            ).bind(orderNumber.toUpperCase()).first();
            if (!order) return notFound('Order not found');
            return ok(order);
        } catch (e) {
            return serverError('Tracking lookup failed');
        }
    }

    // ── GET /api/orders/my/:id ──────────────────────────────────────────────
    if (path.match(/^\/my\/\d+$/) && method === 'GET') {
        const { user, error: authErr } = await requireAuth(request, env);
        if (authErr) return authErr;
        const id = parseInt(path.match(/(\d+)/)?.[1]);
        try {
            const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(id, user.id).first();
            if (!order) return notFound('Order not found');
            const itemsRes = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id).all();
            const items = (itemsRes.results || []).map(formatItem);
            return ok(formatOrder(order, items));
        } catch (e) {
            return serverError('Failed to fetch order');
        }
    }

    // ── POST /api/orders/:id/exchange ───────────────────────────────────────
    if (path.match(/^\/\d+\/exchange$/) && method === 'POST') {
        const { user, error: authErr } = await requireAuth(request, env);
        if (authErr) return authErr;
        const id = parseInt(path.match(/(\d+)/)?.[1]);
        try {
            const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(id, user.id).first();
            if (!order) return notFound('Order not found');

            if (order.order_status !== 'delivered')
                return error('Exchange can only be requested for delivered orders', 400);

            const windowDays = parseInt(await getSetting(env, "exchange_window_days", "7"));
            if (order.delivered_at) {
                const deliveredAt = new Date(order.delivered_at);
                const daysPassed = (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24);
                if (daysPassed > windowDays)
                    return error(`Exchange window of ${windowDays} days has expired`, 400);
            }

            const { reason, exchange_product } = await request.json();
            if (!reason?.trim()) return error('Exchange reason is required', 400);

            await env.DB.prepare(
                `UPDATE orders SET order_status = 'exchange_requested', exchange_reason = ?, exchange_product = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(reason.trim(), exchange_product || null, id).run();

            return ok(null, 'Exchange request submitted successfully');
        } catch (e) {
            return serverError('Failed to submit exchange request');
        }
    }

    // ─────────────── ADMIN ROUTES ────────────────────────────────────────────

    // ── GET /api/orders/admin ────────────────────────────────────────────────
    if (path === '/admin' && method === 'GET') {
        const { error: authErr } = await requireAdmin(request, env);
        if (authErr) return authErr;
        try {
            const page = Math.max(1, parseInt(params.get('page') || '1'));
            const limit = Math.min(100, parseInt(params.get('limit') || '20'));
            const offset = (page - 1) * limit;

            const status = params.get('status') || '';
            const source = params.get('source') || '';
            const q = params.get('q') || '';

            const where = [];
            const binds = [];

            if (status) { where.push('order_status = ?'); binds.push(status); }
            if (source) { where.push('source = ?'); binds.push(source); }
            if (q) {
                where.push('(order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR customer_phone LIKE ?)');
                const like = `%${q}%`;
                binds.push(like, like, like, like);
            }

            const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

            const countRow = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM orders ${whereSQL}`).bind(...binds).first();
            const ordersRes = await env.DB.prepare(
                `SELECT * FROM orders ${whereSQL} ORDER BY id DESC LIMIT ? OFFSET ?`
            ).bind(...binds, limit, offset).all();

            const total = countRow?.cnt || 0;
            const orders = (ordersRes.results || []).map(o => formatOrder(o, null));

            return list(orders, { page, limit, total, pages: Math.ceil(total / limit) });
        } catch (e) {
            console.error('Admin list orders error:', e);
            return serverError('Failed to fetch orders');
        }
    }

    // ── GET /api/orders/admin/stats ──────────────────────────────────────────
    if (path === '/admin/stats' && method === 'GET') {
        const { error: authErr } = await requireAdmin(request, env);
        if (authErr) return authErr;
        try {
            const stats = await env.DB.prepare(
                `SELECT
             COUNT(*) as total_orders,
             SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
             SUM(CASE WHEN order_status = 'placed' THEN 1 ELSE 0 END) as placed,
             SUM(CASE WHEN order_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
             SUM(CASE WHEN order_status = 'shipped' THEN 1 ELSE 0 END) as shipped,
             SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
             SUM(CASE WHEN order_status = 'exchange_requested' THEN 1 ELSE 0 END) as exchange_requested,
             SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END) as revenue,
             SUM(discount_amount) as total_discount,
             COUNT(DISTINCT user_id) as unique_customers
           FROM orders`
            ).first();

            return ok(stats);
        } catch (e) {
            return serverError('Failed to fetch stats');
        }
    }

    // ── GET /api/orders/admin/:id ─────────────────────────────────────────────
    if (path.match(/^\/admin\/\d+$/) && method === 'GET') {
        const { error: authErr } = await requireAdmin(request, env);
        if (authErr) return authErr;
        const id = parseInt(path.match(/(\d+)/)?.[1]);
        try {
            const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
            if (!order) return notFound('Order not found');
            const itemsRes = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(id).all();
            const items = (itemsRes.results || []).map(formatItem);
            return ok(formatOrder(order, items));
        } catch (e) {
            return serverError('Failed to fetch order');
        }
    }

    // ── PUT /api/orders/admin/:id/status ──────────────────────────────────────
    if (path.match(/^\/admin\/\d+\/status$/) && (method === 'PUT' || method === 'PATCH')) {
        const { error: authErr } = await requireAdmin(request, env);
        if (authErr) return authErr;
        const id = parseInt(path.match(/(\d+)/)?.[1]);
        try {
            const body = await request.json();
            const { status, tracking_number, tracking_url } = body;
            if (!status) return error('Status is required', 400);

            // Get current status before updating
            const currentOrder = await env.DB.prepare('SELECT order_status FROM orders WHERE id = ?').bind(id).first();

            const sets = ['order_status = ?', "updated_at = datetime('now')"];
            const binds = [status];

            if (status === 'confirmed') sets.push("confirmed_at = datetime('now')");
            if (status === 'shipped') sets.push("shipped_at = datetime('now')");
            if (status === 'delivered') sets.push("delivered_at = datetime('now')");
            if (status === 'cancelled') sets.push("cancelled_at = datetime('now')");

            if (tracking_number !== undefined) {
                sets.push('tracking_number = ?');
                binds.push(tracking_number);
            }
            if (tracking_url !== undefined) {
                sets.push('tracking_url = ?');
                binds.push(tracking_url);
            }

            binds.push(id);

            await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

            // Restore stock if order is being cancelled (and wasn't already cancelled)
            if (status === 'cancelled' && currentOrder?.order_status !== 'cancelled') {
                await restoreSizeStock(env, id);
            }

            const updated = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
            return ok(formatOrder(updated), 'Order status updated');
        } catch (e) {
            console.error('Update status error:', e);
            return serverError('Failed to update status');
        }
    }

    // ── PUT /api/orders/admin/:id/exchange ──────────────────────────────────
    if (path.match(/^\/admin\/\d+\/exchange$/) && method === 'PUT') {
        const { error: authErr } = await requireAdmin(request, env);
        if (authErr) return authErr;
        const id = parseInt(path.match(/(\d+)/)?.[1]);
        try {
            const { action } = await request.json();
            if (!['approve', 'reject'].includes(action))
                return error('action must be approve or reject', 400);

            const status = action === 'approve' ? 'exchange_approved' : 'exchange_rejected';
            await env.DB.prepare(
                `UPDATE orders SET order_status = ?, updated_at = datetime('now') WHERE id = ?`
            ).bind(status, id).run();

            return ok(null, `Exchange request ${action}d`);
        } catch (e) {
            return serverError('Failed to process exchange');
        }
    }

    return error('Route not found', 404);
}