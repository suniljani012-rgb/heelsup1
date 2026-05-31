// ============================================================
// HeelsUp — Frontend API Wrapper
// public/js/api.js
// ============================================================

const API_BASE = '/api';

// ── Token Management ─────────────────────────────────────────
const getToken = () => localStorage.getItem('heelsup_token');
const setToken = (t) => localStorage.setItem('heelsup_token', t);
const clearToken = () => localStorage.removeItem('heelsup_token');

// ── Generic Fetch Wrapper ─────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                ...(options.headers || {}),
            },
        });

        // Handle 401 — token expired / invalid
        if (res.status === 401) {
            clearToken();
            const redirect = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login.html?redirect=${redirect}`;
            return { ok: false, status: 401, data: null };
        }

        let data;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            data = await res.json();
        } else {
            data = await res.text();
        }

        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        console.error(`[HeelsUp API] ${endpoint}`, err);
        return { ok: false, status: 0, data: null, error: err.message };
    }
}

// ── Upload (multipart) ────────────────────────────────────────
async function apiUpload(endpoint, formData) {
    const token = getToken();
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData,
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        console.error(`[HeelsUp Upload] ${endpoint}`, err);
        return { ok: false, status: 0, data: null, error: err.message };
    }
}

// ── Convenience Methods ───────────────────────────────────────
const API = {
    get: (url) => apiFetch(url, { method: 'GET' }),
    post: (url, body) => apiFetch(url, { method: 'POST', body: JSON.stringify(body) }),
    put: (url, body) => apiFetch(url, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (url, body) => apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (url) => apiFetch(url, { method: 'DELETE' }),
    upload: (url, formData) => apiUpload(url, formData),
};

// ── Auth Shortcuts ────────────────────────────────────────────
API.auth = {
    login: (email, password) => API.post('/auth/login', { email, password }),
    register: (data) => API.post('/auth/register', data),
    logout: () => { clearToken(); window.location.href = '/login.html'; },
    me: () => API.get('/auth/me'),
    refresh: () => API.post('/auth/refresh'),
    setToken,
    getToken,
    clearToken,
    isLoggedIn: () => !!getToken(),
};

// ── Product Shortcuts ─────────────────────────────────────────
API.products = {
    list: (params = {}) => API.get('/products?' + new URLSearchParams(params)),
    get: (id) => API.get(`/products/${id}`),
    bySlug: (slug) => API.get(`/products/slug/${slug}`),
    featured: () => API.get('/products?featured=1&limit=8'),
    search: (q, params = {}) => API.get('/products/search?' + new URLSearchParams({ q, ...params })),
};

// ── Cart Shortcuts ────────────────────────────────────────────
API.cart = {
    get: () => API.get('/cart'),
    add: (item) => API.post('/cart/add', item),
    update: (id, qty) => API.patch(`/cart/${id}`, { qty }),
    remove: (id) => API.delete(`/cart/${id}`),
    clear: () => API.delete('/cart'),
    sync: (items) => API.post('/cart/sync', { items }),
};

// ── Order Shortcuts ───────────────────────────────────────────
API.orders = {
    list: () => API.get('/orders'),
    get: (id) => API.get(`/orders/${id}`),
    create: (data) => API.post('/orders', data),
    cancel: (id) => API.patch(`/orders/${id}/cancel`),
    track: (id) => API.get(`/orders/${id}/tracking`),
};

// ── Payment Shortcuts ─────────────────────────────────────────
API.payment = {
    createOrder: (data) => API.post('/payment/create-order', data),
    verify: (data) => API.post('/payment/verify', data),
};

// ── Wishlist Shortcuts ────────────────────────────────────────
API.wishlist = {
    get: () => API.get('/wishlist'),
    add: (id) => API.post('/wishlist/add', { product_id: id }),
    remove: (id) => API.delete(`/wishlist/${id}`),
    toggle: (id) => API.post(`/wishlist/toggle`, { product_id: id }),
};

// ── Review Shortcuts ──────────────────────────────────────────
API.reviews = {
    forProduct: (productId) => API.get(`/reviews?product_id=${productId}`),
    submit: (data) => API.post('/reviews', data),
};

// ── Make globally available ───────────────────────────────────
window.API = API;