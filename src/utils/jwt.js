// worker/src/utils/jwt.js
// Uses Web Crypto API — works natively in Cloudflare Workers

function base64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeBase64url(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function getKey(secret, usage) {
    const enc = new TextEncoder().encode(secret);
    return crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signJWT(payload, secret, expiresIn = 86400 * 7) {
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const iat = Math.floor(Date.now() / 1000);
    const body = base64url(new TextEncoder().encode(JSON.stringify({ ...payload, iat, exp: iat + expiresIn })));
    const msg = `${header}.${body}`;
    const key = await getKey(secret, 'sign');
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return `${msg}.${base64url(sig)}`;
}

export async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [header, body, sig] = parts;
        const key = await getKey(secret, 'verify');
        const valid = await crypto.subtle.verify(
            'HMAC', key,
            decodeBase64url(sig),
            new TextEncoder().encode(`${header}.${body}`)
        );
        if (!valid) return null;
        const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(body)));
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch {
        return null;
    }
}