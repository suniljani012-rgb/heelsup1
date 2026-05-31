// worker/src/middleware/auth.js
import { verifyJWT } from '../utils/jwt.js';
import { unauthorized, forbidden } from '../utils/response.js';

// ── In-memory blacklist cache ──────────────────────────────────────────────────
// Avoids a KV hit on every authenticated request.
// Entries: Map<token, expiresAtMs> — purged lazily on access.
const _blacklistCache = new Map();
const BLACKLIST_TTL_MS = 60_000; // 60 seconds

function _cacheIsBlacklisted(token) {
    const entry = _blacklistCache.get(token);
    if (!entry) return false;
    if (Date.now() > entry) {
        _blacklistCache.delete(token);
        return false;
    }
    return true;
}

function _cacheBlacklist(token) {
    _blacklistCache.set(token, Date.now() + BLACKLIST_TTL_MS);
}

// Periodically prune stale entries to prevent unbounded memory growth.
// Workers are short-lived per-request so this rarely accumulates, but it's good hygiene.
function _pruneCache() {
    const now = Date.now();
    for (const [k, v] of _blacklistCache) {
        if (now > v) _blacklistCache.delete(k);
    }
}

// ── Core authenticate ──────────────────────────────────────────────────────────

/**
 * Extracts and validates the Bearer JWT from the Authorization header.
 * Checks the in-memory blacklist cache first; falls through to KV on a cache miss.
 * Returns { user, error } — exactly one is non-null.
 */
export async function authenticate(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return { user: null, error: unauthorized('No token provided') };

    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return { user: null, error: unauthorized('Invalid or expired token') };

    // Fast path — check in-memory cache
    if (_cacheIsBlacklisted(token)) {
        return { user: null, error: unauthorized('Token revoked') };
    }

    // Slow path — check KV store
    try {
        const blacklisted = await env.KV.get(`blacklist:${token}`);
        if (blacklisted) {
            _cacheBlacklist(token); // warm the cache so subsequent requests skip KV
            return { user: null, error: unauthorized('Token revoked') };
        }
    } catch (e) {
        // KV unavailable — allow request to proceed rather than hard-blocking all users
        console.error('KV blacklist check failed:', e);
    }

    // Lazy prune once in a while
    if (Math.random() < 0.05) _pruneCache();

    return { user: payload, error: null };
}

// ── Auth guards ───────────────────────────────────────────────────────────────

/**
 * Require a valid JWT. Returns { user, error }.
 */
export async function requireAuth(request, env) {
    const { user, error } = await authenticate(request, env);
    if (error) return { user: null, error };
    return { user, error: null };
}

/**
 * Require admin, staff, or manager role. Returns { user, error }.
 */
export async function requireAdmin(request, env) {
    const { user, error } = await authenticate(request, env);
    if (error) return { user: null, error };
    if (!['admin', 'staff', 'manager'].includes(user.role)) {
        return { user: null, error: forbidden('Admin access required') };
    }
    return { user, error: null };
}

/**
 * Require the 'admin' role exclusively (superadmin).
 * Staff and managers are intentionally excluded.
 * Returns { user, error }.
 */
export async function requireSuperAdmin(request, env) {
    const { user, error } = await authenticate(request, env);
    if (error) return { user: null, error };
    if (user.role !== 'admin') {
        return { user: null, error: forbidden('Super-admin access required') };
    }
    return { user, error: null };
}

/**
 * Optional authentication — returns the JWT payload or null (never an error response).
 * Useful on public endpoints that behave differently for logged-in users.
 */
export async function optionalAuth(request, env) {
    const { user } = await authenticate(request, env);
    return user;
}

// ── Permission helper ──────────────────────────────────────────────────────────

/**
 * Check whether a user has a specific permission string.
 *
 * Admins implicitly have every permission.
 * For staff/manager, permissions are stored as a JSON array in user.staff_permissions.
 *
 * @param {object} user    - JWT payload (must contain role and optionally staff_permissions)
 * @param {string} permission - Permission key to check, e.g. "manage_orders"
 * @returns {boolean}
 */
export function hasPermission(user, permission) {
    if (!user) return false;
    if (user.role === 'admin') return true; // superadmin has everything

    let perms = [];
    try {
        const raw = user.staff_permissions;
        if (Array.isArray(raw)) {
            perms = raw;
        } else if (typeof raw === 'string') {
            perms = JSON.parse(raw);
        }
    } catch {
        perms = [];
    }

    return Array.isArray(perms) && perms.includes(permission);
}