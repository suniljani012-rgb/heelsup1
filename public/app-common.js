/**
 * HeelsUp — Shared UI Components Library v4.0
 * Provides: Logo, Header, Footer, Toast, Loader, Cart Badge, Auth helpers
 */
(function () {
  'use strict';

  const API_BASE = (window.HEELSUP_CONFIG && window.HEELSUP_CONFIG.API_BASE) || window.location.origin;

  // ── Logo SVG (inline, no external dependency) ──────────────────
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 44" fill="none">
    <text x="0" y="34" font-family="Cormorant Garamond, Georgia, serif" font-size="36" font-weight="600" letter-spacing="-1" fill="#c9a96e">Heels</text>
    <text x="86" y="34" font-family="Cormorant Garamond, Georgia, serif" font-size="36" font-weight="300" letter-spacing="-1" fill="#fff">Up</text>
    <line x1="0" y1="40" x2="140" y2="40" stroke="#c9a96e" stroke-width="1" stroke-dasharray="4 3"/>
  </svg>`;

  const LOGO_DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 44" fill="none">
    <text x="0" y="34" font-family="Cormorant Garamond, Georgia, serif" font-size="36" font-weight="600" letter-spacing="-1" fill="#8c6033">Heels</text>
    <text x="86" y="34" font-family="Cormorant Garamond, Georgia, serif" font-size="36" font-weight="300" letter-spacing="-1" fill="#1a1a1a">Up</text>
    <line x1="0" y1="40" x2="140" y2="40" stroke="#c9a96e" stroke-width="1" stroke-dasharray="4 3"/>
  </svg>`;

  // ── Toast System ────────────────────────────────────────────────
  function ensureToastContainer() {
    let c = document.getElementById('hu-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'hu-toast-container';
      c.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none';
      document.body.appendChild(c);
    }
    return c;
  }

  function showToast(msg, type = 'success', duration = 4000) {
    const c = ensureToastContainer();
    const t = document.createElement('div');
    const colors = { success: '#276749', error: '#c53030', warning: '#c05621', info: '#2b6cb0' };
    const icons = {
      success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    };
    t.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:13px 18px;border-radius:12px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,0.25);pointer-events:all;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;max-width:340px;min-width:220px;transform:translateX(20px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1)`;
    t.innerHTML = `${icons[type]||icons.info}<span style="flex:1">${msg}</span><button onclick="this.parentNode.remove()" style="background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;padding:0;font-size:18px;line-height:1;margin-left:4px;pointer-events:all">×</button>`;
    c.appendChild(t);
    requestAnimationFrame(() => { t.style.transform = 'translateX(0)'; t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 300); }, duration);
  }

  // ── Full-Screen Loader (PhonePe style) ──────────────────────────
  function showLoader(msg = 'Loading...') {
    let el = document.getElementById('hu-full-loader');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hu-full-loader';
      el.style.cssText = 'position:fixed;inset:0;background:#0d0d0d;z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;transition:opacity 0.3s';
      el.innerHTML = `
        <div style="width:56px;height:56px;position:relative">
          <svg viewBox="0 0 56 56" style="width:100%;height:100%;animation:hu-spin 1s linear infinite">
            <circle cx="28" cy="28" r="24" fill="none" stroke="#333" stroke-width="4"/>
            <path d="M28 4a24 24 0 0 1 24 24" fill="none" stroke="#c9a96e" stroke-width="4" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
            <svg width="20" height="20" viewBox="0 0 140 44" fill="none"><text x="0" y="34" font-family="Cormorant Garamond,serif" font-size="36" font-weight="600" fill="#c9a96e">H</text></svg>
          </div>
        </div>
        <div id="hu-loader-msg" style="font-family:'DM Sans',sans-serif;color:rgba(255,255,255,0.6);font-size:14px;letter-spacing:0.05em">${msg}</div>
        <style>@keyframes hu-spin{to{transform:rotate(360deg)}}</style>
      `;
      document.body.appendChild(el);
    } else {
      document.getElementById('hu-loader-msg').textContent = msg;
      el.style.opacity = '1';
      el.style.display = 'flex';
    }
  }

  function hideLoader() {
    const el = document.getElementById('hu-full-loader');
    if (el) { el.style.opacity = '0'; setTimeout(() => el.style.display = 'none', 300); }
  }

  // ── Skeleton Loader ─────────────────────────────────────────────
  function skeleton(count = 4, type = 'product') {
    const styles = `<style>.hu-skel{background:linear-gradient(90deg,#f0ede8 25%,#e8e4dd 50%,#f0ede8 75%);background-size:200% 100%;animation:hu-shimmer 1.5s infinite;border-radius:8px}.hu-skel-card{background:#fff;border-radius:12px;padding:16px;border:1px solid #ede8df}.hu-skel-img{height:220px;margin-bottom:12px}.hu-skel-line{height:14px;margin-bottom:8px}.hu-skel-line.short{width:60%}.hu-skel-line.price{height:18px;width:40%}@keyframes hu-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>`;
    if (type === 'product') {
      return styles + Array(count).fill(0).map(() => `
        <div class="hu-skel-card">
          <div class="hu-skel hu-skel-img"></div>
          <div class="hu-skel hu-skel-line"></div>
          <div class="hu-skel hu-skel-line short"></div>
          <div class="hu-skel hu-skel-line price"></div>
        </div>`).join('');
    }
    return styles + Array(count).fill(0).map(() => `<div class="hu-skel" style="height:50px;margin-bottom:8px;border-radius:8px"></div>`).join('');
  }

  // ── Cart Badge ──────────────────────────────────────────────────
  function updateCartBadge() {
    try {
      const cart = JSON.parse(localStorage.getItem('heelsup_cart') || '[]');
      const count = cart.reduce((s, i) => s + (i.qty || 1), 0);
      document.querySelectorAll('[data-cart-count]').forEach(el => {
        el.textContent = count || '';
        el.style.display = count ? 'flex' : 'none';
      });
    } catch(e) {}
  }

  // ── Wishlist Badge ──────────────────────────────────────────────
  function updateWishlistBadge() {
    try {
      const wl = JSON.parse(localStorage.getItem('heelsup_wishlist') || '[]');
      document.querySelectorAll('[data-wishlist-count]').forEach(el => {
        el.textContent = wl.length || '';
        el.style.display = wl.length ? 'flex' : 'none';
      });
    } catch(e) {}
  }

  // ── Mobile Bottom Nav ───────────────────────────────────────────
  function renderMobileNav(active = '') {
    const navItems = [
      { key: 'home', href: 'index.html', label: 'Home', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
      { key: 'shop', href: 'shop.html', label: 'Shop', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.95-1.57l1.65-8.42H6"/></svg>` },
      { key: 'wishlist', href: 'wishlist.html', label: 'Wishlist', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>` },
      { key: 'cart', href: 'cart.html', label: 'Cart', badge: true, svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>` },
      { key: 'profile', href: 'profile.html', label: 'Account', svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` }
    ];
    const nav = document.createElement('nav');
    nav.id = 'hu-mobile-nav';
    nav.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #ede8df;z-index:999;padding:6px 0 calc(6px + env(safe-area-inset-bottom));box-shadow:0 -4px 20px rgba(0,0,0,0.08)';
    nav.innerHTML = navItems.map(item => `
      <a href="${item.href}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 4px;text-decoration:none;color:${item.key===active?'#c9a96e':'#8c8580'};position:relative;font-family:'DM Sans',sans-serif;font-size:10px;font-weight:${item.key===active?'600':'400'}">
        ${item.badge ? `<span style="position:relative;display:inline-flex">${item.svg}<span data-cart-count style="position:absolute;top:-6px;right:-8px;background:#d4456b;color:#fff;border-radius:50%;width:16px;height:16px;font-size:9px;font-weight:700;display:none;align-items:center;justify-content:center;border:1.5px solid #fff"></span></span>` : item.svg}
        ${item.label}
      </a>`).join('');
    // Show on mobile
    const style = document.createElement('style');
    style.textContent = `@media(max-width:768px){#hu-mobile-nav{display:flex!important}body{padding-bottom:70px}}`;
    document.head.appendChild(style);
    document.body.appendChild(nav);
    updateCartBadge();
  }

  // ── Announcement Bar ────────────────────────────────────────────
  function renderAnnouncementBar(messages = []) {
    const defaults = ['🎉 Free Shipping on orders above ₹799', '✨ New Arrivals Every Week', '🔒 100% Secure Payments via Razorpay'];
    const msgs = messages.length ? messages : defaults;
    const bar = document.createElement('div');
    bar.style.cssText = 'background:#0d0d0d;color:rgba(255,255,255,0.85);font-size:12px;font-weight:500;letter-spacing:0.04em;padding:9px 0;text-align:center;position:relative;z-index:201;overflow:hidden';
    let i = 0;
    bar.innerHTML = `<div id="hu-ann-text" style="transition:opacity 0.4s">${msgs[0]}</div>`;
    document.body.insertAdjacentElement('afterbegin', bar);
    if (msgs.length > 1) {
      setInterval(() => {
        i = (i + 1) % msgs.length;
        const t = bar.querySelector('#hu-ann-text');
        t.style.opacity = '0';
        setTimeout(() => { t.textContent = msgs[i]; t.style.opacity = '1'; }, 400);
      }, 3500);
    }
    return bar;
  }

  // ── CORS-safe API fetch ─────────────────────────────────────────
  async function apiFetch(path, opts = {}) {
    const token = localStorage.getItem('heelsup_token');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── Format price in INR ─────────────────────────────────────────
  function formatPrice(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN');
  }

  // ── Format date ─────────────────────────────────────────────────
  function formatDate(d, short = false) {
    if (!d) return '—';
    const opts = short
      ? { day: '2-digit', month: 'short' }
      : { day: '2-digit', month: 'short', year: 'numeric' };
    return new Date(d).toLocaleDateString('en-IN', opts);
  }

  // ── Status badge HTML ───────────────────────────────────────────
  function statusBadge(s) {
    const map = {
      placed: ['#dbeafe','#1d4ed8'], confirmed: ['#dcfce7','#15803d'],
      shipped: ['#f3e8ff','#7e22ce'], delivered: ['#d1fae5','#065f46'],
      cancelled: ['#fee2e2','#b91c1c'], returned: ['#fef3c7','#92400e'],
      paid: ['#dcfce7','#15803d'], pending: ['#fef3c7','#b45309'],
      failed: ['#fee2e2','#b91c1c'], processing: ['#e0e7ff','#3730a3']
    };
    const [bg, color] = map[s] || ['#f1f5f9','#64748b'];
    return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.04em;background:${bg};color:${color};text-transform:uppercase">${s||'unknown'}</span>`;
  }

  // ── Scroll reveal animation ─────────────────────────────────────
  function initScrollReveal() {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.opacity = '1';
          e.target.style.transform = 'translateY(0)';
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(el => {
      el.style.cssText += ';opacity:0;transform:translateY(24px);transition:opacity 0.6s ease,transform 0.6s ease';
      obs.observe(el);
    });
  }

  // ── Back to top button ──────────────────────────────────────────
  function initBackToTop() {
    const btn = document.createElement('button');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>`;
    btn.style.cssText = 'position:fixed;bottom:90px;right:20px;width:44px;height:44px;border-radius:50%;background:#c9a96e;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(201,169,110,0.4);display:none;align-items:center;justify-content:center;z-index:998;transition:all 0.3s;font-family:sans-serif';
    btn.setAttribute('aria-label', 'Back to top');
    document.body.appendChild(btn);
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', () => {
      btn.style.display = window.scrollY > 400 ? 'flex' : 'none';
    });
  }

  // ── Dynamic Navigation ──────────────────────────────────────────
  async function loadDynamicNavigation() {
    try {
      const data = await apiFetch('/api/categories');
      const cats = data.categories || [];
      if (!cats.length) return;
      
      // Update Desktop Dropdown
      const dropdowns = document.querySelectorAll('.nav-dropdown');
      dropdowns.forEach(dd => {
        dd.innerHTML = cats.map(c => 
          `<a href="shop.html?category=${c.slug || c.name}"><span class="nav-dropdown-icon">✨</span> ${c.name}</a>`
        ).join('');
      });

      // Update Mobile Menu
      const mobileBody = document.querySelector('.mobile-menu-body');
      if (mobileBody) {
        // Find where to insert (after 'Shop All')
        const shopAllLink = Array.from(mobileBody.querySelectorAll('a')).find(a => a.textContent.includes('Shop All'));
        if (shopAllLink) {
          // Remove old hardcoded categories (the ones between Shop All and About Us)
          let next = shopAllLink.nextElementSibling;
          while (next && !next.textContent.includes('About') && !next.textContent.includes('New Arrivals') && next.tagName === 'A') {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
          }
          
          // Insert new categories
          const fragment = document.createDocumentFragment();
          cats.forEach(c => {
            const a = document.createElement('a');
            a.href = `shop.html?category=${c.slug || c.name}`;
            a.innerHTML = `✨ ${c.name}`;
            fragment.appendChild(a);
          });
          shopAllLink.after(fragment);
        }
      }
    } catch (e) {
      console.error('Failed to load dynamic navigation:', e);
    }
  }

  // ── Export ─────────────────────────────────────────────────────
  window.HeelsUpUI = {
    LOGO_SVG,
    LOGO_DARK_SVG,
    API_BASE,
    showToast,
    showLoader,
    hideLoader,
    skeleton,
    updateCartBadge,
    updateWishlistBadge,
    renderMobileNav,
    renderAnnouncementBar,
    apiFetch,
    formatPrice,
    formatDate,
    statusBadge,
    initScrollReveal,
    initBackToTop,
    loadDynamicNavigation
  };

  // Auto-init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    updateCartBadge();
    updateWishlistBadge();
    initScrollReveal();
    initBackToTop();
    loadDynamicNavigation();
  });
})();
