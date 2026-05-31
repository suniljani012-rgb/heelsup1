/**
 * ═══════════════════════════════════════════════════════════════════
 *  HeelsUp Admin — dashboard.js  v3.0
 *  Enterprise Admin Engine
 *
 *  Architecture mirrors worker/src/routes/orders.js:
 *   • Auth Guard      — session check on boot
 *   • Cache           — TTL key-value store
 *   • API             — single authenticated fetch wrapper
 *   • Progress        — NProgress-style top bar
 *   • Toast           — self-dismissing notifications
 *   • Nav             — section routing
 *   • Dashboard       — stats, pipeline, recent orders, top products
 *   • Orders          — full CRUD, filters, tabs, pagination, modal,
 *                        invoice print, CSV export
 *   • Products        — list, add/edit, delete
 *   • Customers       — list, role management
 *   • Coupons         — list, add/edit, delete
 *   • Reviews         — list, approve/reject
 *   • Helpers         — formatters, pagination renderer
 *
 *  Security rules (mirrors orders.js):
 *   • Auth guard fires before any data load
 *   • Razorpay payment_status is LOCKED — never editable by admin UI
 *   • 401/403 → authGuard shown, layout hidden
 *   • All user-supplied strings are HTML-escaped before render
 * ═══════════════════════════════════════════════════════════════════
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// § AUTH GUARD
// Mirrors requireAdmin() in worker middleware — blocks UI before data loads
// ══════════════════════════════════════════════════════════════════════════════

(function initAuth() {
    let user = null;
    try {
        user = typeof HeelsUpAuth !== 'undefined' ? HeelsUpAuth.getUser() : null;
    } catch (_) { }

    if (!user || user.role !== 'admin') {
        document.getElementById('authGuard').classList.add('show');
        document.querySelector('.layout').style.visibility = 'hidden';
        return;
    }

    // Populate sidebar user info
    const name = user.firstName || user.first_name || 'Admin';
    _el('sAvatar').textContent = name.charAt(0).toUpperCase();
    _el('sName').textContent = name;
    _el('dashDate').textContent = new Date().toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
})();


// ══════════════════════════════════════════════════════════════════════════════
// § CACHE  —  in-memory TTL store (mirrors worker Cache pattern)
// ══════════════════════════════════════════════════════════════════════════════

const Cache = {
    _s: {},
    /** @param {string} k @param {*} d @param {number} ttl ms */
    set(k, d, ttl = 30_000) { this._s[k] = { d, exp: Date.now() + ttl }; },
    /** @returns {*|null} */
    get(k) { const e = this._s[k]; return e && e.exp > Date.now() ? e.d : null; },
    del(k) { delete this._s[k]; },
    /** @param {...string} keys */
    bust(...keys) { keys.forEach(k => this.del(k)); },
};


// ══════════════════════════════════════════════════════════════════════════════
// § API  —  single authenticated fetch wrapper
// All requests route through HeelsUpAuth.api which attaches Bearer token
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function api(path, opts = {}) {
    return HeelsUpAuth.api(path, opts);
}


// ══════════════════════════════════════════════════════════════════════════════
// § PROGRESS BAR
// ══════════════════════════════════════════════════════════════════════════════

const Prog = {
    _el: document.getElementById('nprogress'),
    start() { this._el.style.width = '30%'; this._el.style.opacity = '1'; },
    set(v) { this._el.style.width = v + '%'; },
    done() {
        this._el.style.width = '100%';
        setTimeout(() => {
            this._el.style.opacity = '0';
            setTimeout(() => { this._el.style.width = '0'; this._el.style.opacity = '1'; }, 300);
        }, 200);
    },
};


// ══════════════════════════════════════════════════════════════════════════════
// § UTILS  —  DOM helpers, formatters, badge builders
// ══════════════════════════════════════════════════════════════════════════════

/** @param {string} id @returns {HTMLElement} */
const _el = id => document.getElementById(id);

/**
 * HTML-escape — mirrors esc() in worker formatOrder()
 * Prevents XSS in all rendered strings
 * @param {*} s
 * @returns {string}
 */
const esc = s =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/** Format INR amount (amounts are in paise in DB, displayed as ₹) */
const fmtRs = v => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const fmtNum = v => (Number(v) || 0).toLocaleString('en-IN');

/**
 * @param {string|null} d
 * @param {boolean} [short=false]
 */
const fmtDate = (d, short = false) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', short
        ? { day: '2-digit', month: 'short', year: 'numeric' }
        : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmt = d => fmtDate(d, true);

/**
 * Detect Razorpay order — mirrors isRazorpayOrder() in worker
 * Razorpay orders have immutable payment_status (security critical)
 * @param {Object} o order object
 * @returns {boolean}
 */
const isRazorpayOrder = o => !!(o.razorpay_payment_id || o.razorpay_order_id);

// ── Badge Builders ────────────────────────────────────────────────────────────

function statusBadge(s) {
    s = (s || 'placed').toLowerCase();
    const labels = {
        placed: 'Placed', confirmed: 'Confirmed', processing: 'Processing',
        shipped: 'Shipped', out_for_delivery: 'Out for Delivery',
        delivered: 'Delivered', cancelled: 'Cancelled',
        exchange_requested: 'Exch Requested', exchange_approved: 'Exch Approved',
        exchange_rejected: 'Exch Rejected', payment_pending: 'Pmt Pending',
    };
    return `<span class="badge badge-${s.replace(/\s+/g, '_')}">${esc(labels[s] || s)}</span>`;
}

function payBadge(s) {
    s = (s || 'pending').toLowerCase();
    if (s === 'paid' || s === 'success')
        return `<span class="badge badge-paid"><i class="fa-solid fa-circle-check" style="font-size:.6rem"></i> Paid</span>`;
    if (s === 'failed')
        return `<span class="badge badge-failed"><i class="fa-solid fa-circle-xmark" style="font-size:.6rem"></i> Failed</span>`;
    if (s === 'refunded')
        return `<span class="badge badge-refunded"><i class="fa-solid fa-rotate-left" style="font-size:.6rem"></i> Refunded</span>`;
    return `<span class="badge badge-pending"><i class="fa-regular fa-clock" style="font-size:.6rem"></i> Pending</span>`;
}

/**
 * methodBadge — Razorpay badge shows lock icon (mirrors worker's isRazorpay check)
 */
function methodBadge(m) {
    if (!m) return '—';
    m = m.toLowerCase();
    if (m === 'razorpay' || m === 'upi' || m === 'card')
        return `<span class="badge badge-razorpay"><i class="fa-solid fa-lock" style="font-size:.6rem"></i> Razorpay</span>`;
    if (m === 'cod') return `<span class="badge badge-cod">COD</span>`;
    return `<span class="badge badge-locked">${esc(m)}</span>`;
}

// ── Counter Animation ─────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} el
 * @param {number} target
 * @param {string} [prefix='']
 */
function animateCount(el, target, prefix = '') {
    if (!el) return;
    const dur = 700, step = 16, steps = dur / step;
    let n = 0;
    const tick = setInterval(() => {
        n++;
        el.textContent = prefix + Math.round(target * (n / steps)).toLocaleString('en-IN');
        if (n >= steps) {
            el.textContent = prefix + target.toLocaleString('en-IN');
            clearInterval(tick);
        }
    }, step);
}


// ══════════════════════════════════════════════════════════════════════════════
// § TOAST
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} msg
 * @param {'success'|'error'|'info'|'warning'} [type='success']
 */
function toast(msg, type = 'success') {
    const wrap = _el('toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icons = { error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation', success: 'fa-circle-check' };
    t.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i><span>${esc(msg)}</span><span class="toast-close" onclick="this.parentNode.remove()">✕</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
        t.style.cssText += 'opacity:0;transform:translateX(30px);transition:all .3s';
        setTimeout(() => t.remove(), 300);
    }, 4500);
}


// ══════════════════════════════════════════════════════════════════════════════
// § NAV  —  section router
// ══════════════════════════════════════════════════════════════════════════════

const SEC_TITLES = {
    dashboard: 'Dashboard', products: 'Products',
    orders: 'Orders', customers: 'Customers',
    coupons: 'Coupons', reviews: 'Reviews',
};
let currentSec = 'dashboard';

/** @param {HTMLElement} el nav-item element with data-sec attribute */
function navTo(el) {
    if (!el?.dataset?.sec) return;
    const sec = el.dataset.sec;
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    _el('sec-' + sec).classList.add('active');
    el.classList.add('active');
    _el('topbarTitle').textContent = SEC_TITLES[sec] || sec;
    currentSec = sec;
    closeSidebar();
    const loaders = {
        products: loadProducts,
        orders: () => loadOrders(false),
        customers: loadCustomers,
        coupons: loadCoupons,
        reviews: loadReviews,
    };
    loaders[sec]?.();
}

