// public/js/api.js
// HeelsUp — Shared API Client
// Is file ko sare HTML pages mein include karo: <script src="/js/api.js"></script>

const API_BASE = (window.HEELSUP_CONFIG && window.HEELSUP_CONFIG.API_BASE) || '/api';

// ── Token Management ──────────────────────────────────────────
const Auth = {
    getToken: () => localStorage.getItem('heelsup_token'),
    setToken: (t) => localStorage.setItem('heelsup_token', t),
    clearToken: () => localStorage.removeItem('heelsup_token'),
    getUser: () => { try { return JSON.parse(localStorage.getItem('heelsup_user') || 'null'); } catch { return null; } },
    setUser: (u) => localStorage.setItem('heelsup_user', JSON.stringify(u)),
    clearUser: () => localStorage.removeItem('heelsup_user'),
    isLoggedIn: () => !!localStorage.getItem('heelsup_token'),
    isAdmin: () => { const u = Auth.getUser(); return u && u.role === 'admin'; },
    logout: () => { Auth.clearToken(); Auth.clearUser(); window.location.href = '/login.html'; },
};

// ── Fetch Wrapper ─────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
    const token = Auth.getToken();
    const headers = {
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        body: options.body instanceof FormData ? options.body : options.body,
    });

    let data;
    try { data = await res.json(); } catch { data = { success: false, error: 'Invalid response' }; }

    if (res.status === 401) {
        Auth.clearToken();
        Auth.clearUser();
        if (!window.location.pathname.includes('login')) {
            window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
        }
    }

    return { ok: res.ok, status: res.status, data };
}

// ── API Methods ───────────────────────────────────────────────
const API = {
    get: (url) => apiFetch(url, { method: 'GET' }),
    post: (url, body) => apiFetch(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
    put: (url, body) => apiFetch(url, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (url, body) => apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (url) => apiFetch(url, { method: 'DELETE' }),
};

// ── Auth Helpers ──────────────────────────────────────────────
async function requireAdminAuth() {
    if (!Auth.isLoggedIn()) {
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        return false;
    }
    const user = Auth.getUser();
    if (!user || user.role !== 'admin') {
        window.location.href = '/index.html';
        return false;
    }
    return true;
}

async function requireCustomerAuth() {
    if (!Auth.isLoggedIn()) {
        window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
        return false;
    }
    return true;
}

// ── Cart (localStorage) ───────────────────────────────────────
const Cart = {
    get: () => { try { return JSON.parse(localStorage.getItem('heelsup_cart') || '[]'); } catch { return []; } },
    save: (cart) => { localStorage.setItem('heelsup_cart', JSON.stringify(cart)); Cart.updateCount(); },
    add: (product, qty = 1, size = null, color = null) => {
        const cart = Cart.get();
        const key = `${product.id}-${size}-${color}`;
        const existing = cart.find(i => `${i.id}-${i.size}-${i.color}` === key);
        if (existing) { existing.qty += qty; }
        else { cart.push({ id: product.id, product_id: product.id, name: product.name, price: product.price, mrp: product.mrp, img: (JSON.parse(product.images || '[]'))[0] || product.img || product.images?.[0], qty, size, color, slug: product.slug }); }
        Cart.save(cart);
        if (Auth.isLoggedIn()) {
            API.post('/cart/sync', { items: Cart.get() }).catch(() => { });
        }
    },
    remove: (id, size, color) => {
        const cart = Cart.get().filter(i => !(i.id == id && i.size == size && i.color == color));
        Cart.save(cart);
    },
    updateQty: (id, size, color, qty) => {
        const cart = Cart.get();
        const item = cart.find(i => i.id == id && i.size == size && i.color == color);
        if (item) { if (qty < 1) Cart.remove(id, size, color); else { item.qty = qty; Cart.save(cart); } }
    },
    clear: () => { localStorage.removeItem('heelsup_cart'); Cart.updateCount(); },
    total: () => Cart.get().reduce((s, i) => s + (i.price * i.qty), 0),
    count: () => Cart.get().reduce((s, i) => s + i.qty, 0),
    updateCount: () => {
        const cnt = Cart.count();
        document.querySelectorAll('#cart-count, .cart-count').forEach(el => el.textContent = cnt);
    },
};

// ── Wishlist (localStorage) ───────────────────────────────────
const Wishlist = {
    get: () => { try { return JSON.parse(localStorage.getItem('heelsup_wishlist') || '[]'); } catch { return []; } },
    has: (id) => Wishlist.get().includes(Number(id)),
    toggle: (id) => {
        let wl = Wishlist.get();
        const numId = Number(id);
        if (wl.includes(numId)) { wl = wl.filter(x => x !== numId); } else { wl.push(numId); }
        localStorage.setItem('heelsup_wishlist', JSON.stringify(wl));
        Wishlist.updateCount();
        return wl.includes(numId);
    },
    count: () => Wishlist.get().length,
    updateCount: () => {
        const cnt = Wishlist.count();
        document.querySelectorAll('#wishlist-count, .wishlist-count').forEach(el => el.textContent = cnt);
    },
};

// ── Price Formatting ──────────────────────────────────────────
function formatPrice(paise) {
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0 });
}

