// worker/src/routes/payment.js
import { razorpay } from '../utils/razorpay.js';
import { ok, error as err } from '../utils/response.js';
import { optionalAuth } from '../middleware/auth.js';
import { createOrderRecord } from './orders.js';

export async function paymentRouter(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/payment', '');
  const method = request.method;

  // ── GET /api/payment/key ─────────────────────────────────
  if (method === 'GET' && path === '/key') {
    return ok({ key_id: env.RAZORPAY_KEY_ID });
  }

  // ── POST /api/payment/verify ─────────────────────────────
  if (method === 'POST' && path === '/verify') {
    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON', 400); }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return err('Missing payment fields', 400);

    // Verify Razorpay signature
    const isValid = await razorpay.verifySignature(env, {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isValid) return err('Invalid payment signature', 400);

    // Get pending order details from KV
    const pendingStr = await env.KV.get(`pending_order:${razorpay_order_id}`);
    if (!pendingStr) {
      return err("Order details not found or expired. If amount was debited, please contact support.", 404);
    }
    const pending = JSON.parse(pendingStr);

    // Now create the actual order record in D1 DB
    const createdRes = await createOrderRecord(env, {
      userId: pending.userId,
      customer: pending.customer,
      items: pending.items,
      deliveryMethod: pending.deliveryMethod,
      notes: pending.notes,
      paymentMethod: pending.paymentMethod,
      paymentStatus: "paid",
      orderStatus: "confirmed",
      couponCode: pending.couponCode,
      discountAmount: pending.discountAmount,
      orderNumber: pending.orderNumber
    });

    if (!createdRes.ok) {
      return err("Failed to place order in database: " + createdRes.error, 500);
    }

    const orderId = createdRes.order.id;
    const paidAt = new Date().toISOString();

    // Update order with razorpay details
    await env.DB.prepare(
      "UPDATE orders SET payment_status='paid', order_status='confirmed', razorpay_order_id=?, razorpay_payment_id=?, razorpay_signature=?, paid_at=?, updated_at=? WHERE id=?"
    ).bind(razorpay_order_id, razorpay_payment_id, razorpay_signature, paidAt, paidAt, orderId).run();

    // Insert payment record
    await env.DB.prepare(
      "INSERT INTO payments (order_id, provider, provider_order_id, provider_payment_id, amount, currency, status, raw_payload, created_at) VALUES (?,'RAZORPAY',?,?,?,'INR','captured',?,?)"
    ).bind(orderId, razorpay_order_id, razorpay_payment_id, pending.totalAmount, JSON.stringify(body), paidAt).run();

    // Increment coupon usage
    if (pending.couponCode) {
      await env.DB.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE code = ?").bind(pending.couponCode).run();
    }

    // Decrement stock for products
    for (const item of pending.items) {
      if (item.productId) {
        const prod = await env.DB.prepare("SELECT id, name, stock FROM products WHERE id=?").bind(item.productId).first();
        if (prod) {
          const newStock = Math.max(0, (prod.stock || 0) - (item.qty || 1));
          await env.DB.prepare("UPDATE products SET stock=?, sold_count=sold_count+?, updated_at=? WHERE id=?").bind(newStock, item.qty || 1, paidAt, prod.id).run();
          
          const diff = - (item.qty || 1);
          await env.DB.prepare(
            "INSERT INTO inventory_log (product_id, product_name, change_type, quantity_before, quantity_change, quantity_after, reason, created_at) VALUES (?,?,'sale',?,?,?,?,datetime('now'))"
          ).bind(prod.id, prod.name, prod.stock || 0, diff, newStock, `Razorpay sale: Order ${pending.orderNumber}`).run();
        }
      }
    }

    // Delete pending KV draft order
    await env.KV.delete(`pending_order:${razorpay_order_id}`).catch(() => {});

    return ok({
      success: true,
      order_number: createdRes.order.order_number,
      order_id: orderId,
      message: 'Payment successful! Order placed.',
    });
  }

  // ── POST /api/payment/fail ───────────────────────────────
  if (method === 'POST' && path === '/fail') {
    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON', 400); }

    const rzpOrderId = String(body.razorpay_order_id || "").trim();
    if (rzpOrderId) {
      await env.KV.delete(`pending_order:${rzpOrderId}`).catch(() => {});
    }

    const localOrderId = parseInt(body.orderId || 0);
    if (localOrderId) {
      const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(localOrderId).first();
      if (order) {
        if (order.payment_status === 'paid') return err("Already paid", 400);
        await env.DB.prepare("DELETE FROM order_items WHERE order_id=?").bind(localOrderId).run();
        await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(localOrderId).run();
      }
    }

    return ok({ ok: true });
  }

  // ── POST /api/payment/webhook ────────────────────────────
  if (method === 'POST' && path === '/webhook') {
    const signature = request.headers.get('x-razorpay-signature');
    const rawBody = await request.text();

    const isValid = await razorpay.verifyWebhook(env, rawBody, signature);
    if (!isValid) return err('Invalid webhook signature', 400);

    const event = JSON.parse(rawBody);

    if (event.event === 'payment.failed') {
      const rzpOrderId = event.payload?.payment?.entity?.order_id;
      if (rzpOrderId) {
        await env.DB.prepare(
          "UPDATE orders SET payment_status='failed', order_status='cancelled', updated_at=datetime('now') WHERE razorpay_order_id = ?"
        ).bind(rzpOrderId).run();
      }
    }

    return ok({ received: true });
  }

  return err('Not found', 404);
}
