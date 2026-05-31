// ============================================================
// HeelsUp — Admin Auth Middleware
// Protects admin-only routes — requires role: admin | staff
// ============================================================

import { authenticate } from './auth.js';
import { error } from '../utils/response.js';

/**
 * requireAdmin — blocks non-admin users.
 * Returns user payload if admin, else returns 401/403 Response.
 */
export async function requireAdmin(request, env) {
    const { user, error: authError } = await authenticate(request, env);

    if (authError) {
        return { user: null, response: authError };
    }

    if (!['admin', 'staff', 'manager'].includes(user.role)) {
        return { user: null, response: error('Forbidden — admin access required', 403) };
    }

    return { user, response: null };
}

/**
 * requireSuperAdmin — blocks everyone except role: admin
 * (staff cannot perform destructive operations)
 */
export async function requireSuperAdmin(request, env) {
    const { user, error: authError } = await authenticate(request, env);

    if (authError) {
        return { user: null, response: authError };
    }

    if (user.role !== 'admin') {
        return { user: null, response: error('Forbidden — super-admin access required', 403) };
    }

    return { user, response: null };
}

/**
 * Helper: use at top of any admin route handler.
 *
 * Usage:
 *   const { user, earlyReturn } = await adminGuard(request, env);
 *   if (earlyReturn) return earlyReturn;
 *   // ... safe to proceed
 */
export async function adminGuard(request, env, superAdminOnly = false) {
    const { user, response } = superAdminOnly
        ? await requireSuperAdmin(request, env)
        : await requireAdmin(request, env);

    return { user, earlyReturn: response || null };
}

/**
 * Check if currently logged-in user is admin (for non-blocking checks)
 */
export async function isAdminUser(request, env) {
    const { user } = await authenticate(request, env);
    return user && ['admin', 'staff', 'manager'].includes(user.role);
}