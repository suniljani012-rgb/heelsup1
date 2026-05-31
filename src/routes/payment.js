// worker/src/routes/payment.js
import { razorpay } from '../utils/razorpay.js';
import { ok, error as err } from '../utils/response.js';
import { requireAdmin, optionalAuth } from '../middleware/auth.js';
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
      "INSERT OR IGNORE INTO payments (order_id, provider, provider_order_id, provider_payment_id, amount, currency, status, raw_payload, created_at) VALUES (?,'RAZORPAY',?,?,?,'INR','captured',?,?)"
    ).bind(orderId, razorpay_order_id, razorpay_payment_id, pending.totalAmount, JSON.stringify(body), paidAt).run();

    // Increment coupon usage
    if (pending.couponCode) {
      await env.DB.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE code = ?").bind(pending.couponCode).run();
    }

    // Stock deduction and logging is now fully handled inside createOrderRecord -> deductSizeStock

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

  // ── POST /api/payment/refund ─────────────────────────────
  if (method === 'POST' && path === '/refund') {
    const { user, error: authErr } = await requireAdmin(request, env);
    if (authErr) return authErr;

    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON', 400); }

    const { order_id, amount } = body;
    if (!order_id) return err('Missing order_id', 400);

    const order = await env.DB.prepare(
      "SELECT * FROM orders WHERE id = ? OR order_number = ?"
    ).bind(order_id, order_id).first();

    if (!order) return err('Order not found', 404);
    if (!order.razorpay_payment_id) return err('Order has no payment reference (cannot refund)', 400);

    const refundAmount = amount ? Number(amount) : order.total_amount;
    const amountInPaise = Math.round(refundAmount * 100);

    const refundRes = await razorpay.createRefund(env, order.razorpay_payment_id, amountInPaise, {
      reason: 'Admin initiated refund',
      order_number: order.order_number
    });

    if (!refundRes) {
      return err('Failed to process refund on Razorpay', 500);
    }

    const refundId = refundRes.id || 'rfnd_unknown';
    const now = new Date().toISOString();

    await env.DB.prepare(
      "UPDATE orders SET payment_status='refunded', order_status='returned', updated_at=? WHERE id=?"
    ).bind(now, order.id).run();

    await env.DB.prepare(
      "UPDATE payments SET status='refunded', refund_id=?, refund_amount=?, raw_payload=? WHERE order_id=?"
    ).bind(refundId, refundAmount, JSON.stringify(refundRes), order.id).run();

    return ok({
      success: true,
      refund_id: refundId,
      amount: refundAmount,
      message: 'Refund processed successfully.'
    });
  }

  // ── GET /api/payment/transactions ────────────────────────
  if (method === 'GET' && path === '/transactions') {
    const { user, error: authErr } = await requireAdmin(request, env);
    if (authErr) return authErr;

    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = (page - 1) * limit;

    const totalRow = await env.DB.prepare("SELECT COUNT(*) as count FROM payments").first();
    const total = totalRow?.count || 0;

    const results = await env.DB.prepare(
      `SELECT p.*, o.order_number, o.customer_name, o.customer_email
       FROM payments p
       JOIN orders o ON p.order_id = o.id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    return ok({
      data: results.results || [],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
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
