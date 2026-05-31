// ============================================================
// HeelsUp — Frontend Razorpay Checkout
// Include karein checkout.html mein:
//   <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
//   <script src="/js/razorpay.js"></script>
// ============================================================

const HeelsUpPay = {

  // ── Main checkout function — checkout.html se call karo ────
  // placeOrder(cartItems, addressId, couponCode)
  async placeOrder(cartItems, addressId, couponCode = null) {
    try {
      HeelsUpPay._setLoading(true);

      // 1. Backend se Razorpay order banao
      const token = localStorage.getItem('heelsup_token');
      const res = await fetch('/api/payment/create-order', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ cart_items: cartItems, address_id: addressId, coupon_code: couponCode }),
      });

      const data = await res.json();
      if (!data.success) {
        HeelsUpPay._showError(data.error || 'Order create failed');
        return;
      }

      // 2. Razorpay checkout open karo
      HeelsUpPay._openCheckout(data);

    } catch (e) {
      console.error(e);
      HeelsUpPay._showError('Network error. Please try again.');
    } finally {
      HeelsUpPay._setLoading(false);
    }
  },

  // ── Open Razorpay modal ─────────────────────────────────────
  _openCheckout(orderData) {
    const user = JSON.parse(localStorage.getItem('heelsup_user') || '{}');

    const options = {
      key:          orderData.key_id,
      amount:       orderData.amount,          // paise
      currency:     orderData.currency || 'INR',
      name:         'HeelsUp',
      description:  `Order ${orderData.order_number}`,
      image:        '/logo.png',
      order_id:     orderData.razorpay_order_id,

      // Pre-fill customer info
      prefill: {
        name:    user.name  || '',
        email:   user.email || '',
        contact: user.phone || '',
      },

      // HeelsUp brand color
      theme: { color: '#c9a96e' },

      // ── On Payment Success ────────────────────────────────
      handler: async function (response) {
        await HeelsUpPay._verifyPayment(response, orderData.order_number);
      },

      // ── On Modal Close (without payment) ─────────────────
      modal: {
        ondismiss: function () {
          HeelsUpPay._showError('Payment cancelled. Your order was not placed.');
        },
      },
    };

    const rzp = new Razorpay(options);

    // Payment failure event
    rzp.on('payment.failed', function (response) {
      console.error('Payment failed:', response.error);
      HeelsUpPay._showError(`Payment failed: ${response.error.description}`);
    });

    rzp.open();
  },

  // ── Verify payment signature with backend ──────────────────
  async _verifyPayment(rzpResponse, orderNumber) {
    try {
      HeelsUpPay._setLoading(true, 'Confirming payment...');

      const token = localStorage.getItem('heelsup_token');
      const res = await fetch('/api/payment/verify', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          razorpay_order_id:   rzpResponse.razorpay_order_id,
          razorpay_payment_id: rzpResponse.razorpay_payment_id,
          razorpay_signature:  rzpResponse.razorpay_signature,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Clear cart
        localStorage.removeItem('heelsup_cart');

        // Success — redirect to orders page
        window.location.href = `/orders.html?id=${data.order_id}&success=1`;
      } else {
        HeelsUpPay._showError(data.error || 'Payment verification failed. Contact support.');
      }
    } catch (e) {
      console.error(e);
      HeelsUpPay._showError('Verification error. Please contact support with your payment ID.');
    } finally {
      HeelsUpPay._setLoading(false);
    }
  },

  // ── UI Helpers ──────────────────────────────────────────────
  _setLoading(state, message = 'Processing...') {
    const btn = document.getElementById('place-order-btn');
    if (!btn) return;
    btn.disabled    = state;
    btn.textContent = state ? message : 'Place Order';
  },

  _showError(message) {
    // Uses HeelsUp toast if available, else alert
    if (typeof showToast === 'function') {
      showToast(message, 'error');
    } else {
      alert(message);
    }
  },
};

// ── Auto-expose globally ────────────────────────────────────
window.HeelsUpPay = HeelsUpPay;
