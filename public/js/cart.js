/**
 * HeelsUp — Cart Utility (js/cart.js)
 * Shared across all pages. Manages cart in localStorage.
 */
(function () {
    const CART_KEY = 'heelsup_cart';
    const FREE_SHIP_THRESHOLD = 799;

    function getCart() {
        try { 
            const arr = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); 
            // Filter out any corrupted items that might have been saved during the bug
            return Array.isArray(arr) ? arr.filter(i => i && i.id && typeof i.price === 'number') : [];
        } catch { return []; }
    }

    function saveCart(cart) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        window.dispatchEvent(new Event('cart:updated'));
        updateBadge();
    }

    function addItem(product, qty, size) {
        qty = Math.max(1, parseInt(qty) || 1);
        const cart = getCart();
        const key = `${product.id}-${size || ''}`;
        const idx = cart.findIndex(i => i.key === key);
        if (idx >= 0) {
            cart[idx].qty += qty;
        } else {
            cart.push({
                key,
                id: product.id,
                name: product.name,
                price: product.price,
                original_price: product.original_price || null,
                image: (product.images && product.images[0]) || product.image_url || '',
                category: product.category || '',
                size: size || '',
                qty
            });
        }
        saveCart(cart);
        return true;
    }

    function removeItem(key) {
        saveCart(getCart().filter(i => i.key !== key));
    }

    function updateQty(key, newQty) {
        const cart = getCart();
        const idx = cart.findIndex(i => i.key === key);
        if (idx >= 0) {
            if (newQty < 1) { cart.splice(idx, 1); }
            else { cart[idx].qty = newQty; }
            saveCart(cart);
        }
    }

    function clearCart() {
        localStorage.removeItem(CART_KEY);
        window.dispatchEvent(new Event('cart:updated'));
        updateBadge();
    }

    function getCount() {
        return getCart().reduce((sum, i) => sum + i.qty, 0);
    }

    function getSubtotal() {
        return getCart().reduce((sum, i) => sum + i.price * i.qty, 0);
    }

    function getShipping(subtotal) {
        return (subtotal >= FREE_SHIP_THRESHOLD || subtotal === 0) ? 0 : 49;
    }

    function updateBadge() {
        const count = getCount();
        // Update all cart count elements (class-based and ID-based)
        document.querySelectorAll('#cart-count, #cart-drawer-count, .cart-badge, .cart-count, [data-cart-count]').forEach(el => {
            el.textContent = el.id === 'cart-drawer-count' ? `${count} item${count !== 1 ? 's' : ''}` : count;
            if (el.classList.contains('nav-badge') || el.id === 'cart-count') {
                el.style.display = count > 0 ? '' : 'none';
            }
        });
    }

    // Initialize badge on load
    document.addEventListener('DOMContentLoaded', updateBadge);
    window.addEventListener('storage', e => { if (e.key === CART_KEY) updateBadge(); });

    window.HeelsUpCart = { getCart, addItem, removeItem, updateQty, clearCart, getCount, getSubtotal, getShipping, updateBadge };
})();