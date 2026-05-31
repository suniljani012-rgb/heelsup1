// worker/src/utils/response.js

export function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

export function ok(data, message = 'Success') {
    return json({ success: true, message, data });
}

export function list(data, pagination = null) {
    return json({ success: true, data, ...(pagination ? { pagination } : {}) });
}

export function created(data, message = 'Created') {
    return json({ success: true, message, data }, 201);
}

export function error(message = 'Error', status = 400) {
    return json({ success: false, error: message }, status);
}

export function notFound(message = 'Not found') {
    return json({ success: false, error: message }, 404);
}

export function unauthorized(message = 'Unauthorized') {
    return json({ success: false, error: message }, 401);
}

export function forbidden(message = 'Forbidden') {
    return json({ success: false, error: message }, 403);
}

export function serverError(message = 'Internal server error') {
    return json({ success: false, error: message }, 500);
}