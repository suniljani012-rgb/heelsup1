// worker/src/middleware/cors.js

const FALLBACK_ORIGINS = [
    'https://heelsup.in',
    'https://www.heelsup.in',
    'https://heelsupnew.heelsup.workers.dev',
    'http://localhost:3000',
    'http://localhost:8787',
];

/**
 * Build the full list of allowed origins.
 * env.CORS_ORIGIN may be a comma-separated string of additional origins,
 * or undefined/empty. Fallbacks are always included.
 */
function getAllowedOrigins(env) {
    const extra = (env && env.CORS_ORIGIN)
        ? env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
        : [];

    // Merge env origins with hardcoded fallbacks, deduplicating
    const merged = [...new Set([...extra, ...FALLBACK_ORIGINS])];
    return merged;
}

/**
 * Build CORS + security headers for a given request.
 * Always sends Vary: Origin so CDNs cache per-origin.
 */
export function corsHeaders(request, env) {
    const origin = (request && request.headers && request.headers.get('Origin')) || '';
    const allowed = getAllowedOrigins(env);
    // Use the matched origin so the browser accepts it; fall back to the first fallback.
    const allowedOrigin = allowed.includes(origin) ? origin : FALLBACK_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
}

/**
 * Respond to CORS preflight OPTIONS requests.
 */
export function handleOptions(request, env) {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/**
 * Clone a response and attach CORS + security headers.
 */
export function addCors(response, request, env) {
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(request, env)).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}