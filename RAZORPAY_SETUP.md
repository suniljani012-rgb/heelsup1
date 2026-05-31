# Razorpay Integration — Setup Guide

## Naye files jo add hue hain

```
backend/
└── src/
    ├── routes/
    │   └── payment.js          ← Razorpay API routes (create-order, verify, webhook)
    ├── utils/
    │   └── razorpay.js         ← Razorpay helpers (createOrder, verifySignature, refund)
    └── middleware/
        └── auth.js             ← JWT verify middleware

public/
└── js/
    └── razorpay.js             ← Frontend checkout integration
```

---

## Step 1 — Razorpay Dashboard se keys lo

1. https://dashboard.razorpay.com → Login
2. Settings → API Keys → Generate Test Key
3. Note karo: `Key ID` aur `Key Secret`

---

## Step 2 — Secrets set karo (Cloudflare Workers)

```bash
npx wrangler secret put RAZORPAY_KEY_ID
# Paste karo: rzp_test_XXXXXXXXXXXX

npx wrangler secret put RAZORPAY_KEY_SECRET
# Paste karo: secret key

npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
# Razorpay Dashboard → Webhooks → Webhook Secret
```

---

## Step 3 — backend/src/index.js mein route add karo

Apne existing `index.js` main router mein ye add karo:

```javascript
import { handlePayment } from './routes/payment.js';

// existing routes ke saath:
if (url.pathname.startsWith('/api/payment')) {
  return handlePayment(request, env);
}
```

---

## Step 4 — checkout.html mein scripts add karo

`checkout.html` ke `</body>` se pehle ye 2 lines add karo:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script src="/js/razorpay.js"></script>
```

Aur "Place Order" button ka `onclick`:

```javascript
// Example:
const cartItems = JSON.parse(localStorage.getItem('heelsup_cart') || '[]');
const addressId = document.getElementById('selected-address-id').value;

HeelsUpPay.placeOrder(cartItems, addressId, couponCode);
```

---

## Step 5 — Razorpay Webhook configure karo

1. Razorpay Dashboard → Settings → Webhooks → Add New
2. URL: `https://heelsup.in/api/payment/webhook`
3. Events: `payment.captured`, `payment.failed`
4. Webhook Secret: same jo Step 2 mein set kiya

---

## Payment Flow (Summary)

```
Customer → Place Order
    ↓
POST /api/payment/create-order  (backend recalculates total)
    ↓
Razorpay modal open (frontend)
    ↓
Customer pays (UPI / Card / NetBanking)
    ↓
POST /api/payment/verify  (HMAC signature check)
    ↓
Order confirmed → redirect to orders.html
```

---

## Test Cards (Razorpay Test Mode)

| Type | Number | CVV | Expiry |
|------|--------|-----|--------|
| Visa | 4111 1111 1111 1111 | Any 3 digits | Any future |
| UPI  | success@razorpay | — | — |
| UPI Fail | failure@razorpay | — | — |

---

## Live mode ke liye

1. Razorpay Dashboard → Complete KYC
2. Live Keys generate karo
3. `wrangler secret put RAZORPAY_KEY_ID` → live key dalo
4. `wrangler secret put RAZORPAY_KEY_SECRET` → live secret dalo
