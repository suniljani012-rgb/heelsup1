// ============================================================
// HeelsUp — Receipts Routes
// /api/receipts/*
// Used by POS to generate and fetch receipts
// ============================================================

import { adminGuard } from '../middleware/adminAuth.js';
import { authenticate } from '../middleware/auth.js';
import { queryOne, run, now } from '../utils/db.js';
import { uploadReceipt, publicUrl } from '../utils/r2.js';
import { ok, error, unauthorized, forbidden, notFound } from '../utils/response.js';

export async function handleReceipts(request, env, path, method) {

    // ── GET /api/receipts/:orderId — get receipt URL ───────────
    const getMatch = path.match(/^\/api\/receipts\/([A-Z0-9-]+)$/);
    if (method === 'GET' && getMatch) {
        const orderId = getMatch[1];

        // Verify auth: either customer (own order) or admin
        const { user, error: authError } = await authenticate(request, env);
        if (authError) return authError;

        const order = await queryOne(env.DB,
            'SELECT id, order_number, user_id, receipt_url FROM orders WHERE order_number = ? OR id = ?',
            [orderId, parseInt(orderId) || 0]
        );

        if (!order) return notFound('Order not found');

        // Customer can only access own orders
            return forbidden('Forbidden');
        }

        if (order.receipt_url) {
            return ok({ receipt_url: order.receipt_url, order_number: order.order_number });
        }

        // Generate receipt on-demand if not stored
        const receiptUrl = await generateAndStoreReceipt(env, order.id);
        return ok({ receipt_url: receiptUrl, order_number: order.order_number });
    }

    // ── POST /api/receipts/generate — admin/POS: generate receipt ──
    if (method === 'POST' && path === '/api/receipts/generate') {
        const { user, earlyReturn } = await adminGuard(request, env);
        if (earlyReturn) return earlyReturn;

        const { order_id } = await request.json();
        if (!order_id) return error('order_id is required');

        const order = await queryOne(env.DB, 'SELECT id, order_number FROM orders WHERE id = ?', [order_id]);
        if (!order) return notFound('Order not found');

        const receiptUrl = await generateAndStoreReceipt(env, order.id);

        return ok({
            receipt_url: receiptUrl,
            order_number: order.order_number,
            message: 'Receipt generated',
        });
    }

    return notFound('Not found');
}

// ── Internal: Build receipt HTML and store to R2 ─────────────
async function generateAndStoreReceipt(env, orderId) {
    // Fetch order with items
    const order = await queryOne(env.DB, `
    SELECT o.*, u.first_name, u.email, u.phone
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `, [orderId]);

    if (!order) return null;

    // Receipt HTML (thermal printer style, 80mm)
    const html = buildReceiptHTML(order);
    const buffer = new TextEncoder().encode(html);

    const { ok: uploaded, url } = await uploadReceipt(
        env.MEDIA || env.BUCKET,
        env.R2_PUBLIC_URL,
        buffer,
        order.order_number || `ORD-${orderId}`
    );

    if (uploaded) {
        // Store URL in DB
        await run(env.DB,
            'UPDATE orders SET receipt_url = ? WHERE id = ?',
            [url, orderId]
        );
        return url;
    }

    return null;
}

function buildReceiptHTML(order) {
    const formatPrice = (p) => `₹${(p / 100).toLocaleString('en-IN')}`;
    const date = new Date(order.created_at).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    let items = [];
    try { items = JSON.parse(order.items || '[]'); } catch { }

    const itemRows = items.map(item => `
    <tr>
      <td style="padding:4px 0">${item.name || 'Item'} ${item.size ? `(${item.size})` : ''}</td>
      <td style="text-align:right;padding:4px 0">×${item.qty}</td>
      <td style="text-align:right;padding:4px 0">${formatPrice(item.unit_price * item.qty)}</td>
    </tr>
  `).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: monospace; font-size: 12px; width: 300px; padding: 12px; color: #000; }
    h1 { font-size: 18px; text-align: center; margin-bottom: 4px; }
    .center { text-align: center; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: bold; padding: 6px 0 2px; border-top: 1px solid #000; }
    .footer { text-align: center; margin-top: 12px; font-size: 11px; }
  </style>
</head>
<body>
  <h1>HeelsUp</h1>
  <p class="center">Jodhpur, Rajasthan, India</p>
  <p class="center">heelsup.in | +91-90000-00000</p>
  <div class="divider"></div>
  <p><b>Order:</b> ${order.order_number || `#${order.id}`}</p>
  <p><b>Date:</b> ${date}</p>
  <p><b>Customer:</b> ${order.first_name || 'Walk-in'}</p>
  ${order.phone ? `<p><b>Phone:</b> ${order.phone}</p>` : ''}
  <div class="divider"></div>
  <table>
    ${itemRows}
    <tr class="total-row">
      <td colspan="2">Subtotal</td>
      <td style="text-align:right">${formatPrice(order.subtotal || order.total_amount)}</td>
    </tr>
    ${order.discount_amount ? `<tr><td colspan="2">Discount</td><td style="text-align:right">-${formatPrice(order.discount_amount)}</td></tr>` : ''}
    ${order.shipping_amount ? `<tr><td colspan="2">Shipping</td><td style="text-align:right">${formatPrice(order.shipping_amount)}</td></tr>` : ''}
    <tr class="total-row">
      <td colspan="2"><b>TOTAL</b></td>
      <td style="text-align:right"><b>${formatPrice(order.total_amount)}</b></td>
    </tr>
  </table>
  <div class="divider"></div>
  <p><b>Payment:</b> ${(order.payment_method || 'Cash').toUpperCase()}</p>
  <div class="footer">
    <p>Thank you for shopping at HeelsUp!</p>
    <p>Exchanges accepted within 7 days</p>
    <p>heelsup.in</p>
  </div>
</body>
</html>`;
}