function toggleSidebar() {
    _el('sidebar').classList.toggle('open');
    _el('mobOverlay').style.display = _el('sidebar').classList.contains('open') ? 'block' : 'none';
}
function closeSidebar() {
    _el('sidebar').classList.remove('open');
    _el('mobOverlay').style.display = 'none';
}

function doLogout() {
    if (!confirm('Logout?')) return;
    try { HeelsUpAuth.clearSession(); } catch (_) { }
    window.location = 'login.html';
}

function refreshCurrent() {
    Cache.bust('dashboard', 'products', 'orders', 'customers', 'coupons');
    const map = {
        dashboard: loadDashboard,
        products: () => { allProducts = []; loadProducts(); },
        orders: () => loadOrders(true),
        customers: () => { allCustomers = []; loadCustomers(); },
        coupons: loadCoupons,
        reviews: loadReviews,
    };
    map[currentSec]?.();
    toast('Refreshed!', 'info');
}


// ══════════════════════════════════════════════════════════════════════════════
// § DATE FILTER  —  dashboard period selector
// ══════════════════════════════════════════════════════════════════════════════

let currentDays = 30, customFrom = null, customTo = null;

/** @param {number} d @param {HTMLElement} btn */
function setDays(d, btn) {
    currentDays = d; customFrom = null; customTo = null;
    document.querySelectorAll('.df-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Cache.bust('dashboard');
    loadDashboard();
}

function applyCustomRange() {
    const from = _el('dfFrom').value, to = _el('dfTo').value;
    if (!from || !to) { toast('Select both From and To dates', 'warning'); return; }
    if (new Date(from) > new Date(to)) { toast('From must be before To', 'error'); return; }
    customFrom = from; customTo = to; currentDays = 0;
    document.querySelectorAll('.df-btn').forEach(b => b.classList.remove('active'));
    Cache.bust('dashboard');
    loadDashboard();
}

/** @returns {{ from: string, to: string }} ISO date strings */
function getDateRange() {
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    const to = new Date(), from = new Date();
    from.setDate(from.getDate() - currentDays);
    return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] };
}


// ══════════════════════════════════════════════════════════════════════════════
// § DASHBOARD
// Fetches /api/admin/dashboard — renders stats, order pipeline, recent lists
// ══════════════════════════════════════════════════════════════════════════════

async function loadDashboard() {
    Prog.start();
    let dash = Cache.get('dashboard');
    if (!dash) {
        try {
            const { from, to } = getDateRange();
            dash = await api(`/api/admin/dashboard?from=${from}&to=${to}`);
            Cache.set('dashboard', dash, 20_000);
        } catch (e) {
            renderStatsError();
            Prog.done();
            return;
        }
    }
    Prog.set(70);
    renderStats(dash);
    renderPipeline(dash);
    renderDashOrders(dash.recentOrders || []);
    renderDashProducts(dash.topProducts || []);
    if ((dash.pendingOrders || 0) > 0) {
        _el('ordersBadge').textContent = dash.pendingOrders;
        _el('ordersBadge').style.display = '';
    }
    Prog.done();
}

function renderStats(dash) {
    const grid = _el('statsGrid');
    const stats = [
        { icon: 'fa-box', cls: 'si-orange', label: 'Products', val: dash.totalProducts || 0, sub: 'In catalogue', prefix: '' },
        { icon: 'fa-bag-shopping', cls: 'si-blue', label: 'Orders', val: dash.totalOrders || 0, sub: 'All time', prefix: '' },
        { icon: 'fa-indian-rupee-sign', cls: 'si-green', label: 'Revenue', val: dash.totalRevenue || 0, sub: 'Total collected', prefix: '₹' },
        { icon: 'fa-clock-rotate-left', cls: 'si-rose', label: 'Pending', val: dash.pendingOrders || 0, sub: 'Need action', prefix: '' },
    ];

    grid.innerHTML = stats.map((s, i) => `
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon ${s.cls}"><i class="fa-solid ${s.icon}"></i></div>
      </div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-value" id="sv-${i}">—</div>
      <div class="stat-sub">${s.sub}</div>
    </div>`).join('');

    stats.forEach((s, i) => animateCount(_el('sv-' + i), s.val, s.prefix));
}

function renderStatsError() {
    _el('statsGrid').innerHTML = `
    <div class="stat-card" style="grid-column:1/-1">
      <div class="error-state">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>Failed to load dashboard. Check API connection.</span>
        <button style="margin-left:auto;padding:4px 10px;border-radius:6px;background:var(--danger);color:#fff;font-size:.72rem;font-weight:600;cursor:pointer;border:none"
          onclick="loadDashboard()">Retry</button>
      </div>
    </div>`;
}

/** Renders order pipeline bar + items grid */
function renderPipeline(dash) {
    const STAGES = [
        { key: 'placed', label: 'Placed', clr: '#3b82f6' },
        { key: 'confirmed', label: 'Confirmed', clr: '#8b5cf6' },
        { key: 'shipped', label: 'Dispatched', clr: '#06b6d4' },
        { key: 'delivered', label: 'Delivered', clr: '#22c55e' },
        { key: 'cancelled', label: 'Cancelled', clr: '#f43f5e' },
        { key: 'exchange_requested', label: 'Exchange', clr: '#f59e0b' },
    ];

    const counts = dash.ordersByStatus || {};
    const total = STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0);

    _el('pipelineTotal').textContent = `${total} Total Orders`;

    _el('pipelineStrip').innerHTML = STAGES.map(st => {
        const pct = total ? (counts[st.key] || 0) / total * 100 : 0;
        return `<div class="ps-seg" style="flex:${Math.max(pct, 0.5)};background:${st.clr}" title="${st.label}: ${counts[st.key] || 0}"></div>`;
    }).join('');

    _el('pipelineItems').innerHTML = STAGES.map(st => {
        const cnt = counts[st.key] || 0;
        const pct = total ? Math.round(cnt / total * 100) : 0;
        return `
      <div class="pi-item"
        onclick="navTo(document.querySelector('[data-sec=orders]'));setTimeout(()=>setOrderTabByKey('${st.key}'),200)"
        title="Filter: ${st.label}">
        <div class="pi-dot" style="background:${st.clr}"></div>
        <div class="pi-val" style="color:${st.clr}" id="pip-${st.key}">—</div>
        <div class="pi-lbl">${st.label}</div>
        <div class="pi-pct">${pct}% of total</div>
      </div>`;
    }).join('');

    STAGES.forEach(st => animateCount(_el('pip-' + st.key), counts[st.key] || 0));
}

