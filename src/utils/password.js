// worker/src/utils/password.js
// Uses PBKDF2 via Web Crypto — no bcrypt needed in Workers

const ITERATIONS = 100000;
const KEY_LEN = 32;
const ALGO = 'SHA-256';

export async function hashPassword(password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: ALGO },
        keyMaterial, KEY_LEN * 8
    );
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password, stored) {
    try {
        if (!stored) return false;
        
        // Support old format: pbkdf2$100000$saltHex$hashHex
        if (stored.includes('$')) {
            const [algo, iters, salt, hash] = stored.split('$');
            if (algo !== 'pbkdf2') return false;
            
            const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
            const bits = await crypto.subtle.deriveBits(
                { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: Number(iters) }, 
                key, 
                256
            );
            const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
            return computed === hash;
        }
        
        // Support new format: pbkdf2:100000:saltHex:hashHex
        const [, , saltHex, hashHex] = stored.split(':');
        const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const derived = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: ALGO },
            keyMaterial, KEY_LEN * 8
        );
        const computedHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
        return computedHex === hashHex;
    } catch {
        return false;
    }
}