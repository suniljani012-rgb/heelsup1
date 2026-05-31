// ============================================================
// HeelsUp — R2 Storage Helpers
// backend/src/utils/r2.js
// Cloudflare R2 (S3-compatible) — no AWS SDK needed
// ============================================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/**
 * Upload a file to R2.
 * @param {R2Bucket} bucket   - env.BUCKET
 * @param {string}   key      - e.g. "products/abc123.jpg"
 * @param {ArrayBuffer|ReadableStream} body
 * @param {string}   contentType
 * @returns {Promise<{ok: boolean, key: string, error?: string}>}
 */
export async function upload(bucket, key, body, contentType) {
    try {
        await bucket.put(key, body, {
            httpMetadata: { contentType },
            customMetadata: { uploadedAt: new Date().toISOString() },
        });
        return { ok: true, key };
    } catch (err) {
        console.error('[R2] Upload error:', err);
        return { ok: false, key, error: err.message };
    }
}

/**
 * Delete a file from R2.
 * @param {R2Bucket} bucket
 * @param {string}   key
 */
export async function remove(bucket, key) {
    try {
        await bucket.delete(key);
        return { ok: true };
    } catch (err) {
        console.error('[R2] Delete error:', err);
        return { ok: false, error: err.message };
    }
}

/**
 * Delete multiple files from R2.
 * @param {R2Bucket} bucket
 * @param {string[]} keys
 */
export async function removeMany(bucket, keys) {
    try {
        await bucket.delete(keys);
        return { ok: true };
    } catch (err) {
        console.error('[R2] Bulk delete error:', err);
        return { ok: false, error: err.message };
    }
}

/**
 * Check if a file exists in R2.
 * @param {R2Bucket} bucket
 * @param {string}   key
 * @returns {Promise<boolean>}
 */
export async function exists(bucket, key) {
    try {
        const obj = await bucket.head(key);
        return !!obj;
    } catch {
        return false;
    }
}

/**
 * Get public URL for an R2 object.
 * @param {string} r2PublicUrl - env.R2_PUBLIC_URL
 * @param {string} key
 * @returns {string}
 */
export function publicUrl(r2PublicUrl, key) {
    return `${r2PublicUrl}/${key}`;
}

/**
 * Process an uploaded file from multipart form data.
 * Validates type and size, then uploads to R2.
 *
 * @param {R2Bucket} bucket
 * @param {string}   r2PublicUrl  - env.R2_PUBLIC_URL
 * @param {File}     file         - From formData.get('file')
 * @param {string}   folder       - e.g. "products", "avatars"
 * @returns {Promise<{ok:boolean, url:string, key:string, error?:string}>}
 */
export async function processUpload(bucket, r2PublicUrl, file, folder = 'uploads') {
    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
        return { ok: false, url: '', key: '', error: `File type not allowed. Use: ${ALLOWED_EXT.join(', ')}` };
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
        return { ok: false, url: '', key: '', error: 'File too large. Max size is 5MB.' };
    }

    // Generate unique filename
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const key = `${folder}/${timestamp}-${random}.${ext}`;

    // Upload to R2
    const buffer = await file.arrayBuffer();
    const result = await upload(bucket, key, buffer, file.type);

    if (!result.ok) return { ok: false, url: '', key, error: result.error };

    return {
        ok: true,
        url: publicUrl(r2PublicUrl, key),
        key,
    };
}

/**
 * Extract R2 key from a public URL.
 * @param {string} r2PublicUrl
 * @param {string} url
 * @returns {string|null}
 */
export function keyFromUrl(r2PublicUrl, url) {
    if (!url || !url.startsWith(r2PublicUrl)) return null;
    return url.slice(r2PublicUrl.length + 1);
}

/**
 * Upload a PDF receipt to R2 (used by POS/receipts module).
 * @param {R2Bucket} bucket
 * @param {string}   r2PublicUrl
 * @param {ArrayBuffer} pdfBuffer
 * @param {string}   orderId
 * @returns {Promise<{ok:boolean, url:string, key:string}>}
 */
export async function uploadReceipt(bucket, r2PublicUrl, pdfBuffer, orderId) {
    const key = `receipts/${orderId}.pdf`;
    const result = await upload(bucket, key, pdfBuffer, 'application/pdf');
    if (!result.ok) return result;
    return { ok: true, url: publicUrl(r2PublicUrl, key), key };
}