function renderDashOrders(orders) {
    const el = _el('dashOrders');
    if (!orders.length) {
        el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bag-shopping"></i><p>No orders yet.</p></div>';
        return;
    }
    el.innerHTML = `
    <div class="tbl-scroll">
      <table style="min-width:500px">
        <thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${orders.slice(0, 8).map(o => `
            <tr style="cursor:pointer"
              onclick="navTo(document.querySelector('[data-sec=orders]'));setTimeout(()=>openOrderModal(${o.id}),300)">
              <td><span style="font-family:monospace;font-size:.78rem;background:#F1F5F9;padding:2px 6px;border-radius:4px">${esc(o.order_number || '—')}</span></td>
              <td>
                <div class="td-name">${esc(o.customer_name || '—')}</div>
                <div class="td-sub">${esc(o.customer_email || '')}</div>
              </td>
              <td><strong>${fmtRs(o.total_amount || 0)}</strong></td>
              <td>${statusBadge(o.order_status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderDashProducts(prods) {
    const el = _el('dashProducts');
    if (!prods.length) {
        el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>No products yet.</p></div>';
        return;
    }
    el.innerHTML = `
    <div class="tbl-scroll">
      <table style="min-width:400px">
        <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
        <tbody>
          ${prods.slice(0, 8).map(p => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  ${p.image_url ? `<img src="${esc(p.image_url)}" class="tbl-img" onerror="this.style.display='none'">` : ''}
                  <div>
                    <div class="td-name">${esc(p.name)}</div>
                    <div class="td-sub">${esc(p.category || '')}</div>
                  </div>
                </div>
              </td>
              <td>${fmtRs(p.price || 0)}</td>
              <td>
                <span style="font-weight:700;color:${(p.stock || 0) <= 5 ? 'var(--danger)' : (p.stock || 0) <= 15 ? 'var(--gold)' : 'var(--teal)'}">
                  ${p.stock || 0}
                </span>
              </td>
              <td>${p.active
            ? '<span class="badge badge-active">Active</span>'
            : '<span class="badge badge-inactive">Inactive</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}


// ══════════════════════════════════════════════════════════════════════════════
// § ORDERS  —  mirrors all handleAdmin* functions from orders.js
// ══════════════════════════════════════════════════════════════════════════════

/** Shared orders state — used by both dashboard widget + full orders section */
let allOrders = [];
let filteredOrders = [];
let orderActiveTab = 'all';
let orderCurrentPg = 1;
let currentOrderData = null;

const ORDER_PAGE_SIZE = 20;

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Fetches GET /api/admin/orders
 * @param {boolean} [forceRefresh=false]
 */
async function loadOrders(forceRefresh = false) {
    if (forceRefresh) Cache.bust('orders');

    const btn = _el('ordersRefreshBtn');
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true; }
    _el('ordersHeroSub').textContent = 'Fetching orders…';

    const cached = Cache.get('orders');
    if (cached) {
        allOrders = cached;
        syncOrdersUI();
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh'; btn.disabled = false; }
        return;
    }

    try {
        const t0 = performance.now();
        const res = await api('/api/admin/orders');
        const ms = (performance.now() - t0).toFixed(0);
        allOrders = Array.isArray(res) ? res : (res.orders || []);
        allOrders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        Cache.set('orders', allOrders, 30_000);
        syncOrdersUI();
        _el('ordersHeroSub').textContent = `${fmtNum(allOrders.length)} total orders · loaded in ${ms}ms`;
        toast(`${allOrders.length} orders loaded in ${ms}ms`);
    } catch (e) {
        toast('Failed to load orders: ' + (e.message || 'Network error'), 'error');
        _el('ordersTbody').innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);opacity:1"></i>
          <p style="color:var(--danger)">Failed to load.
            <button class="btn btn-sm btn-outline" onclick="loadOrders(true)" style="margin-left:8px">Retry</button>
          </p>
        </div>
      </td></tr>`;
    } finally {
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh'; btn.disabled = false; }
    }
}

/** Sync all orders UI elements after data load */
function syncOrdersUI() {
    updateOrderKPIs();
    updateOrderTabCounts();
    applyOrderFilters();

    const unfulfilled = allOrders.filter(o =>
        ['placed', 'confirmed', 'processing'].includes((o.order_status || '').toLowerCase())
    ).length;
    if (unfulfilled > 0) {
        _el('ordersBadge').textContent = unfulfilled;
        _el('ordersBadge').style.display = '';
    }
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

function updateOrderKPIs() {
    const delivered = allOrders.filter(o => o.order_status === 'delivered').length;
    const unfulfilled = allOrders.filter(o =>
        ['placed', 'confirmed', 'processing'].includes((o.order_status || '').toLowerCase())
    ).length;
    const cancelled = allOrders.filter(o => o.order_status === 'cancelled').length;
    const revenue = allOrders
        .filter(o => o.payment_status === 'paid' || o.payment_status === 'success')
        .reduce((s, o) => s + Number(o.total_amount || 0), 0);

    _el('oKpiTotal').textContent = fmtNum(allOrders.length);
    _el('oKpiDelivered').textContent = fmtNum(delivered);
    _el('oKpiUnfulfilled').textContent = fmtNum(unfulfilled);
    _el('oKpiCancelled').textContent = fmtNum(cancelled);
    _el('oKpiRevenue').textContent = fmtRs(revenue);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function updateOrderTabCounts() {
    const counts = {
        all: 0, unfulfilled: 0, payment_pending: 0,
        placed: 0, confirmed: 0, shipped: 0,
        out_for_delivery: 0, delivered: 0, cancelled: 0, exchange: 0,
    };
    allOrders.forEach(o => {
        const s = (o.order_status || '').toLowerCase();
        const ps = (o.payment_status || '').toLowerCase();
        counts.all++;
        if (['placed', 'confirmed', 'processing'].includes(s)) counts.unfulfilled++;
        if (ps === 'pending' && s !== 'cancelled') counts.payment_pending++;
        if (counts[s] !== undefined) counts[s]++;
        if (s.includes('exchange')) counts.exchange++;
    });

    const map = {
        all: 'otcAll', unfulfilled: 'otcUnfulfilled', payment_pending: 'otcPending',
        placed: 'otcPlaced', confirmed: 'otcConfirmed', shipped: 'otcShipped',
        out_for_delivery: 'otcOfd', delivered: 'otcDelivered',
        cancelled: 'otcCancelled', exchange: 'otcExchange',
    };
    Object.entries(map).forEach(([k, id]) => {
        const el = _el(id);
        if (el) el.textContent = fmtNum(counts[k] || 0);
    });
}

/**
 * @param {string} tab
 * @param {HTMLElement} btn
 */
function setOrderTab(tab, btn) {
    orderActiveTab = tab;
    document.querySelectorAll('#ordersTabStrip .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    orderCurrentPg = 1;
    applyOrderFilters();
}

/** Navigate to a tab by status key (used from pipeline click) */
function setOrderTabByKey(key) {
    const tabKeys = ['all', 'unfulfilled', 'payment_pending', 'placed', 'confirmed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'exchange'];
    const k = key.includes('exchange') ? 'exchange' : key;
    const idx = tabKeys.indexOf(k);
    const btns = document.querySelectorAll('#ordersTabStrip .tab-btn');
    if (idx >= 0 && btns[idx]) {
        orderActiveTab = k;
        btns.forEach(b => b.classList.remove('active'));
        btns[idx].classList.add('active');
        applyOrderFilters();
    }
}

// ── Filters ───────────────────────────────────────────────────────────────────

function applyOrderFilters() {
    const q = (_el('ordersSearch') || {}).value?.toLowerCase() || '';
    const payF = (_el('oPayFilter') || {}).value || '';
    const methodF = (_el('oMethodFilter') || {}).value || '';
    const sourceF = (_el('oSourceFilter') || {}).value || '';
    const dateFrom = _el('oDateFrom')?.value ? new Date(_el('oDateFrom').value) : null;
    const dateTo = _el('oDateTo')?.value ? new Date(_el('oDateTo').value + 'T23:59:59') : null;

    filteredOrders = allOrders.filter(o => {
        const s = (o.order_status || 'placed').toLowerCase();
        const ps = (o.payment_status || 'pending').toLowerCase();
        const m = (o.payment_method || '').toLowerCase();
        const src = (o.source || 'online').toLowerCase();
        const created = o.created_at ? new Date(o.created_at) : null;

        let tabOk = true;
        if (orderActiveTab === 'unfulfilled') tabOk = ['placed', 'confirmed', 'processing'].includes(s);
        else if (orderActiveTab === 'payment_pending') tabOk = ps === 'pending' && s !== 'cancelled';
        else if (orderActiveTab === 'exchange') tabOk = s.includes('exchange');
        else if (orderActiveTab !== 'all') tabOk = s === orderActiveTab;

        const matchQ = !q || [o.order_number, o.customer_name, o.customer_email, o.customer_phone, String(o.id)]
            .some(v => (v || '').toLowerCase().includes(q));
        const matchPay = !payF || (payF === 'paid' ? (ps === 'paid' || ps === 'success') : ps === payF);
        const matchMethod = !methodF || m.includes(methodF);
        const matchSource = !sourceF || src === sourceF;
        const matchDate = (!dateFrom || !created || created >= dateFrom)
            && (!dateTo || !created || created <= dateTo);

        return tabOk && matchQ && matchPay && matchMethod && matchSource && matchDate;
    });

    orderCurrentPg = 1;
    renderOrdersTable();
}

function clearOrderFilters() {
    ['ordersSearch', 'oPayFilter', 'oMethodFilter', 'oSourceFilter', 'oDateFrom', 'oDateTo']
        .forEach(id => { const el = _el(id); if (el) el.value = ''; });
    orderActiveTab = 'all';
    document.querySelectorAll('#ordersTabStrip .tab-btn').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
    });
    orderCurrentPg = 1;
    applyOrderFilters();
}

// ── Table Render ──────────────────────────────────────────────────────────────

function renderOrdersTable() {
    const tbody = _el('ordersTbody');
    const pgInfo = _el('ordersPgInfo');
    const pgEl = _el('ordersPagination');
    const start = (orderCurrentPg - 1) * ORDER_PAGE_SIZE;
    const page = filteredOrders.slice(start, start + ORDER_PAGE_SIZE);

    if (!filteredOrders.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-bag-shopping"></i><p>No orders match your filters</p></div></td></tr>`;
        pgInfo.textContent = 'Showing 0 orders';
        pgEl.innerHTML = '';
        return;
    }

    pgInfo.innerHTML = `Showing <strong>${start + 1}–${Math.min(start + ORDER_PAGE_SIZE, filteredOrders.length)}</strong> of <strong>${fmtNum(filteredOrders.length)}</strong> orders`;

    tbody.innerHTML = page.map(o => {
        const src = (o.source || 'online').toLowerCase();
        const srcBadge = src === 'pos'
            ? '<span class="source-badge source-pos">POS</span>'
            : '<span class="source-badge source-online">Online</span>';
        const razorLock = isRazorpayOrder(o)
            ? '<div class="td-sub"><i class="fa-solid fa-lock" style="color:var(--purple);font-size:.6rem"></i> Razorpay</div>'
            : '';
        return `
      <tr onclick="openOrderModal(${o.id})" style="cursor:pointer" title="View/Update Order">
        <td>
          <div class="td-name" style="color:var(--blue)">${esc(o.order_number || '#' + o.id)}</div>
          ${razorLock}
        </td>
        <td>
          <div class="td-name">${fmtDate(o.created_at, true)}</div>
          <div class="td-sub">${o.created_at ? new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
        </td>
        <td>
          <div class="td-name"><span class="truncate" title="${esc(o.customer_name || 'Guest')}">${esc(o.customer_name || 'Guest')}</span></div>
          <div class="td-sub">${esc(o.customer_phone || o.customer_email || '')}</div>
        </td>
        <td>
          <div class="td-name">${fmtRs(o.total_amount || 0)}</div>
          ${o.discount_amount > 0 ? `<div class="td-sub" style="color:var(--teal)">-${fmtRs(o.discount_amount)}</div>` : ''}
        </td>
        <td>
          ${payBadge(o.payment_status)}<br>
          <div class="td-sub" style="margin-top:3px">${methodBadge(o.payment_method)}</div>
        </td>
        <td>${srcBadge}</td>
        <td>${statusBadge(o.order_status)}</td>
        <td onclick="event.stopPropagation()">
          <button class="icon-btn" onclick="openOrderModal(${o.id})" title="View/Update">
            <i class="fa-regular fa-pen-to-square"></i>
          </button>
          <button class="icon-btn" onclick="printOrderInvoiceById(${o.id})" title="Print Invoice" style="margin-left:3px">
            <i class="fa-solid fa-print"></i>
          </button>
        </td>
      </tr>`;
    }).join('');

    renderOrderPagination(filteredOrders.length);
}

function renderOrderPagination(total) {
    const pages = Math.ceil(total / ORDER_PAGE_SIZE);
    const el = _el('ordersPagination');
    if (pages <= 1) { el.innerHTML = ''; return; }

    let html = `<button class="pg-btn" onclick="goOrderPage(${orderCurrentPg - 1})" ${orderCurrentPg <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left" style="font-size:.7rem"></i></button>`;
    const s = Math.max(1, orderCurrentPg - 2), e = Math.min(pages, orderCurrentPg + 2);
    if (s > 1) { html += `<button class="pg-btn" onclick="goOrderPage(1)">1</button>`; if (s > 2) html += `<span style="padding:0 4px;color:var(--muted)">…</span>`; }
    for (let i = s; i <= e; i++) html += `<button class="pg-btn ${i === orderCurrentPg ? 'active' : ''}" onclick="goOrderPage(${i})">${i}</button>`;
    if (e < pages) { if (e < pages - 1) html += `<span style="padding:0 4px;color:var(--muted)">…</span>`; html += `<button class="pg-btn" onclick="goOrderPage(${pages})">${pages}</button>`; }
    html += `<button class="pg-btn" onclick="goOrderPage(${orderCurrentPg + 1})" ${orderCurrentPg >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right" style="font-size:.7rem"></i></button>`;
    el.innerHTML = html;
}

/** @param {number} p */
function goOrderPage(p) { orderCurrentPg = p; renderOrdersTable(); window.scrollTo(0, 0); }

// ── Order Detail Modal ────────────────────────────────────────────────────────

/** @param {number} id */
function openOrderModal(id) {
    const o = allOrders.find(x => x.id === id);
    if (!o) return;
    currentOrderData = o;
    _el('orderModalTitle').textContent = `Order: ${o.order_number || '#' + o.id}`;
    _el('orderModalSubtitle').innerHTML = `${fmtDate(o.created_at)} &nbsp;·&nbsp; ${esc(o.customer_name || 'Guest')} &nbsp;·&nbsp; ${fmtRs(o.total_amount || 0)}`;
    _el('orderModalBody').innerHTML = buildOrderModalBody(o, isRazorpayOrder(o));

    const isFinal = ['delivered', 'cancelled', 'exchange_approved', 'exchange_rejected']
        .includes((o.order_status || '').toLowerCase());
    _el('btnSaveOrder').style.display = isFinal ? 'none' : '';
    _el('orderDetailModal').classList.add('show');
}

function closeOrderModal() { _el('orderDetailModal').classList.remove('show'); currentOrderData = null; }

/**
 * Builds full order modal HTML
 * Razorpay payment_status field is always readonly (security: mirrors worker guard)
 * @param {Object} o
 * @param {boolean} razorpayLocked
 * @returns {string}
 */
function buildOrderModalBody(o, razorpayLocked) {
    const s = (o.order_status || 'placed').toLowerCase();
    const items = Array.isArray(o.items) || Array.isArray(o.order_items)
        ? (o.items || o.order_items)
        : [];

    return `
    <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:16px;margin-bottom:14px">
      <div class="detail-section">
        <div class="detail-section-title"><i class="fa-solid fa-route"></i> Order Timeline</div>
        <div class="timeline">${buildTimeline(o)}</div>
      </div>
      <div>
        <div class="detail-section" style="margin-bottom:10px">
          <div class="detail-section-title"><i class="fa-solid fa-user"></i> Customer</div>
          <div class="detail-grid">
            <div class="detail-item"><div class="detail-item-label">Name</div><div class="detail-item-val">${esc(o.customer_name || 'Guest')}</div></div>
            <div class="detail-item"><div class="detail-item-label">Phone</div><div class="detail-item-val">${esc(o.customer_phone || '—')}</div></div>
            <div class="detail-item" style="grid-column:1/-1"><div class="detail-item-label">Email</div><div class="detail-item-val">${esc(o.customer_email || '—')}</div></div>
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section-title"><i class="fa-solid fa-location-dot"></i> Shipping Address</div>
          <div style="font-size:.82rem;color:var(--text);line-height:1.6">
            ${esc(o.address_line1 || '')}${o.address_line2 ? ', ' + esc(o.address_line2) : ''}<br>
            ${[o.city, o.state, o.pincode].filter(Boolean).map(esc).join(', ')}<br>
            ${esc(o.country || 'India')}
          </div>
          ${o.delivery_method ? `<div style="margin-top:6px;font-size:.72rem;color:var(--muted)"><i class="fa-solid fa-truck"></i> ${esc(o.delivery_method)}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <i class="fa-solid fa-credit-card"></i> Payment Details
        ${razorpayLocked ? '<span class="razorpay-locked-notice"><i class="fa-solid fa-lock"></i> Razorpay Verified — Cannot Edit</span>' : ''}
      </div>
      <div class="detail-grid three">
        <div class="detail-item"><div class="detail-item-label">Method</div><div class="detail-item-val">${methodBadge(o.payment_method)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Status</div><div class="detail-item-val">${payBadge(o.payment_status)}</div></div>
        <div class="detail-item"><div class="detail-item-label">Paid At</div><div class="detail-item-val">${fmtDate(o.paid_at, true)}</div></div>
        ${o.razorpay_order_id ? `<div class="detail-item"><div class="detail-item-label">RZP Order ID</div><div class="detail-item-val razorpay-id">${esc(o.razorpay_order_id)}</div></div>` : ''}
        ${o.razorpay_payment_id ? `<div class="detail-item"><div class="detail-item-label">RZP Payment ID</div><div class="detail-item-val razorpay-id">${esc(o.razorpay_payment_id)}</div></div>` : ''}
      </div>
    </div>

    ${items.length ? `
    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-box"></i> Order Items (${items.length})</div>
      <table class="items-table">
        <thead><tr><th>Product</th><th>Size/Variant</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td><div style="font-weight:600">${esc(it.product_name || it.name || 'Product')}</div>${it.sku ? `<div style="font-size:.7rem;color:var(--muted)">${esc(it.sku)}</div>` : ''}</td>
              <td>${esc(it.size || it.variant || '—')}</td>
              <td>${esc(it.quantity || 1)}</td>
              <td>${fmtRs(it.price || it.unit_price || 0)}</td>
              <td style="font-weight:700">${fmtRs((it.quantity || 1) * (it.price || it.unit_price || 0))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-section-title"><i class="fa-solid fa-indian-rupee-sign"></i> Amount Breakdown</div>
      <div class="amounts-grid">
        <div class="amount-row"><span>Subtotal</span><strong>${fmtRs(o.subtotal_amount || 0)}</strong></div>
        <div class="amount-row"><span>Shipping</span><strong>${fmtRs(o.shipping_amount || 0)}</strong></div>
        ${o.tax_amount ? `<div class="amount-row"><span>Tax (GST)</span><strong>${fmtRs(o.tax_amount)}</strong></div>` : ''}
        ${o.discount_amount > 0 ? `<div class="amount-row discount"><span>Discount ${o.coupon_code ? `<span class="badge badge-confirmed" style="margin-left:4px">${esc(o.coupon_code)}</span>` : ''}</span><strong>-${fmtRs(o.discount_amount)}</strong></div>` : ''}
        <div class="amount-row total" style="grid-column:1/-1"><span>Total</span><strong>${fmtRs(o.total_amount || 0)}</strong></div>
      </div>
    </div>

    ${!['delivered', 'cancelled', 'exchange_approved', 'exchange_rejected'].includes(s) ? `
      <div class="divider-label"><i class="fa-solid fa-pen-to-square" style="color:var(--primary)"></i> Update Order</div>
      ${razorpayLocked ? `
        <div class="warning-box">
          <i class="fa-solid fa-lock" style="color:#6D28D9;margin-top:1px"></i>
          <div>This order was paid via <strong>Razorpay</strong>. Payment status is <strong>locked</strong> to preserve payment integrity.</div>
        </div>` : ''}
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Order Status</label>
          <select class="form-select" id="updateStatus">
            ${['placed', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled']
                .map(st => `<option value="${st}" ${s === st ? 'selected' : ''}>${st.charAt(0).toUpperCase() + st.slice(1).replace(/_/g, ' ')}</option>`)
                .join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Payment Status ${razorpayLocked ? '<span class="razorpay-locked-notice"><i class="fa-solid fa-lock"></i> Locked</span>' : ''}</label>
          <input type="text"
            class="form-input ${razorpayLocked ? 'locked' : ''}"
            value="${esc(o.payment_status || 'pending')}"
            ${razorpayLocked ? 'readonly title="Cannot modify Razorpay payment status"' : ''}
            id="updatePayStatus">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label">Tracking Number</label>
          <input type="text" class="form-input" id="updateTracking" value="${esc(o.tracking_number || '')}" placeholder="AWB / Tracking ID">
        </div>
        <div class="form-field">
          <label class="form-label">Tracking URL</label>
          <input type="text" class="form-input" id="updateTrackingUrl" value="${esc(o.tracking_url || '')}" placeholder="https://track.shiprocket.in/…">
        </div>
      </div>
      <div class="form-row single">
        <div class="form-field">
          <label class="form-label">Admin Note (internal)</label>
          <input type="text" class="form-input" id="updateNote" placeholder="e.g. called customer, package delayed…">
        </div>
      </div>`
            : `<div class="detail-section" style="background:#F0FDF4;border-color:#BBF7D0">
        <div style="font-size:.82rem;color:#065F46;display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-circle-check"></i>
          This order is in <strong>${s}</strong> state — no further status updates possible.
        </div>
      </div>`}

    ${s === 'exchange_requested' ? `
      <div class="exchange-section">
        <div class="exchange-section-title"><i class="fa-solid fa-arrows-rotate"></i> Exchange Request</div>
        <div class="detail-grid" style="margin-bottom:12px">
          <div class="detail-item"><div class="detail-item-label">Reason</div><div class="detail-item-val">${esc(o.exchange_reason || '—')}</div></div>
          <div class="detail-item"><div class="detail-item-label">Exchange For</div><div class="detail-item-val">${esc(o.exchange_product || '—')}</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-teal"   onclick="updateExchange(${o.id},'exchange_approved')"><i class="fa-solid fa-check"></i> Approve</button>
          <button class="btn btn-sm btn-danger"  onclick="updateExchange(${o.id},'exchange_rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
        </div>
      </div>` : ''}
  `;
}

/**
 * Builds timeline HTML for order modal
 * Mirrors VALID_TRANSITIONS logic from handleAdminUpdateStatus
 * @param {Object} o
 * @returns {string}
 */
function buildTimeline(o) {
    const s = (o.order_status || 'placed').toLowerCase();
    if (s === 'cancelled')
        return `<div class="tl-item"><div class="tl-dot error"><i class="fa-solid fa-ban"></i></div><div class="tl-content"><div class="tl-title">Order Cancelled</div><div class="tl-time">${fmtDate(o.cancelled_at, true)}</div></div></div>`;
    if (s.includes('exchange'))
        return `<div class="tl-item"><div class="tl-dot active"><i class="fa-solid fa-arrows-rotate"></i></div><div class="tl-content"><div class="tl-title">Exchange ${s.includes('approved') ? 'Approved' : s.includes('rejected') ? 'Rejected' : 'Requested'}</div></div></div>`;

    const stages = [
        { key: 'placed', icon: 'fa-bag-shopping', label: 'Order Placed', time: o.created_at, done: true },
        { key: 'confirmed', icon: 'fa-circle-check', label: 'Confirmed', time: o.confirmed_at || null, done: ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'].includes(s) },
        { key: 'shipped', icon: 'fa-truck', label: 'Shipped', time: o.shipped_at || null, done: ['shipped', 'out_for_delivery', 'delivered'].includes(s) },
        { key: 'out_for_delivery', icon: 'fa-motorcycle', label: 'Out for Delivery', time: null, done: ['out_for_delivery', 'delivered'].includes(s) },
        { key: 'delivered', icon: 'fa-house-circle-check', label: 'Delivered', time: o.delivered_at || null, done: s === 'delivered' },
    ];

    return stages.map(st => {
        const isActive = st.key === s;
        const cls = st.done ? (isActive ? 'active' : 'done') : 'pending';
        return `
      <div class="tl-item">
        <div class="tl-dot ${cls}"><i class="fa-solid ${st.icon}"></i></div>
        <div class="tl-content">
          <div class="tl-title" style="${!st.done ? 'color:var(--muted)' : ''}">${st.label}</div>
          ${st.time ? `<div class="tl-time">${fmtDate(st.time)}</div>`
                : st.done ? '<div class="tl-time" style="color:var(--teal)">✓</div>'
                    : ''}
        </div>
      </div>`;
    }).join('');
}

// ── Save Order Update ─────────────────────────────────────────────────────────
// Mirrors handleAdminUpdateStatus: Razorpay payment_status is NEVER sent

async function saveOrderUpdate() {
    if (!currentOrderData) return;
    const id = currentOrderData.id;
    const statusEl = _el('updateStatus');
    const payEl = _el('updatePayStatus');
    const trackEl = _el('updateTracking');
    const urlEl = _el('updateTrackingUrl');
    if (!statusEl) return;

    const btn = _el('btnSaveOrder');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    try {
        // Build payload — never include payment_status for Razorpay orders
        const payload = {
            status: statusEl.value,
            tracking_number: trackEl.value.trim() || null,
            tracking_url: urlEl.value.trim() || null,
        };
        // Only non-Razorpay orders allow admin to set payment_status
        if (!isRazorpayOrder(currentOrderData)) {
            payload.payment_status = payEl.value;
        }

        await api(`/api/admin/orders/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });

        // Optimistic update in shared allOrders state
        const idx = allOrders.findIndex(x => x.id === id);
        if (idx > -1) {
            allOrders[idx].order_status = payload.status;
            allOrders[idx].tracking_number = payload.tracking_number;
            allOrders[idx].tracking_url = payload.tracking_url;
            if (!isRazorpayOrder(currentOrderData)) allOrders[idx].payment_status = payload.payment_status;
        }

        Cache.bust('orders');
        toast('Order updated successfully');
        closeOrderModal();
        updateOrderKPIs();
        updateOrderTabCounts();
        applyOrderFilters();
    } catch (e) {
        toast('Update failed: ' + (e.message || 'Server error'), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Save Changes';
    }
}

/**
 * Approve or reject exchange — mirrors handleAdminExchange
 * @param {number} id
 * @param {'exchange_approved'|'exchange_rejected'} newStatus
 */
async function updateExchange(id, newStatus) {
    try {
        await api(`/api/admin/orders/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus }),
        });
        const idx = allOrders.findIndex(x => x.id === id);
        if (idx > -1) allOrders[idx].order_status = newStatus;
        Cache.bust('orders');
        toast(`Exchange ${newStatus === 'exchange_approved' ? 'approved' : 'rejected'} successfully`);
        closeOrderModal();
        updateOrderKPIs(); updateOrderTabCounts(); applyOrderFilters();
    } catch (e) {
        toast('Failed: ' + e.message, 'error');
    }
}

// ── Invoice Print ─────────────────────────────────────────────────────────────

function printOrderInvoice() { if (currentOrderData) printInvoiceData(currentOrderData); }
function printOrderInvoiceById(id) { const o = allOrders.find(x => x.id === id); if (o) { currentOrderData = o; printInvoiceData(o); } }

/** @param {Object} o */
function printInvoiceData(o) {
    const items = o.items || o.order_items || [];
    const win = window.open('', '_blank', 'width=800,height=700');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice — ${esc(o.order_number || '#' + o.id)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Open Sans',Arial,sans-serif;font-size:13px;color:#1E1E2C;padding:32px;background:#fff}.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #F29F67}.brand{font-size:1.8rem;font-weight:800;color:#F29F67}.brand small{display:block;font-size:.65rem;font-weight:400;color:#64748B;text-transform:uppercase;letter-spacing:.1em;margin-top:2px}.inv-meta{text-align:right}.inv-meta h2{font-size:1.1rem;font-weight:700;margin-bottom:4px}.inv-meta p{font-size:.78rem;color:#64748B;margin-bottom:2px}.inv-body{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.inv-sec h3{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94A3B8;margin-bottom:8px}.inv-sec p{font-size:.85rem;line-height:1.6}table{width:100%;border-collapse:collapse;margin-bottom:16px}thead th{text-align:left;padding:8px 10px;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748B;background:#F8FAFC;border-bottom:2px solid #E4E8F0}tbody td{padding:10px;font-size:.83rem;border-bottom:1px solid #F5F7FA}.totals{margin-left:auto;width:260px}.total-row{display:flex;justify-content:space-between;padding:5px 0;font-size:.83rem;border-bottom:1px solid #F5F7FA}.total-row.grand{font-weight:800;font-size:1rem;color:#F29F67;border-top:2px solid #F29F67;border-bottom:none;padding-top:8px;margin-top:4px}.footer{margin-top:32px;padding-top:16px;border-top:1px solid #E4E8F0;text-align:center;font-size:.72rem;color:#94A3B8}@media print{body{padding:16px}}</style>
</head><body>
<div class="inv-header"><div><div class="brand">HeelsUp<small>Ladies Footwear & Bags · Jodhpur, Rajasthan</small></div><div style="font-size:.75rem;color:#64748B;margin-top:8px">GSTIN: 08XXXXX0000X1Z5</div></div>
<div class="inv-meta"><h2>TAX INVOICE</h2><p><strong>${esc(o.order_number || '#' + o.id)}</strong></p><p>Date: ${fmtDate(o.created_at, true)}</p><p style="margin-top:6px"><strong>${(o.order_status || 'Placed').toUpperCase()}</strong></p></div></div>
<div class="inv-body">
<div class="inv-sec"><h3>Bill To</h3><p><strong>${esc(o.customer_name || 'Customer')}</strong><br>${esc(o.customer_email || '')}<br>${esc(o.customer_phone || '')}</p></div>
<div class="inv-sec"><h3>Ship To</h3><p>${esc(o.address_line1 || '')}${o.address_line2 ? ', ' + esc(o.address_line2) : ''}<br>${[o.city, o.state, o.pincode].filter(Boolean).map(esc).join(', ')}<br>${esc(o.country || 'India')}</p></div>
<div class="inv-sec"><h3>Payment</h3><p>Method: ${esc((o.payment_method || 'online').toUpperCase())}<br>Status: <strong>${esc((o.payment_status || 'pending').toUpperCase())}</strong>${o.paid_at ? '<br>Paid: ' + fmtDate(o.paid_at, true) : ''}</p>${o.razorpay_payment_id ? `<div style="font-size:.72rem;font-family:monospace;color:#7C3AED;background:#EDE9FE;padding:3px 7px;border-radius:4px;display:inline-block;margin-top:4px">RZP: ${esc(o.razorpay_payment_id)}</div>` : ''}</div>
<div class="inv-sec"><h3>Delivery</h3><p>Method: ${esc(o.delivery_method || 'Standard')}${o.tracking_number ? '<br>Tracking: ' + esc(o.tracking_number) : ''}</p></div>
</div>
<table><thead><tr><th>#</th><th>Product</th><th>Size</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>
${items.length ? items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name || it.name || 'Product')}${it.sku ? `<br><small style="color:#94A3B8">${esc(it.sku)}</small>` : ''}</td><td>${esc(it.size || it.variant || '—')}</td><td>${it.quantity || 1}</td><td>₹${Number(it.price || it.unit_price || 0).toLocaleString('en-IN')}</td><td><strong>₹${((it.quantity || 1) * (it.price || it.unit_price || 0)).toLocaleString('en-IN')}</strong></td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:#94A3B8;padding:20px">No item details available</td></tr>'}
</tbody></table>
<div class="totals">
<div class="total-row"><span>Subtotal</span><span>₹${Number(o.subtotal_amount || 0).toLocaleString('en-IN')}</span></div>
<div class="total-row"><span>Shipping</span><span>₹${Number(o.shipping_amount || 0).toLocaleString('en-IN')}</span></div>
${o.tax_amount ? `<div class="total-row"><span>GST</span><span>₹${Number(o.tax_amount).toLocaleString('en-IN')}</span></div>` : ''}
${o.discount_amount > 0 ? `<div class="total-row" style="color:#34B1AA"><span>Discount${o.coupon_code ? ' (' + esc(o.coupon_code) + ')' : ''}</span><span>-₹${Number(o.discount_amount).toLocaleString('en-IN')}</span></div>` : ''}
<div class="total-row grand"><span>TOTAL</span><span>₹${Number(o.total_amount || 0).toLocaleString('en-IN')}</span></div>
</div>
<div class="footer">Thank you for shopping with HeelsUp · heelsup.in · Jodhpur, Rajasthan<br>For queries: support@heelsup.in | Computer-generated invoice.</div>
<script>window.onload=function(){window.print();}<\/script></body></html>`);
    win.document.close();
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportOrdersCSV() {
    if (!filteredOrders.length) { toast('No orders to export', 'info'); return; }
    const headers = ['Order#', 'Date', 'Customer', 'Email', 'Phone', 'City', 'State', 'Pincode', 'Subtotal', 'Shipping', 'Discount', 'Tax', 'Total', 'Payment Method', 'Payment Status', 'Order Status', 'Razorpay Order ID', 'Razorpay Payment ID', 'Tracking#', 'Source', 'Coupon'];
    const rows = filteredOrders.map(o => [
        o.order_number || o.id, fmtDate(o.created_at, true), o.customer_name || '', o.customer_email || '', o.customer_phone || '',
        o.city || '', o.state || '', o.pincode || '',
        o.subtotal_amount || 0, o.shipping_amount || 0, o.discount_amount || 0, o.tax_amount || 0, o.total_amount || 0,
        o.payment_method || '', o.payment_status || '', o.order_status || '',
        o.razorpay_order_id || '', o.razorpay_payment_id || '',
        o.tracking_number || '', o.source || 'online', o.coupon_code || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`));

    const blob = new Blob([[headers.join(','), ...rows.map(r => r.join(','))].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `heelsup-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast(`Exported ${filteredOrders.length} orders`);
}


// ══════════════════════════════════════════════════════════════════════════════
// § PRODUCTS  —  mirrors /api/admin/products CRUD
// ══════════════════════════════════════════════════════════════════════════════

let allProducts = [];
let filteredProducts = [];
let pPg = 1;
let editingProductId = null;
const PAGE = 20;

async function loadProducts() {
    const cached = Cache.get('products');
    if (cached) { allProducts = cached; filterProducts(); return; }
    _el('productsTableBody').innerHTML = `<tr><td colspan="7"><div class="spinner-wrap"><i class="fa-solid fa-spinner"></i>Loading products…</div></td></tr>`;
    try {
        const data = await api('/api/admin/products');
        allProducts = data.products || [];
        Cache.set('products', allProducts, 60_000);
        filterProducts();
    } catch (e) {
        _el('productsTableBody').innerHTML = `<tr><td colspan="7"><div class="error-state" style="margin:8px"><i class="fa-solid fa-circle-exclamation"></i><span>Failed to load products</span><button style="margin-left:auto;padding:4px 10px;border-radius:6px;background:var(--danger);color:#fff;font-size:.72rem;font-weight:600;cursor:pointer;border:none" onclick="loadProducts()">Retry</button></div></td></tr>`;
    }
}

function filterProducts() {
    const q = (_el('productSearch').value || '').toLowerCase();
    const cat = _el('catFilter').value;
    const st = _el('statusFilter2').value;
    filteredProducts = allProducts.filter(p => {
        const mq = !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
        const mc = !cat || (p.category || '').toLowerCase() === cat.toLowerCase();
        const ms = st === '' || String(p.active ? 1 : 0) === st;
        return mq && mc && ms;
    });
    pPg = 1;
    renderProducts();
}

function renderProducts() {
    const start = (pPg - 1) * PAGE, page = filteredProducts.slice(start, start + PAGE);
    const tbody = _el('productsTableBody');
    if (!page.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-search"></i><p>No products found.</p></div></td></tr>';
        renderPagGen('productsPagination', 'productsPgInfo', filteredProducts.length, pPg, p => { pPg = p; renderProducts(); });
        return;
    }
    tbody.innerHTML = page.map(p => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          ${p.image_url ? `<img src="${esc(p.image_url)}" class="tbl-img" onerror="this.style.display='none'">` : '<div class="tbl-img" style="display:flex;align-items:center;justify-content:center;color:var(--muted)"><i class="fa-solid fa-image" style="font-size:.7rem"></i></div>'}
          <div><div class="td-name">${esc(p.name)}</div><div class="td-sub">SKU: ${esc(p.sku || '—')}</div></div>
        </div>
      </td>
      <td>${esc(p.category || '—')}</td>
      <td><strong>${fmtRs(p.price || 0)}</strong></td>
      <td>${p.original_price ? `<span style="text-decoration:line-through;color:var(--muted);font-size:.75rem">${fmtRs(p.original_price)}</span>` : '—'}</td>
      <td>
        <span style="font-weight:700;color:${(p.stock || 0) <= 5 ? 'var(--danger)' : (p.stock || 0) <= 15 ? 'var(--gold)' : 'var(--teal)'}">${p.stock || 0}</span>
        ${(p.stock || 0) <= 5 ? '<span class="badge badge-failed" style="margin-left:4px;font-size:.55rem">Low</span>' : ''}
      </td>
      <td>${p.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" onclick='editProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})' title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn del" onclick="deleteProduct(${p.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
    renderPagGen('productsPagination', 'productsPgInfo', filteredProducts.length, pPg, p => { pPg = p; renderProducts(); });
}

function openProductModal() {
    editingProductId = null;
    _el('productForm').reset();
    _el('productModalTitle').textContent = 'Add New Product';
    _el('chkActive').checked = true;
    _el('productFormError').style.display = 'none';
    _el('productModalBd').classList.add('show');
}

/** @param {Object} p product object */
function editProduct(p) {
    editingProductId = p.id;
    _el('productModalTitle').textContent = 'Edit Product';
    const f = _el('productForm');
    f.name.value = p.name || '';
    f.sku.value = p.sku || '';
    f.category.value = p.category || 'Heels';
    f.price.value = p.price || '';
    f.mrp.value = p.original_price || '';
    f.stock.value = p.stock || 0;
    f.description.value = p.description || '';
    f.image_url.value = p.image_url || '';
    const sizes = Array.isArray(p.sizes) ? p.sizes
        : (typeof p.sizes_json === 'string' ? JSON.parse(p.sizes_json || '[]') : []);
    f.sizes.value = sizes.join(',');
    f.featured.checked = !!p.featured;
    f.is_new.checked = !!p.is_new;
    f.active.checked = p.active !== false && p.active !== 0;
    _el('productFormError').style.display = 'none';
    _el('productModalBd').classList.add('show');
}

function closeProductModal() { _el('productModalBd').classList.remove('show'); editingProductId = null; }

/** @param {SubmitEvent} e */
async function saveProduct(e) {
    e.preventDefault();
    const f = e.target;
    const btn = _el('saveProductBtn');
    _el('productFormError').style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    const data = {
        name: f.name.value.trim(),
        sku: f.sku.value.trim(),
        category: f.category.value,
        price: Number(f.price.value),
        mrp: f.mrp.value ? Number(f.mrp.value) : null,
        stock: Number(f.stock.value) || 0,
        description: f.description.value.trim(),
        image_url: f.image_url.value.trim(),
        images: f.image_url.value.trim() ? [f.image_url.value.trim()] : [],
        sizes: f.sizes.value.trim() ? f.sizes.value.split(',').map(s => s.trim()).filter(Boolean) : [],
        featured: f.featured.checked,
        is_new: f.is_new.checked,
        active: f.active.checked,
    };

    try {
        if (editingProductId)
            await api(`/api/admin/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(data) });
        else
            await api('/api/admin/products', { method: 'POST', body: JSON.stringify(data) });

        toast(editingProductId ? 'Product updated!' : 'Product added successfully!');
        Cache.bust('products', 'dashboard');
        allProducts = [];
        closeProductModal();
        loadProducts();
    } catch (err) {
        _el('productFormError').style.display = 'flex';
        _el('productFormErrorMsg').textContent = err.message || 'Failed to save product';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Product';
    }
}

/** @param {number} id */
async function deleteProduct(id) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try {
        await api(`/api/admin/products/${id}`, { method: 'DELETE' });
        toast('Product deleted.', 'warning');
        Cache.bust('products', 'dashboard');
        allProducts = [];
        loadProducts();
    } catch (e) { toast(e.message || 'Failed to delete', 'error'); }
}


// ══════════════════════════════════════════════════════════════════════════════
// § CUSTOMERS  —  mirrors /api/admin/customers
// ══════════════════════════════════════════════════════════════════════════════

let allCustomers = [];
let filteredCustomers = [];
let cPg = 1;

async function loadCustomers() {
    const cached = Cache.get('customers');
    if (cached) { allCustomers = cached; filterCustomers(); return; }
    _el('customersTableBody').innerHTML = `<tr><td colspan="6"><div class="spinner-wrap"><i class="fa-solid fa-spinner"></i>Loading…</div></td></tr>`;
    try {
        const { customers } = await api('/api/admin/customers');
        allCustomers = customers || [];
        Cache.set('customers', allCustomers, 60_000);
        filterCustomers();
    } catch (e) {
        _el('customersTableBody').innerHTML = `<tr><td colspan="6"><div class="error-state" style="margin:8px"><i class="fa-solid fa-circle-exclamation"></i><span>Failed to load customers</span></div></td></tr>`;
    }
}

function filterCustomers() {
    const q = (_el('customerSearch').value || '').toLowerCase();
    const role = _el('roleFilter').value;
    filteredCustomers = allCustomers.filter(c => {
        const mq = !q || (c.first_name || '').toLowerCase().includes(q) || (c.last_name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q);
        const mr = !role || c.role === role;
        return mq && mr;
    });
    cPg = 1;
    renderCustomers();
}

function renderCustomers() {
    const start = (cPg - 1) * PAGE, page = filteredCustomers.slice(start, start + PAGE);
    const tbody = _el('customersTableBody');
    if (!page.length) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-users"></i><p>No customers found.</p></div></td></tr>';
        renderPagGen('customersPagination', 'customersPgInfo', filteredCustomers.length, cPg, p => { cPg = p; renderCustomers(); });
        return;
    }
    tbody.innerHTML = page.map(c => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.72rem;flex-shrink:0">
            ${esc((c.first_name || '?').charAt(0).toUpperCase())}
          </div>
          <div>
            <div class="td-name">${esc((c.first_name || '') + (c.last_name ? ' ' + c.last_name : ''))}</div>
            <div class="td-sub">${esc(c.email || '')}</div>
          </div>
        </div>
      </td>
      <td>${esc(c.phone || '—')}</td>
      <td class="td-sub">${fmt(c.created_at)}</td>
      <td><strong>${c.total_orders || 0}</strong></td>
      <td><span class="badge ${c.role === 'admin' ? 'badge-admin' : 'badge-customer'}">${c.role || 'customer'}</span></td>
      <td>
        ${c.role !== 'admin'
            ? `<button class="btn btn-sm btn-outline" onclick="makeAdmin(${c.id},'admin')"><i class="fa-solid fa-shield"></i> Make Admin</button>`
            : `<button class="btn btn-sm btn-outline" onclick="makeAdmin(${c.id},'customer')"><i class="fa-solid fa-user"></i> Remove Admin</button>`}
      </td>
    </tr>`).join('');
    renderPagGen('customersPagination', 'customersPgInfo', filteredCustomers.length, cPg, p => { cPg = p; renderCustomers(); });
}

/**
 * @param {number} id
 * @param {'admin'|'customer'} role
 */
async function makeAdmin(id, role) {
    if (!confirm(`Set this user as ${role}?`)) return;
    try {
        await api(`/api/admin/customers/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
        toast(`Role updated to ${role}!`);
        Cache.bust('customers');
        allCustomers = [];
        loadCustomers();
    } catch (e) { toast(e.message || 'Failed', 'error'); }
}


// ══════════════════════════════════════════════════════════════════════════════
// § COUPONS  —  mirrors /api/admin/coupons
// ══════════════════════════════════════════════════════════════════════════════

let allCoupons = [];
let editingCouponId = null;

async function loadCoupons() {
    _el('couponsTableBody').innerHTML = `<tr><td colspan="8"><div class="spinner-wrap"><i class="fa-solid fa-spinner"></i>Loading…</div></td></tr>`;
    try {
        const { coupons } = await api('/api/admin/coupons');
        allCoupons = coupons || [];
        renderCoupons();
    } catch (e) {
        _el('couponsTableBody').innerHTML = `<tr><td colspan="8"><div class="error-state" style="margin:8px"><i class="fa-solid fa-circle-exclamation"></i><span>Failed to load coupons</span></div></td></tr>`;
    }
}

function renderCoupons() {
    const tbody = _el('couponsTableBody');
    if (!allCoupons.length) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-ticket"></i><p>No coupons yet.</p></div></td></tr>';
        return;
    }
    tbody.innerHTML = allCoupons.map(c => `
    <tr>
      <td><span style="font-family:monospace;font-size:.8rem;background:#F1F5F9;padding:2px 8px;border-radius:4px">${esc(c.code)}</span></td>
      <td>${c.type === 'percent' ? 'Percentage' : 'Flat'}</td>
      <td><strong>${c.type === 'percent' ? c.value + '%' : '₹' + c.value}</strong></td>
      <td>${c.min_order ? fmtRs(c.min_order) : '—'}</td>
      <td><span style="font-weight:600">${c.used_count || 0}</span>${c.max_uses ? `/<span style="color:var(--muted)">${c.max_uses}</span>` : ''}</td>
      <td class="td-sub">${c.expires_at ? fmt(c.expires_at) : 'Never'}</td>
      <td>${c.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="icon-btn" onclick='editCoupon(${JSON.stringify(c).replace(/'/g, "&#39;")})' title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn del" onclick="deleteCoupon(${c.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

function openCouponModal() {
    editingCouponId = null;
    _el('couponForm').reset();
    _el('couponModalTitle').textContent = 'Add Coupon';
    _el('chkCouponActive').checked = true;
    _el('couponModalBd').classList.add('show');
}

/** @param {Object} c coupon object */
function editCoupon(c) {
    editingCouponId = c.id;
    _el('couponModalTitle').textContent = 'Edit Coupon';
    const f = _el('couponForm');
    f.code.value = c.code || '';
    f.type.value = c.type || 'percent';
    f.value.value = c.value || '';
    f.min_order.value = c.min_order || 0;
    f.max_discount.value = c.max_discount || '';
    f.max_uses.value = c.max_uses || '';
    f.expires_at.value = c.expires_at ? c.expires_at.replace('Z', '').substring(0, 16) : '';
    f.description.value = c.description || '';
    f.active.checked = !!c.active;
    _el('couponModalBd').classList.add('show');
}

function closeCouponModal() { _el('couponModalBd').classList.remove('show'); editingCouponId = null; }

/** @param {SubmitEvent} e */
async function saveCoupon(e) {
    e.preventDefault();
    const f = e.target;
    const btn = _el('saveCouponBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    const data = {
        code: f.code.value.trim().toUpperCase(),
        type: f.type.value,
        value: Number(f.value.value),
        min_order: Number(f.min_order.value) || 0,
        max_discount: f.max_discount.value ? Number(f.max_discount.value) : null,
        max_uses: f.max_uses.value ? Number(f.max_uses.value) : null,
        expires_at: f.expires_at.value || null,
        description: f.description.value.trim(),
        active: f.active.checked,
    };
    try {
        if (editingCouponId)
            await api(`/api/admin/coupons/${editingCouponId}`, { method: 'PUT', body: JSON.stringify(data) });
        else
            await api('/api/admin/coupons', { method: 'POST', body: JSON.stringify(data) });
        toast('Coupon saved!');
        closeCouponModal();
        loadCoupons();
    } catch (err) { toast(err.message || 'Failed to save coupon', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Coupon'; }
}

/** @param {number} id */
async function deleteCoupon(id) {
    if (!confirm('Delete this coupon?')) return;
    try {
        await api(`/api/admin/coupons/${id}`, { method: 'DELETE' });
        toast('Coupon deleted.', 'warning');
        loadCoupons();
    } catch (e) { toast(e.message || 'Failed', 'error'); }
}


// ══════════════════════════════════════════════════════════════════════════════
// § REVIEWS  —  mirrors /api/admin/reviews
// ══════════════════════════════════════════════════════════════════════════════

async function loadReviews() {
    const status = _el('reviewStatusFilter').value;
    _el('reviewsTableBody').innerHTML = `<tr><td colspan="6"><div class="spinner-wrap"><i class="fa-solid fa-spinner"></i>Loading reviews…</div></td></tr>`;
    try {
        const { reviews } = await api(`/api/admin/reviews?status=${status}`);
        const tbody = _el('reviewsTableBody');
        if (!reviews.length) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-star"></i><p>No reviews with this status.</p></div></td></tr>';
            return;
        }
        tbody.innerHTML = reviews.map(r => `
      <tr>
        <td><div class="td-name">${esc(r.product_name || '—')}</div></td>
        <td><div class="td-name">${esc((r.first_name || '') + (r.last_name ? ' ' + r.last_name : ''))}</div></td>
        <td>
          <span style="color:#f59e0b;font-size:.85rem">${'★'.repeat(Math.round(r.rating || 0)) + '☆'.repeat(5 - Math.round(r.rating || 0))}</span>
          <span style="font-size:.7rem;color:var(--muted)">(${r.rating || 0})</span>
        </td>
        <td><div style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem">${esc(r.review || '—')}</div></td>
        <td class="td-sub">${fmt(r.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px">
            ${status !== 'approved' ? `<button class="btn btn-sm btn-teal"   onclick="updateReview(${r.id},'approved')"><i class="fa-solid fa-check"></i> Approve</button>` : ''}
            ${status !== 'rejected' ? `<button class="btn btn-sm btn-danger"  onclick="updateReview(${r.id},'rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>` : ''}
          </div>
        </td>
      </tr>`).join('');
    } catch (e) {
        _el('reviewsTableBody').innerHTML = `<tr><td colspan="6"><div class="error-state" style="margin:8px"><i class="fa-solid fa-circle-exclamation"></i><span>Failed to load reviews</span></div></td></tr>`;
    }
}

/**
 * @param {number} id
 * @param {'approved'|'rejected'} status
 */
async function updateReview(id, status) {
    try {
        await api(`/api/admin/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
        toast(`Review ${status}!`);
        loadReviews();
    } catch (e) { toast(e.message || 'Failed', 'error'); }
}


// ══════════════════════════════════════════════════════════════════════════════
// § PAGINATION HELPER  —  generic renderer
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @param {string}   pgElId    element id for pagination buttons
 * @param {string}   pgInfoId  element id for "Showing X–Y of Z" text
 * @param {number}   total     total record count
 * @param {number}   page      current page
 * @param {Function} onPage    callback(page)
 */
function renderPagGen(pgElId, pgInfoId, total, page, onPage) {
    const pages = Math.ceil(total / PAGE);
    const el = _el(pgElId);
    const infoEl = _el(pgInfoId);
    if (infoEl) infoEl.innerHTML = total
        ? `Showing <strong>${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, total)}</strong> of <strong>${total}</strong>`
        : '0 records';
    if (!el || pages <= 1) { if (el) el.innerHTML = ''; return; }
    let btns = `<button class="pg-btn" onclick="(${onPage.toString()})(${page - 1})" ${page <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left" style="font-size:.7rem"></i></button>`;
    for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++)
        btns += `<button class="pg-btn ${i === page ? 'active' : ''}" onclick="(${onPage.toString()})(${i})">${i}</button>`;
    btns += `<button class="pg-btn" onclick="(${onPage.toString()})(${page + 1})" ${page >= pages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right" style="font-size:.7rem"></i></button>`;
    el.innerHTML = btns;
}


// ══════════════════════════════════════════════════════════════════════════════
// § MODAL CLOSE  —  backdrop click + ESC key
// ══════════════════════════════════════════════════════════════════════════════

_el('orderDetailModal').addEventListener('click', function (e) { if (e.target === this) closeOrderModal(); });
_el('productModalBd').addEventListener('click', function (e) { if (e.target === this) closeProductModal(); });
_el('couponModalBd').addEventListener('click', function (e) { if (e.target === this) closeCouponModal(); });

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeOrderModal(); closeProductModal(); closeCouponModal(); }
});


// ══════════════════════════════════════════════════════════════════════════════
// § GLOBAL 401 / 403 HANDLER  —  session expiry → show auth guard
// ══════════════════════════════════════════════════════════════════════════════

window.addEventListener('unhandledrejection', e => {
    const msg = e.reason?.message || '';
    if (e.reason?.status === 401 || msg.includes('401') || msg.includes('Unauthorized')) {
        _el('authGuard').classList.add('show');
        document.querySelector('.layout').style.visibility = 'hidden';
    }
});


// ══════════════════════════════════════════════════════════════════════════════
// § INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    const today = new Date().toISOString().split('T')[0];
    _el('dfTo').value = today;
    const from30 = new Date();
    from30.setDate(from30.getDate() - 30);
    _el('dfFrom').value = from30.toISOString().split('T')[0];
    loadDashboard();
});