// ============================================================
// HeelsUp — Frontend API Wrapper  v2.0
// public/js/api.js
// ============================================================

(function () {
    'use strict';

    const API_BASE = '/api';

    // ── Token Management ─────────────────────────────────────
    const getToken  = () => localStorage.getItem('heelsup_token');
    const setToken  = (t) => localStorage.setItem('heelsup_token', t);
    const clearToken = () => localStorage.removeItem('heelsup_token');

    // ── Request Deduplication ────────────────────────────────
    // Maps cache-key → Promise, so concurrent identical GET calls share one fetch
    const _inflight = new Map();

    // ── Exponential Backoff Retry ────────────────────────────
    async function withRetry(fn, retries = 2, delays = [500, 1500]) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            const result = await fn();
            if (result.status !== 0 || attempt === retries) return result;
            await new Promise(r => setTimeout(r, delays[attempt] ?? delays[delays.length - 1]));
        }
    }

    // ── Core Fetch ────────────────────────────────────────────
    async function _doFetch(endpoint, options) {
        const token = getToken();
        let res;
        try {
            res = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(options.headers || {}),
                },
            });
        } catch (err) {
            // Network-level error (status 0)
            console.error(`[HeelsUp API] network error on ${endpoint}`, err);
            return { ok: false, status: 0, data: null, error: err.message };
        }

        // Handle 401 — token expired / invalid
        if (res.status === 401) {
            clearToken();
            if (window.location.href.includes('admin')) {
                alert('Your session has expired. Please log in again.');
            } else {
                const redirect = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `/login.html?redirect=${redirect}`;
            }
            return { ok: false, status: 401, data: null };
        }

        let data;
        const ct = res.headers.get('content-type') || '';
        try {
            data = ct.includes('application/json') ? await res.json() : await res.text();
        } catch {
            data = null;
        }

        return { ok: res.ok, status: res.status, data };
    }

    // ── apiFetch (with deduplication for GET, retry for network errors) ──
    function apiFetch(endpoint, options = {}) {
        const isGet = !options.method || options.method.toUpperCase() === 'GET';

        if (isGet) {
            const key = endpoint;
            if (_inflight.has(key)) return _inflight.get(key);
            const promise = withRetry(() => _doFetch(endpoint, options))
                .finally(() => _inflight.delete(key));
            _inflight.set(key, promise);
            return promise;
        }

        // Non-GET: retry on network error, no deduplication
        return withRetry(() => _doFetch(endpoint, options));
    }

    // ── Upload (multipart/form-data) ──────────────────────────
    async function apiUpload(endpoint, formData) {
        const token = getToken();
        try {
            const res = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData,
            });
            let data;
            try { data = await res.json(); } catch { data = null; }
            return { ok: res.ok, status: res.status, data };
        } catch (err) {
            console.error(`[HeelsUp Upload] ${endpoint}`, err);
            return { ok: false, status: 0, data: null, error: err.message };
        }
    }

    // ── Core Methods ──────────────────────────────────────────
    const API = {
        get:    (url)        => apiFetch(url, { method: 'GET' }),
        post:   (url, body)  => apiFetch(url, { method: 'POST',   body: JSON.stringify(body) }),
        put:    (url, body)  => apiFetch(url, { method: 'PUT',    body: JSON.stringify(body) }),
        patch:  (url, body)  => apiFetch(url, { method: 'PATCH',  body: JSON.stringify(body) }),
        delete: (url)        => apiFetch(url, { method: 'DELETE' }),
        upload: (url, fd)    => apiUpload(url, fd),
    };

    // ── Auth Shortcuts ────────────────────────────────────────
    API.auth = {
        login:          (email, password) => API.post('/auth/login', { email, password }),
        register:       (data)            => API.post('/auth/register', data),
        sendOtp:        (email)           => API.post('/auth/send-otp', { email }),
        verifyOtp:      (email, otp)      => API.post('/auth/verify-otp', { email, otp }),
        me:             ()                => API.get('/auth/me'),
        forgotPassword: (email)           => API.post('/auth/forgot-password', { email }),
        resetPassword:  (token, password) => API.post('/auth/reset-password', { token, password }),
        profile:        (data)            => API.put('/auth/profile', data),
        changePassword: (data)            => API.post('/auth/change-password', data),
        google:         (token)           => API.post('/auth/google', { token }),
        logout: () => {
            clearToken();
            localStorage.removeItem('heelsup_user');
            window.location.href = '/login.html';
        },
        setToken,
        getToken,
        clearToken,
        isLoggedIn: () => !!getToken(),
    };

    // ── Product Shortcuts ─────────────────────────────────────
    API.products = {
        list:     (params = {}) => API.get('/products?' + new URLSearchParams(params)),
        get:      (id)          => API.get(`/products/${id}`),
        bySlug:   (slug)        => API.get(`/products/slug/${slug}`),
        featured: ()            => API.get('/products?featured=1&limit=8'),
        search:   (q, params={})=> API.get('/products?' + new URLSearchParams({ q, ...params })),
    };

    // ── Cart Shortcuts ────────────────────────────────────────
    API.cart = {
        get:    ()           => API.get('/cart'),
        add:    (item)       => API.post('/cart/add', item),
        update: (id, qty)    => API.patch(`/cart/${id}`, { qty }),
        remove: (id)         => API.delete(`/cart/${id}`),
        clear:  ()           => API.delete('/cart'),
        sync:   (items)      => API.post('/cart/sync', { items }),
    };

    // ── Order Shortcuts ───────────────────────────────────────
    API.orders = {
        list:     ()        => API.get('/orders/my'),
        get:      (id)      => API.get(`/orders/my/${id}`),
        initiate: (data)    => API.post('/orders/initiate', data),
        cod:      (data)    => API.post('/orders/cod', data),
        track:    (num)     => API.get(`/orders/track/${num}`),
        cancel:   (id)      => API.patch(`/orders/my/${id}/cancel`),
    };

    // ── Payment Shortcuts ─────────────────────────────────────
    API.payment = {
        verify: (data) => API.post('/payment/verify', data),
    };

    // ── Wishlist Shortcuts ────────────────────────────────────
    API.wishlist = {
        get:    ()   => API.get('/wishlist'),
        toggle: (id) => API.post('/wishlist/toggle', { product_id: id }),
        remove: (id) => API.delete(`/wishlist/${id}`),
    };

    // ── Review Shortcuts ──────────────────────────────────────
    API.reviews = {
        forProduct: (productId) => API.get(`/reviews?product_id=${productId}`),
        submit:     (data)      => API.post('/reviews', data),
    };

    // ── Brand / Category / Banner Shortcuts ───────────────────
    API.brands = {
        list: () => API.get('/brands'),
    };

    API.categories = {
        list: () => API.get('/categories'),
    };

    API.banners = {
        list: () => API.get('/banners'),
    };

    // ── Notifications Shortcuts ───────────────────────────────
    API.notifications = {
        list:       ()   => API.get('/notifications'),
        markRead:   (id) => API.patch(`/notifications/${id}/read`),
        markAllRead:()   => API.post('/notifications/read-all'),
    };

    // ── Coupons ───────────────────────────────────────────────
    API.coupons = {
        validate: (code, amount) => API.post('/coupons/validate', { code, amount }),
    };

    // ── Search Shortcut ───────────────────────────────────────
    API.search = (q, params = {}) => API.get('/products?' + new URLSearchParams({ q, ...params }));

    // ── Settings ──────────────────────────────────────────────
    API.settings = {
        get: () => API.get('/settings'),
    };

    // ── Admin Namespace ───────────────────────────────────────
    API.admin = {
        products: {
            list:   (p)     => API.get('/admin/products?' + new URLSearchParams(p || {})),
            create: (d)     => API.post('/admin/products', d),
            update: (id, d) => API.put(`/admin/products/${id}`, d),
            delete: (id)    => API.delete(`/admin/products/${id}`),
            patch:  (id, d) => API.patch(`/admin/products/${id}`, d),
        },
        orders: {
            list:         (p)     => API.get('/admin/orders?' + new URLSearchParams(p || {})),
            get:          (id)    => API.get(`/admin/orders/${id}`),
            updateStatus: (id, d) => API.put(`/admin/orders/${id}/status`, d),
            stats:        ()      => API.get('/admin/orders/stats'),
        },
        customers: {
            list:  (p)        => API.get('/admin/customers?' + new URLSearchParams(p || {})),
            get:   (id)       => API.get(`/admin/customers/${id}`),
            block: (id, v)    => API.patch(`/admin/customers/${id}/block`, { blocked: v }),
        },
        reviews: {
            list:    (p)  => API.get('/admin/reviews?' + new URLSearchParams(p || {})),
            approve: (id) => API.patch(`/admin/reviews/${id}/approve`),
            reject:  (id) => API.patch(`/admin/reviews/${id}/reject`),
        },
        banners: {
            list:   ()      => API.get('/admin/banners'),
            create: (d)     => API.post('/admin/banners', d),
            update: (id, d) => API.put(`/admin/banners/${id}`, d),
            delete: (id)    => API.delete(`/admin/banners/${id}`),
        },
        categories: {
            list:   ()      => API.get('/admin/categories'),
            create: (d)     => API.post('/admin/categories', d),
            update: (id, d) => API.put(`/admin/categories/${id}`, d),
            delete: (id)    => API.delete(`/admin/categories/${id}`),
        },
        coupons: {
            list:   (p)     => API.get('/admin/coupons?' + new URLSearchParams(p || {})),
            create: (d)     => API.post('/admin/coupons', d),
            update: (id, d) => API.put(`/admin/coupons/${id}`, d),
            delete: (id)    => API.delete(`/admin/coupons/${id}`),
        },
        settings: {
            get:  ()  => API.get('/admin/settings'),
            save: (d) => API.post('/admin/settings', d),
        },
        analytics: {
            dashboard: ()    => API.get('/admin/dashboard'),
            revenue:   (p)   => API.get('/admin/analytics/revenue?' + new URLSearchParams(p || {})),
            products:  ()    => API.get('/admin/analytics/products'),
            customers: ()    => API.get('/admin/analytics/customers'),
        },
        brands: {
            list:   ()      => API.get('/admin/brands'),
            create: (d)     => API.post('/brands', d),
            update: (id, d) => API.put(`/brands/${id}`, d),
            delete: (id)    => API.delete(`/brands/${id}`),
        },
        inventory: {
            list:        (p)     => API.get('/admin/inventory?' + new URLSearchParams(p || {})),
            updateStock: (id, d) => API.put(`/admin/products/${id}/size-stock`, d),
            log:         (p)     => API.get('/admin/inventory/log?' + new URLSearchParams(p || {})),
        },
        upload: (folder, formData) => API.upload(`/admin/upload?folder=${folder}`, formData),
        staff: {
            list:   ()      => API.get('/admin/staff'),
            create: (d)     => API.post('/admin/staff', d),
            update: (id, d) => API.put(`/admin/staff/${id}`, d),
            delete: (id)    => API.delete(`/admin/staff/${id}`),
        },
        shipping: {
            rules:      ()      => API.get('/admin/shipping/rules'),
            createRule: (d)     => API.post('/admin/shipping/rules', d),
            updateRule: (id, d) => API.put(`/admin/shipping/rules/${id}`, d),
            deleteRule: (id)    => API.delete(`/admin/shipping/rules/${id}`),
        },
        notifications: {
            list: (p) => API.get('/admin/notifications?' + new URLSearchParams(p || {})),
            send: (d) => API.post('/admin/notifications', d),
        },
    };

    // ── Expose globally ───────────────────────────────────────
    window.API = API;
})();