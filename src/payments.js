// worker/src/routes/payment.js
import { requireAuth } from '../middleware/auth.js';
import { ok, error, serverError } from '../utils/response.js';

// Razorpay HMAC signature verification
async function verifyRazorpaySignature(orderId, paymentId, signature, secret) {
    const message = `${orderId}|${paymentId}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computed === signature;
}

export async function paymentRouter(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/payment', '') || '/';
    const method = request.method;

    // POST /api/payment/create-order — create Razorpay order
    if (path === '/create-order' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { order_id } = await request.json();
            if (!order_id) return error('order_id is required');

            // Get order from DB (verify it belongs to user)
            const order = await env.DB.prepare(
                'SELECT id, total, order_number FROM orders WHERE id = ? AND user_id = ?'
            ).bind(order_id, user.id).first();
            if (!order) return error('Order not found');
            if (order.total <= 0) return error('Invalid order total');

            // Create Razorpay order
            const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
            const rzRes = await fetch('https://api.razorpay.com/v1/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` },
                body: JSON.stringify({
                    amount: order.total,         // already in paise
                    currency: 'INR',
                    receipt: order.order_number,
                }),
            });

            if (!rzRes.ok) {
                const rzErr = await rzRes.json();
                console.error('Razorpay error:', rzErr);
                return error('Payment gateway error');
            }

            const rzOrder = await rzRes.json();

            // Save Razorpay order ID
            await env.DB.prepare(
                "UPDATE orders SET razorpay_order_id = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(rzOrder.id, order.id).run();

            return ok({
                razorpay_order_id: rzOrder.id,
                razorpay_key_id: env.RAZORPAY_KEY_ID,
                amount: order.total,
                currency: 'INR',
                order_number: order.order_number,
            });
        } catch (e) {
            console.error('Payment create error:', e);
            return serverError('Failed to create payment order');
        }
    }

    // POST /api/payment/verify — verify Razorpay payment
    if (path === '/verify' && method === 'POST') {
        const { user, error: authError } = await requireAuth(request, env);
        if (authError) return authError;
        try {
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = await request.json();
            if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
                return error('Missing payment verification data');
            }

            const isValid = await verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, env.RAZORPAY_KEY_SECRET);
            if (!isValid) return error('Payment verification failed — invalid signature', 400);

            // Update order as paid
            await env.DB.prepare(
                `UPDATE orders SET payment_status='paid', razorpay_payment_id=?, status='confirmed', updated_at=datetime('now')
         WHERE razorpay_order_id=? AND user_id=?`
            ).bind(razorpay_payment_id, razorpay_order_id, user.id).run();

            return ok({ payment_id: razorpay_payment_id }, 'Payment verified successfully');
        } catch (e) {
            console.error('Payment verify error:', e);
            return serverError('Payment verification failed');
        }
    }

    return error('Route not found', 404);
}