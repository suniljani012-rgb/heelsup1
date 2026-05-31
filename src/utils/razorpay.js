// ============================================================
// HeelsUp — Razorpay Utility Helpers
// Cloudflare Workers runtime (NO Node.js crypto — use WebCrypto)
// ============================================================

export const razorpay = {

  // ── Create a Razorpay Order ─────────────────────────────────
  // Returns: { id, amount, currency, receipt, status }
  async createOrder(env, { amount, currency = 'INR', receipt, notes = {} }) {
    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ amount, currency, receipt, notes }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Razorpay createOrder failed:', errBody);
      return {};
    }

    return res.json();
  },

  // ── Verify Payment Signature (HMAC-SHA256) ──────────────────
  // Razorpay signs: razorpay_order_id + "|" + razorpay_payment_id
  async verifySignature(env, { razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
    const message = `${razorpay_order_id}|${razorpay_payment_id}`;
    return _hmacVerify(env.RAZORPAY_KEY_SECRET, message, razorpay_signature);
  },

  // ── Verify Webhook Signature ────────────────────────────────
  // Razorpay signs the raw request body with webhook secret
  async verifyWebhook(env, rawBody, signature) {
    // Set RAZORPAY_WEBHOOK_SECRET via: wrangler secret put RAZORPAY_WEBHOOK_SECRET
    return _hmacVerify(env.RAZORPAY_WEBHOOK_SECRET, rawBody, signature);
  },

  // ── Fetch a Razorpay Order (for admin/debugging) ────────────
  async fetchOrder(env, razorpayOrderId) {
    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const res = await fetch(`https://api.razorpay.com/v1/orders/${razorpayOrderId}`, {
      headers: { 'Authorization': `Basic ${credentials}` },
    });
    return res.ok ? res.json() : null;
  },

  // ── Fetch a Razorpay Payment ────────────────────────────────
  async fetchPayment(env, razorpayPaymentId) {
    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const res = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
      headers: { 'Authorization': `Basic ${credentials}` },
    });
    return res.ok ? res.json() : null;
  },

  // ── Initiate Refund ─────────────────────────────────────────
  async createRefund(env, razorpayPaymentId, amount = null, notes = {}) {
    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const body = { notes };
    if (amount) body.amount = amount; // partial refund in paise

    const res = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    return res.ok ? res.json() : null;
  },
};

// ── Internal: HMAC-SHA256 using WebCrypto (Workers compatible) ──
async function _hmacVerify(secret, message, expectedHex) {
  try {
    const enc     = new TextEncoder();
    const keyData = enc.encode(secret);
    const msgData = enc.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature  = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const hexSig     = Array.from(new Uint8Array(signature))
                            .map(b => b.toString(16).padStart(2, '0'))
                            .join('');

    return hexSig === expectedHex;
  } catch {
    return false;
  }
}
