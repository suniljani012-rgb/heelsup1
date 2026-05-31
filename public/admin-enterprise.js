(function () {
  "use strict";

  const PAGE = (window.location.pathname.split('/').pop() || '').toLowerCase();
  const REFRESH_MS = 60000;
  const PERF_SAMPLE_LIMIT = 25;

  const PREFETCH_ENDPOINTS = {
    'admin-analytics.html': ['/api/admin/analytics/dashboard?period=30d', '/api/admin/orders'],
    'admin-orders.html': ['/api/admin/orders'],
    'admin-products.html': ['/api/admin/products'],
    'admin-customers.html': ['/api/admin/customers'],
    'admin-categories.html': ['/api/admin/categories'],
    'admin-collections.html': ['/api/admin/collections'],
    'admin-coupons.html': ['/api/admin/coupons'],
    'admin-reviews.html': ['/api/admin/reviews?status=all'],
    'admin-notifications.html': ['/api/admin/notifications'],
    'admin-settings.html': ['/api/admin/settings'],
    'admin-banners.html': ['/api/admin/banners'],
    'admin-blog.html': ['/api/admin/blogs'],
    'admin-pages.html': ['/api/admin/pages'],
    'admin-pos.html': ['/api/admin/products', '/api/admin/orders'],
    'admin-reports.html': ['/api/admin/orders', '/api/admin/customers', '/api/admin/products'],
    'admin-shipping.html': ['/api/admin/orders', '/api/admin/shipping/zones'],
    'admin-staff.html': ['/api/admin/staff'],
    'admin-taxes.html': ['/api/admin/taxes/settings', '/api/admin/taxes/rules'],
    'admin-inventory.html': ['/api/admin/products'],
    'admin.html': ['/api/admin/orders', '/api/admin/products', '/api/admin/customers', '/api/admin/coupons']
  };

  const state = {
    lastSyncAt: null,
    avgMs: 0,
    samples: [],
    syncBadge: null,
    netBadge: null,
    lastAutoRefresh: 0
  };

  function ensureSyncBadge() {
    if (state.syncBadge) return state.syncBadge;

    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return null;

    const wrap = document.createElement('div');
    wrap.id = 'enterpriseSyncBadge';
    wrap.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:6px 10px',
      'border:1px solid #E4E8F0',
      'border-radius:999px',
      'background:#fff',
      'font-size:11px',
      'font-weight:600',
      'color:#64748B',
      'white-space:nowrap'
    ].join(';');
    wrap.innerHTML = '<i class="fa-solid fa-bolt" style="color:#F29F67"></i><span>Sync: waiting...</span>';
    topbarRight.prepend(wrap);
    state.syncBadge = wrap;
    return wrap;
  }

  function ensureNetworkBadge() {
    if (state.netBadge) return state.netBadge;

    const badge = document.createElement('div');
    badge.id = 'enterpriseNetBadge';
    badge.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'left:16px',
      'z-index:9999',
      'padding:7px 10px',
      'border-radius:10px',
      'font-size:12px',
      'font-weight:700',
      'color:#fff',
      'box-shadow:0 6px 20px rgba(30,30,44,.15)',
      'transition:all .2s ease'
    ].join(';');

    document.body.appendChild(badge);
    state.netBadge = badge;
    updateNetworkBadge();
    return badge;
  }

  function updateSyncBadge() {
    const badge = ensureSyncBadge();
    if (!badge) return;

    const label = badge.querySelector('span');
    if (!label) return;

    if (!state.lastSyncAt) {
      label.textContent = 'Sync: waiting...';
      return;
    }

    const d = state.lastSyncAt;
    const timeText = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    label.textContent = `Sync: ${timeText} • ${Math.round(state.avgMs)}ms`;
  }

  function updateNetworkBadge() {
    const badge = ensureNetworkBadge();
    if (!badge) return;

    const online = navigator.onLine;
    badge.style.background = online ? '#10B981' : '#EF4444';
    badge.textContent = online ? 'API Online' : 'API Offline';
    badge.style.opacity = online ? '0.86' : '1';
  }

  function pushLatency(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    state.samples.push(ms);
    if (state.samples.length > PERF_SAMPLE_LIMIT) state.samples.shift();
    state.avgMs = state.samples.reduce((a, b) => a + b, 0) / state.samples.length;
  }

  function syncActiveNav() {
    const navItems = Array.from(document.querySelectorAll('.sidebar-nav .nav-item'));
    if (!navItems.length) return;

    navItems.forEach((item) => item.classList.remove('active'));

    const page = PAGE || 'admin.html';
    const exact = navItems.find((item) => {
      const href = (item.getAttribute('href') || '').toLowerCase();
      return href.endsWith(page);
    });

    if (exact) {
      exact.classList.add('active');
      return;
    }

    const dashboard = navItems.find((item) => (item.getAttribute('href') || '').toLowerCase().includes('admin.html'));
    if (dashboard) dashboard.classList.add('active');
  }

  function loaders() {
    const names = [
      'loadAll',
      'loadDashboard',
      'loadOrders',
      'loadProducts',
      'loadCustomers',
      'loadCategories',
      'loadCollections',
      'loadCoupons',
      'loadReviews',
      'loadNotifications',
      'loadPages',
      'loadPosts',
      'loadBanners',
      'loadInventory',
      'loadTaxes',
      'loadShipping',
      'loadStaff'
    ];
    return names.map((name) => window[name]).filter((fn) => typeof fn === 'function');
  }

  function shouldAutoRefresh() {
    if (document.hidden) return false;
    if (!navigator.onLine) return false;
    if (Date.now() - state.lastAutoRefresh < REFRESH_MS) return false;
    return true;
  }

  async function runAutoRefresh() {
    if (!shouldAutoRefresh()) return;
    state.lastAutoRefresh = Date.now();

    const fns = loaders();
    if (!fns.length) return;

    const run = fns[0];
    try {
      await Promise.resolve(run());
    } catch (err) {
      console.warn('[EnterpriseRefresh] refresh failed:', err && err.message ? err.message : err);
    }
  }

  function setupAuthGuardListener() {
    window.addEventListener('heelsup:auth:unauthorized', () => {
      const guard = document.getElementById('authGuard');
      if (guard) guard.classList.add('show');
      if (!guard) window.location.href = 'login.html';
    });
  }

  function setupApiTelemetry() {
    window.addEventListener('heelsup:api', (event) => {
      const d = event.detail || {};
      if (d.ok) {
        state.lastSyncAt = new Date(d.timestamp || Date.now());
        pushLatency(Number(d.durationMs || 0));
        updateSyncBadge();
      }
    });
  }

  function setupFetchPatch() {
    if (!window.fetch || window.__heelsupFetchPatched) return;

    const originalFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      const isAdminApi = /^\/api\/admin\//.test(url);

      if (!isAdminApi || !window.HeelsUpAuth || typeof window.HeelsUpAuth.headers !== 'function') {
        return originalFetch(input, init);
      }

      const req = Object.assign({}, init || {});
      const body = req.body;
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      req.headers = window.HeelsUpAuth.headers(req.headers || {}, { isFormData: isForm });
      if (isForm) delete req.headers['Content-Type'];

      return originalFetch(input, req);
    };

    window.__heelsupFetchPatched = true;
  }

  async function warmPageCache() {
    if (!window.HeelsUpAuth || typeof window.HeelsUpAuth.prefetch !== 'function') return;
    const list = PREFETCH_ENDPOINTS[PAGE] || [];
    if (!list.length) return;
    try {
      await window.HeelsUpAuth.prefetch(list.map((path) => ({ path, options: { cache: true, dedupe: true, maxRetries: 1 } })));
    } catch (err) {
      console.warn('[EnterprisePrefetch] skipped:', err && err.message ? err.message : err);
    }
  }

  function setupAutoRefresh() {
    setInterval(runAutoRefresh, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) runAutoRefresh();
    });
  }

  function patchLegacyText() {
    document.querySelectorAll('.topbar-title').forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (txt) {
        el.setAttribute('title', `${txt} • Enterprise Console`);
      }
    });

    document.querySelectorAll('.hero-sub').forEach((el) => {
      const base = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (base && !base.includes('live data')) {
        el.textContent = `${base} • Powered by live data`;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    syncActiveNav();
    ensureSyncBadge();
    ensureNetworkBadge();
    setupFetchPatch();
    setupApiTelemetry();
    setupAuthGuardListener();
    setupAutoRefresh();
    patchLegacyText();

    window.addEventListener('online', updateNetworkBadge);
    window.addEventListener('offline', updateNetworkBadge);

    await warmPageCache();
    runAutoRefresh();
  });
})();
