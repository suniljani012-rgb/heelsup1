// ============================================================
// HeelsUp — UI Utilities
// public/js/ui.js
// Toast, Modal, Loader, Wishlist toggle, formatters
// ============================================================

// ── Toast Notification ────────────────────────────────────────
let toastContainer = null;

function showToast(message, type = 'success', duration = 3000) {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
      position: fixed; bottom: 24px; right: 24px;
      z-index: var(--z-toast, 500);
      display: flex; flex-direction: column; gap: 8px;
      pointer-events: none;
    `;
        document.body.appendChild(toastContainer);
    }

    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const colors = {
        success: 'var(--color-success, #22c55e)',
        error: 'var(--color-error,   #ef4444)',
        warning: 'var(--color-warning, #f59e0b)',
        info: 'var(--color-info,    #3b82f6)',
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
    display: flex; align-items: center; gap: 10px;
    padding: 12px 18px;
    background: var(--color-gray-900, #1a1a1a);
    color: #fff;
    border-radius: var(--radius-lg, 0.5rem);
    font-family: var(--font-body, sans-serif);
    font-size: 14px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    pointer-events: auto;
    opacity: 0;
    transform: translateY(8px);
    transition: all 250ms ease;
    border-left: 3px solid ${colors[type] || colors.success};
    max-width: 320px;
  `;
    toast.innerHTML = `
    <span style="color:${colors[type] || colors.success}; font-weight: 700">${icons[type] || icons.success}</span>
    <span>${message}</span>
  `;

    toastContainer.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── Page Loader ───────────────────────────────────────────────
function showLoader(target = document.body) {
    const existing = target.querySelector('.hu-loader');
    if (existing) return;

    const loader = document.createElement('div');
    loader.className = 'hu-loader';
    loader.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.7);
    z-index: var(--z-overlay, 300);
    border-radius: inherit;
  `;
    loader.innerHTML = `
    <div style="
      width: 32px; height: 32px;
      border: 3px solid var(--color-primary-light, #ead2ae);
      border-top-color: var(--color-primary, #c9a96e);
      border-radius: 50%;
      animation: hu-spin 0.7s linear infinite;
    "></div>
    <style>@keyframes hu-spin { to { transform: rotate(360deg); } }</style>
  `;
    if (getComputedStyle(target).position === 'static') {
        target.style.position = 'relative';
    }
    target.appendChild(loader);
}

function hideLoader(target = document.body) {
    target.querySelector('.hu-loader')?.remove();
}

// ── Button Loader ─────────────────────────────────────────────
function btnLoading(btn, loading = true, originalText = null) {
    if (loading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:hu-spin 0.7s linear infinite">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" stroke-linecap="round"/>
      </svg>
      Loading…
    </span>`;
    } else {
        btn.disabled = false;
        btn.textContent = originalText || btn.dataset.originalText || 'Submit';
    }
}

// ── Confirm Modal ─────────────────────────────────────────────
function showConfirm(message, onConfirm, onCancel = null) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: var(--z-modal, 400);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  `;

    overlay.innerHTML = `
    <div style="
      background: #fff;
      border-radius: var(--radius-2xl, 1rem);
      padding: 2rem;
      max-width: 400px; width: 100%;
      font-family: var(--font-body, sans-serif);
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    ">
      <p style="margin:0 0 1.5rem; font-size:15px; color:var(--text-primary,#0d0d0d)">${message}</p>
      <div style="display:flex;gap:12px;justify-content:flex-end">
        <button id="hu-cancel-btn" style="
          padding:8px 20px; border:1px solid var(--border-color,#ede8df);
          border-radius:var(--radius-pill,9999px); background:#fff;
          font-size:14px; cursor:pointer;
        ">Cancel</button>
        <button id="hu-confirm-btn" style="
          padding:8px 20px; border:none;
          border-radius:var(--radius-pill,9999px);
          background:var(--color-error,#ef4444); color:#fff;
          font-size:14px; cursor:pointer; font-weight:500;
        ">Confirm</button>
      </div>
    </div>
  `;

    document.body.appendChild(overlay);

    overlay.querySelector('#hu-confirm-btn').onclick = () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    };
    overlay.querySelector('#hu-cancel-btn').onclick = () => {
        overlay.remove();
        if (onCancel) onCancel();
    };
    overlay.onclick = (e) => {
        if (e.target === overlay) { overlay.remove(); if (onCancel) onCancel(); }
    };
}

// ── Wishlist Toggle ───────────────────────────────────────────
const WISHLIST_KEY = 'heelsup_wishlist';

function getWishlist() {
    try { return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); }
    catch { return []; }
}

function isWishlisted(productId) {
    return getWishlist().includes(String(productId));
}

function toggleWishlist(productId, btn = null) {
    const id = String(productId);
    const list = getWishlist();
    const idx = list.indexOf(id);
    let added;

    if (idx > -1) { list.splice(idx, 1); added = false; }
    else { list.push(id); added = true; }

    localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
    updateWishlistBadge();

    if (btn) {
        const icon = btn.querySelector('i') || btn;
        if (added) {
            icon.classList.replace('fa-regular', 'fa-solid') || icon.classList.add('fa-solid');
            icon.style.color = 'var(--color-accent, #d4456b)';
        } else {
            icon.classList.replace('fa-solid', 'fa-regular') || icon.classList.remove('fa-solid');
            icon.style.color = '';
        }
    }

    showToast(added ? 'Added to wishlist ❤️' : 'Removed from wishlist', added ? 'success' : 'info');

    // Sync with backend if logged in
    if (window.API && window.API.auth.isLoggedIn()) {
        window.API.wishlist.toggle(productId).catch(() => { });
    }

    return added;
}

function updateWishlistBadge() {
    const count = getWishlist().length;
    document.querySelectorAll('#wishlistCount, .wishlist-count, [data-wishlist-count]').forEach(el => {
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
    });
}

// ── Price Formatter ───────────────────────────────────────────
function formatPrice(paise, opts = {}) {
    return (paise / 100).toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        ...opts,
    });
}

// ── Date Formatter ────────────────────────────────────────────
function formatDate(iso, opts = {}) {
    return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', ...opts
    });
}

// ── Debounce ──────────────────────────────────────────────────
function debounce(fn, delay = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── Init ─────────────────────────────────────────────────────
function initUI() {
    updateWishlistBadge();

    // Init wishlist button states on page
    document.querySelectorAll('[data-wishlist-id]').forEach(btn => {
        const id = btn.dataset.wishlistId;
        if (isWishlisted(id)) {
            const icon = btn.querySelector('i') || btn;
            icon.classList.add('fa-solid');
            icon.style.color = 'var(--color-accent, #d4456b)';
        }
    });
}

document.addEventListener('DOMContentLoaded', initUI);

// ── Expose globally ───────────────────────────────────────────
window.showToast = showToast;
window.showLoader = showLoader;
window.hideLoader = hideLoader;
window.btnLoading = btnLoading;
window.showConfirm = showConfirm;
window.toggleWishlist = toggleWishlist;
window.isWishlisted = isWishlisted;
window.getWishlist = getWishlist;
window.formatPrice = formatPrice;
window.formatDate = formatDate;
window.debounce = debounce;