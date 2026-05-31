// ============================================================
// HeelsUp — Frontend Auth Management
// public/js/auth.js
// ============================================================

const Auth = (() => {

    const TOKEN_KEY = 'heelsup_token';
    const USER_KEY = 'heelsup_user';

    // ── Token helpers ─────────────────────────────────────────
    const getToken = () => localStorage.getItem(TOKEN_KEY);
    const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
    const clearToken = () => localStorage.removeItem(TOKEN_KEY);

    // ── User helpers ──────────────────────────────────────────
    const getUser = () => {
        try {
            return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        } catch { return null; }
    };
    const setUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));
    const clearUser = () => localStorage.removeItem(USER_KEY);

    // ── Is logged in ──────────────────────────────────────────
    const isLoggedIn = () => !!getToken();
    const isAdmin = () => { const u = getUser(); return u?.role === 'admin' || u?.role === 'staff'; };

    // ── Login ─────────────────────────────────────────────────
    async function login(email, password) {
        if (!window.API) throw new Error('API not loaded');
        const res = await window.API.auth.login(email, password);
        if (res.ok && res.data?.token) {
            setToken(res.data.token);
            setUser(res.data.user || {});
            return { ok: true, user: res.data.user };
        }
        return { ok: false, error: res.data?.error || 'Login failed' };
    }

    // ── Register ──────────────────────────────────────────────
    async function register(data) {
        if (!window.API) throw new Error('API not loaded');
        const res = await window.API.auth.register(data);
        if (res.ok && res.data?.token) {
            setToken(res.data.token);
            setUser(res.data.user || {});
            return { ok: true, user: res.data.user };
        }
        return { ok: false, error: res.data?.error || 'Registration failed' };
    }

    // ── Logout ────────────────────────────────────────────────
    function logout() {
        clearToken();
        clearUser();
        localStorage.removeItem('heelsup_cart');
        localStorage.removeItem('heelsup_wishlist');
        window.location.href = '/login.html';
    }

    // ── Fetch current user from API & cache ───────────────────
    async function fetchMe() {
        if (!isLoggedIn() || !window.API) return null;
        const res = await window.API.auth.me();
        if (res.ok && res.data?.user) {
            setUser(res.data.user);
            return res.data.user;
        }
        // Token invalid/expired
        if (res.status === 401) {
            clearToken();
            clearUser();
        }
        return null;
    }

    // ── Require login — redirect if not ──────────────────────
    function requireLogin() {
        if (!isLoggedIn()) {
            const redirect = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login.html?redirect=${redirect}`;
            return false;
        }
        return true;
    }

    // ── Require admin — redirect if not ──────────────────────
    function requireAdminAuth() {
        if (!isLoggedIn()) {
            window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
            return false;
        }
        if (!isAdmin()) {
            window.location.href = '/index.html';
            return false;
        }
        return true;
    }

    // ── Update navbar UI based on auth state ─────────────────
    function updateNavUI() {
        const user = getUser();
        const loggedIn = isLoggedIn();

        // Show/hide login vs account links
        document.querySelectorAll('[data-auth-show="logged-in"]').forEach(el => {
            el.style.display = loggedIn ? '' : 'none';
        });
        document.querySelectorAll('[data-auth-show="logged-out"]').forEach(el => {
            el.style.display = loggedIn ? 'none' : '';
        });

        // Populate user name if element exists
        if (user) {
            document.querySelectorAll('[data-user-name]').forEach(el => {
                el.textContent = user.first_name || user.name || 'My Account';
            });
        }
    }

    // ── Init ─────────────────────────────────────────────────
    function init() {
        updateNavUI();
    }

    return {
        getToken, setToken, clearToken,
        getUser, setUser, clearUser,
        isLoggedIn, isAdmin,
        login, register, logout, fetchMe,
        requireLogin, requireAdminAuth,
        updateNavUI, init,
    };
})();

// ── Auto-init & expose globally ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => Auth.init());
window.Auth = Auth;

// ── Shorthand for admin pages ──────────────────────────────────
function requireAdminAuth() { return Auth.requireAdminAuth(); }