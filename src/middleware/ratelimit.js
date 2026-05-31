// ============================================================
// HeelsUp — Rate Limit Middleware
// Uses Cloudflare KV to track request counts per IP
// ============================================================

/**
 * Rate limit a request using Cloudflare KV.
 * @param {Request} request
 * @param {object}  env       - Worker env bindings (must have .KV)
 * @param {object}  options
 * @param {number}  options.limit    - Max requests allowed (default: 60)
 * @param {number}  options.window   - Time window in seconds (default: 60)
 * @param {string}  options.prefix   - KV key prefix (default: 'rl')
 * @returns {Response|null} - Response if rate-limited, null if ok
 */
export async function rateLimit(request, env, {
    limit = 60,
    window = 60,
    prefix = 'rl',
} = {}) {
    if (!env.KV) return null; // KV not configured — skip silently

    const ip = request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
        || 'unknown';

    const key = `${prefix}:${ip}`;

    let current = 0;
    try {
        const stored = await env.KV.get(key);
        current = stored ? parseInt(stored, 10) : 0;
    } catch {
        return null; // KV error — fail open
    }

    if (current >= limit) {
        return new Response(
            JSON.stringify({ success: false, error: 'Too many requests. Please wait and try again.' }),
            {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(window),
                    'X-RateLimit-Limit': String(limit),
                    'X-RateLimit-Remaining': '0',
                },
            }
        );
    }

    // Increment counter
    try {
        await env.KV.put(key, String(current + 1), { expirationTtl: window });
    } catch {
        // KV write failed — fail open
    }

    return null; // Not rate-limited
}

/**
 * Strict rate limit for auth endpoints (login, register, otp)
 * 5 requests per minute per IP
 */
export async function authRateLimit(request, env) {
    return rateLimit(request, env, { limit: 5, window: 60, prefix: 'rl:auth' });
}

/**
 * Standard API rate limit — 100 req/min
 */
export async function apiRateLimit(request, env) {
    return rateLimit(request, env, { limit: 100, window: 60, prefix: 'rl:api' });
}

/**
 * Admin rate limit — 200 req/min (more lenient for admins)
 */
export async function adminRateLimit(request, env) {
    return rateLimit(request, env, { limit: 200, window: 60, prefix: 'rl:admin' });
}

/**
 * Payment endpoint rate limit — very strict
 * 10 requests per minute
 */
export async function paymentRateLimit(request, env) {
    return rateLimit(request, env, { limit: 10, window: 60, prefix: 'rl:pay' });
}