function discountPct(price, mrp) {
    if (!mrp || mrp <= price) return 0;
    return Math.round((mrp - price) / mrp * 100);
}

// ── Product Card Builder ──────────────────────────────────────
function makeProductCard(product) {
    const images = typeof product.images === 'string' ? JSON.parse(product.images || '[]') : product.images || [];
    const img = images[0] || 'https://placehold.co/400x500/f4f0ea/8c6033?text=HeelsUp';
    const disc = discountPct(product.price, product.mrp);
    const inWishlist = Wishlist.has(product.id);
    const slug = product.slug || product.id;
    return `
    <div class="product-card" data-id="${product.id}">
      <div class="product-img-wrap">
        <a href="/product.html?id=${product.id}">
          <img src="${img}" alt="${product.name}" loading="lazy" />
        </a>
        ${disc >= 5 ? `<div class="product-badges"><span class="badge badge-sale">-${disc}%</span></div>` : ''}
        <button class="product-wishlist ${inWishlist ? 'active' : ''}" onclick="toggleWishlistCard(this, ${product.id})" title="Wishlist">
          <i class="fa-${inWishlist ? 'solid' : 'regular'} fa-heart"></i>
        </button>
        <button class="product-quick-add" onclick="event.stopPropagation(); quickAddToCart(${product.id}, this)">
          <i class="fa-solid fa-bag-shopping"></i> Add to Cart
        </button>
      </div>
      <div class="product-info">
        <div class="product-cat">${product.category_name || product.category || ''}</div>
        <a href="/product.html?id=${product.id}" class="product-name">${product.name}</a>
        <div class="product-price">
          <span class="price-current">${formatPrice(product.price)}</span>
          ${product.mrp && product.mrp > product.price ? `<span class="price-original">${formatPrice(product.mrp)}</span>` : ''}
        </div>
        ${product.avg_rating ? `<div class="product-rating"><i class="fa-solid fa-star" style="color:var(--color-warning);font-size:11px"></i> <span>${product.avg_rating}</span></div>` : ''}
      </div>
    </div>`;
}

// ── Quick Add to Cart ─────────────────────────────────────────
async function quickAddToCart(productId, btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        const res = await API.get(`/products/${productId}`);
        if (res.ok && res.data.data) {
            const p = res.data.data;
            const sizes = typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes;
            Cart.add(p, 1, sizes?.[0] || null, null);
            showToast('success', 'Added to Cart!', `${p.name} added.`);
        }
    } catch (e) { showToast('error', 'Error', 'Failed to add to cart'); }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bag-shopping"></i> Add to Cart';
}

// ── Wishlist Toggle ───────────────────────────────────────────
function toggleWishlistCard(btn, productId) {
    const active = Wishlist.toggle(productId);
    btn.classList.toggle('active', active);
    btn.querySelector('i').className = `fa-${active ? 'solid' : 'regular'} fa-heart`;
    showToast(active ? 'success' : 'info', active ? 'Wishlist' : 'Removed', active ? 'Added to wishlist' : 'Removed from wishlist');
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(type, title, message) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const id = 'toast-' + Date.now();
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
    container.insertAdjacentHTML('beforeend', `
    <div class="toast toast-${type}" id="${id}">
      <i class="fa-solid ${icons[type] || 'fa-circle-info'} toast-icon"></i>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" onclick="document.getElementById('${id}').remove()">✕</button>
    </div>`);
    setTimeout(() => document.getElementById(id)?.remove(), 4000);
}

// ── Init on page load ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    Cart.updateCount();
    Wishlist.updateCount();

    // Update nav user/cart state
    const userBtn = document.getElementById('nav-user-btn');
    if (userBtn && Auth.isLoggedIn()) {
        const user = Auth.getUser();
        userBtn.href = '/profile.html';
        userBtn.title = user?.name || 'My Account';
    }
});