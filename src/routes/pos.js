// worker/src/routes/pos.js
import { requireAdmin } from '../middleware/auth.js';
import { ok, list, created, error, serverError } from '../utils/response.js';

function genOrderNumber() {
    return `POS-${Math.floor(Math.random() * 90000) + 10000}`;
}

export async function posRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/pos', '') || '/';
    const method = request.method;

    // POST /api/pos/sale — create POS/offline sale
    if (path === '/sale' && method === 'POST') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const { customer_name, customer_phone, items, payment_method, discount, notes } = await request.json();
            if (!items || items.length === 0) return error('No items in sale');

            let subtotal = 0;
            const orderItems = [];

            for (const item of items) {
                const product = await env.DB.prepare(
                    'SELECT id, name, sku, price, images_json, image_url, stock FROM products WHERE id = ? AND active = 1'
                ).bind(item.product_id).first();
                if (!product) return error(`Product ${item.product_id} not found`);

                // Check stock (D1 products.stock is global stock)
                if ((product.stock || 0) < item.qty) {
                    return error(`Insufficient stock for ${product.name}. Only ${product.stock} available.`);
                }

                const unitPrice = item.unit_price || product.price; // in Rupees
                const totalPrice = unitPrice * item.qty;
                subtotal += totalPrice;

                let imgs = [];
                try { imgs = JSON.parse(product.images_json || '[]'); } catch { }
                const img = imgs[0] || product.image_url || null;

                orderItems.push({
                    product_id: product.id,
                    product_name: product.name,
                    sku: product.sku || '',
                    qty: item.qty,
                    unit_price: unitPrice,
                    line_total: totalPrice,
                    size: item.size || null,
                    image: img
                });
            }

            const discountAmt = discount || 0; // in Rupees
            const total = subtotal - discountAmt;
            const orderNumber = genOrderNumber();
            const now = new Date().toISOString();

            // Insert into orders using D1 schema
            const orderRes = await env.DB.prepare(
                `INSERT INTO orders (order_number, user_id, customer_name, customer_email, customer_phone,
                 address_line1, city, state, pincode, country, delivery_method, source,
                 order_status, payment_status, payment_method, subtotal_amount, discount_amount, total_amount, notes, created_at, updated_at)
                 VALUES (?, ?, ?, 'pos@heelsup.in', ?, 'In-Store Purchase', 'Store City', 'Store State', '000000', 'India', 'pos', 'pos',
                 'delivered', 'paid', ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                orderNumber, user.id, customer_name || 'Walk-in', customer_phone || null,
                payment_method || 'cash', subtotal, discountAmt, total, notes || null, now, now
            ).run();

            const orderId = orderRes.meta?.last_row_id;

            // Insert order items & update product stock
            for (const item of orderItems) {
                await env.DB.prepare(
                    `INSERT INTO order_items (order_id, product_id, product_name, product_sku, quantity, unit_price, line_total, size_label, image_url, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(orderId, item.product_id, item.product_name, item.sku, item.qty, item.unit_price, item.line_total, item.size, item.image, now).run();

                // Update product stock
                const prod = await env.DB.prepare("SELECT stock, name FROM products WHERE id=?").bind(item.product_id).first();
                if (prod) {
                    const newStock = Math.max(0, (prod.stock || 0) - item.qty);
                    await env.DB.prepare("UPDATE products SET stock=?, sold_count=sold_count+?, updated_at=? WHERE id=?").bind(newStock, item.qty, now, item.product_id).run();

                    // Log inventory
                    await env.DB.prepare(
                        "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'sale',?,?,?,?,datetime('now'))"
                    ).bind(item.product_id, prod.name, prod.stock || 0, -item.qty, newStock, `POS sale: Order ${orderNumber}`).run();
                }
            }

            return created({ order_number: orderNumber, order_id: orderId, total }, 'POS sale recorded');
        } catch (e) {
            console.error('POS sale error:', e);
            return serverError('Failed to record sale');
        }
    }

    // GET /api/pos/sales — recent POS sales
    if (path === '/sales' && method === 'GET') {
        const { user, error: authError } = await requireAdmin(request, env);
        if (authError) return authError;
        try {
            const sales = await env.DB.prepare(
                "SELECT * FROM orders WHERE source='pos' ORDER BY id DESC LIMIT 50"
            ).all();
            return list(sales.results || []);
        } catch (e) {
            console.error('Fetch POS sales error:', e);
            return serverError('Failed to fetch sales');
        }
    }

    return error('Route not found', 404);
}