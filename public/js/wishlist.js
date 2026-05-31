/**
 * HeelsUp Wishlist Helper
 * Syncs wishlist with /api/wishlist backend endpoints
 */
(function () {
    'use strict';

    let _ids = new Set(); // local cache of wishlisted product IDs
    let _synced = false;

    const API = (path, opts = {}) => {
        if (typeof HeelsUpAuth !== 'undefined' && HeelsUpAuth.api) {
            return HeelsUpAuth.api(path, opts);
        }
        return Promise.reject(new Error('Auth not ready'));
    };

    const isLoggedIn = () => {
        try { return !!(typeof HeelsUpAuth !== 'undefined' && HeelsUpAuth.getUser()); } catch { return false; }
    };

    // Persist to localStorage for instant UI
    function saveLocal() {
        try { localStorage.setItem('hu_wishlist_ids', JSON.stringify([..._ids])); } catch { }
    }
    function loadLocal() {
        try {
            const arr = JSON.parse(localStorage.getItem('hu_wishlist_ids') || '[]');
            _ids = new Set(arr.map(Number).filter(Boolean));
        } catch { _ids = new Set(); }
    }

    // Sync from server (called once after login)
    async function syncFromServer() {
        if (_synced || !isLoggedIn()) return;
        try {
            const data = await API('/api/wishlist/ids');
            if (data && Array.isArray(data.ids)) {
                data.ids.forEach(id => _ids.add(Number(id)));
                _synced = true;
                saveLocal();
                updateAllUI();
            }
        } catch { /* silent */ }
    }

    // Check if a product is in wishlist
    function has(productId) {
        return _ids.has(Number(productId));
    }

    // Toggle: returns Promise<boolean> — true if now wishlisted
    async function toggle(productId) {
        if (!isLoggedIn()) return false;
        const id = Number(productId);
        try {
            const result = await API('/api/wishlist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_id: id })
            });
            const wishlisted = !!result.wishlisted;
            if (wishlisted) { _ids.add(id); } else { _ids.delete(id); }
            saveLocal();
            updateAllUI();
            return wishlisted;
        } catch {
            return _ids.has(id); // return current state on error
        }
    }

    // Add to wishlist
    async function add(productId) {
        const id = Number(productId);
        if (_ids.has(id)) return true;
        if (!isLoggedIn()) return false;
        try {
            await API('/api/wishlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_id: id })
            });
            _ids.add(id);
            saveLocal();
            updateAllUI();
            return true;
        } catch { return false; }
    }

    // Remove from wishlist
    async function remove(productId) {
        const id = Number(productId);
        if (!isLoggedIn()) return;
        try {
            await API('/api/wishlist/' + id, { method: 'DELETE' });
            _ids.delete(id);
            saveLocal();
            updateAllUI();
        } catch { }
    }

    // Update all wishlist buttons on the page (for shop listings etc.)
    function updateAllUI() {
        document.querySelectorAll('[data-wish-id], .prod-wish[data-id]').forEach(btn => {
            const id = Number(btn.dataset.wishId || btn.dataset.id);
            if (!id) return;
            const wishlisted = _ids.has(id);
            btn.classList.toggle('active', wishlisted);
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = wishlisted ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            }
        });
        // Legacy: onclick toggleWish(id)
        document.querySelectorAll('.prod-wish').forEach(btn => {
            const match = btn.getAttribute('onclick')?.match(/toggleWish\(\s*(\d+)/);
            if (match) {
                const id = Number(match[1]);
                btn.classList.toggle('active', _ids.has(id));
            }
        });
    }

    // Initialize
    loadLocal();

    const HeelsUpWishlist = { has, toggle, add, remove, syncFromServer, updateUI: updateAllUI };
    window.HeelsUpWishlist = HeelsUpWishlist;

    // Backwards compat for shop cards
    window.toggleWish = async function (id, btn) {
        if (!isLoggedIn()) {
            if (typeof toast !== 'undefined') toast('Please log in to save items', 'info');
            return;
        }
        const result = await toggle(id);
        if (btn) btn.classList.toggle('active', result);
        if (typeof toast !== 'undefined') toast(result ? '❤️ Added to wishlist!' : 'Removed from wishlist', result ? 'success' : 'info');
    };

    // Auto-sync after auth is ready
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(syncFromServer, 800);
    });
})();
