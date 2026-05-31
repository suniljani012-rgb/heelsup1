(function () {
  "use strict";

  const API_BASE = (window.HEELSUP_CONFIG && window.HEELSUP_CONFIG.API_BASE) || "";
  const DEFAULTS = {
    timeoutMs: 15000,
    maxRetries: 2,
    retryDelayMs: 350,
    cacheTtlMs: 20000,
    useCache: true,
    dedupe: true
  };

  const inflight = new Map();
  const responseCache = new Map();
  let runtimeConfig = { ...DEFAULTS };

  function now() {
    return Date.now();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getToken() {
    return localStorage.getItem("heelsup_token") || "";
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("heelsup_user") || "null");
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    if (token) localStorage.setItem("heelsup_token", token);
    if (user) localStorage.setItem("heelsup_user", JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem("heelsup_token");
    localStorage.removeItem("heelsup_user");
  }

  function headers(extra, options) {
    const cfg = options || {};
    const merged = Object.assign({ "Content-Type": "application/json" }, extra || {});

    if (cfg.skipAuth !== true) {
      const token = getToken();
      if (token) merged.Authorization = `Bearer ${token}`;
    }

    if (cfg.isFormData) {
      delete merged["Content-Type"];
    }

    return merged;
  }

  function buildUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path}`;
  }

  function normalizeMethod(method) {
    return String(method || "GET").toUpperCase();
  }

  function isIdempotent(method) {
    const m = normalizeMethod(method);
    return m === "GET" || m === "HEAD" || m === "OPTIONS";
  }

  function parseJsonSafe(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  function cacheKey(url, method) {
    return `${normalizeMethod(method)}::${url}`;
  }

  function shouldRetry(status, err, method, attempt, maxRetries) {
    if (attempt >= maxRetries) return false;
    if (!isIdempotent(method)) return false;
    if (err && (err.name === "AbortError" || /network|failed to fetch/i.test(err.message || ""))) return true;
    return status === 429 || (status >= 500 && status <= 599);
  }

  function emitApiEvent(detail) {
    try {
      window.dispatchEvent(new CustomEvent("heelsup:api", { detail }));
    } catch {}
  }

  async function request(path, options) {
    const opts = Object.assign({ method: "GET" }, options || {});
    const method = normalizeMethod(opts.method);
    const url = buildUrl(path);
    const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;

    const timeoutMs = Number(opts.timeoutMs || runtimeConfig.timeoutMs || DEFAULTS.timeoutMs);
    const maxRetries = Number(opts.maxRetries ?? opts.retries ?? runtimeConfig.maxRetries ?? DEFAULTS.maxRetries);
    const retryDelayMs = Number(opts.retryDelayMs ?? runtimeConfig.retryDelayMs ?? DEFAULTS.retryDelayMs);
    const useCache = opts.cache !== false && runtimeConfig.useCache && method === "GET";
    const dedupe = opts.dedupe !== false && runtimeConfig.dedupe && method === "GET";
    const cacheTtlMs = Number(opts.cacheTtlMs ?? runtimeConfig.cacheTtlMs ?? DEFAULTS.cacheTtlMs);

    const key = cacheKey(url, method);

    if (useCache) {
      const cached = responseCache.get(key);
      if (cached && cached.expiresAt > now()) {
        emitApiEvent({
          path,
          url,
          method,
          status: 200,
          ok: true,
          fromCache: true,
          durationMs: 0,
          timestamp: Date.now()
        });
        return cached.value;
      }
    }

    if (dedupe && inflight.has(key)) {
      return inflight.get(key);
    }

    const startedAt = performance.now();

    const exec = (async () => {
      let lastError = null;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;

        try {
          const reqHeaders = headers(opts.headers || {}, { skipAuth: opts.skipAuth, isFormData });
          const fetchOptions = {
            method,
            headers: reqHeaders,
            body: opts.body,
            signal: controller ? controller.signal : undefined,
            credentials: opts.credentials || "same-origin"
          };

          const response = await fetch(url, fetchOptions);
          const text = await response.text();
          const data = parseJsonSafe(text);

          if (timeoutId) clearTimeout(timeoutId);

          if (!response.ok) {
            const err = new Error((data && (data.error || data.message)) || `Request failed (${response.status})`);
            err.status = response.status;
            err.data = data;
            lastError = err;

            if (response.status === 401) {
              clearSession();
              emitApiEvent({
                path,
                url,
                method,
                status: 401,
                ok: false,
                durationMs: Math.round(performance.now() - startedAt),
                timestamp: Date.now()
              });
              window.dispatchEvent(new CustomEvent("heelsup:auth:unauthorized"));
            }

            if (shouldRetry(response.status, null, method, attempt, maxRetries)) {
              await sleep(retryDelayMs * Math.pow(2, attempt));
              continue;
            }

            throw err;
          }

          if (useCache) {
            responseCache.set(key, { value: data, expiresAt: now() + cacheTtlMs });
          } else if (method !== "GET") {
            invalidate('/api/admin/');
          }

          emitApiEvent({
            path,
            url,
            method,
            status: response.status,
            ok: true,
            fromCache: false,
            durationMs: Math.round(performance.now() - startedAt),
            timestamp: Date.now()
          });

          return data;
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId);
          lastError = error;

          const status = Number(error && error.status ? error.status : 0);
          if (shouldRetry(status, error, method, attempt, maxRetries)) {
            await sleep(retryDelayMs * Math.pow(2, attempt));
            continue;
          }

          emitApiEvent({
            path,
            url,
            method,
            status: status || 0,
            ok: false,
            fromCache: false,
            durationMs: Math.round(performance.now() - startedAt),
            timestamp: Date.now(),
            error: error && error.message ? error.message : "Network error"
          });

          throw error;
        }
      }

      throw lastError || new Error("Request failed");
    })();

    if (dedupe) inflight.set(key, exec);

    try {
      return await exec;
    } finally {
      if (dedupe) inflight.delete(key);
    }
  }

  function invalidate(match) {
    if (!match) {
      responseCache.clear();
      return;
    }

    const matcher = typeof match === "string"
      ? (key) => key.includes(match)
      : (typeof match === "function" ? match : () => false);

    for (const key of responseCache.keys()) {
      if (matcher(key)) responseCache.delete(key);
    }
  }

  function setOptions(next) {
    runtimeConfig = Object.assign({}, runtimeConfig, next || {});
    return runtimeConfig;
  }

  async function prefetch(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const tasks = list.map((item) => {
      if (!item) return Promise.resolve(null);
      if (typeof item === "string") return request(item, { cache: true, dedupe: true });
      return request(item.path, Object.assign({ cache: true, dedupe: true }, item.options || {}));
    });
    return Promise.allSettled(tasks);
  }

  window.HeelsUpAuth = {
    API_BASE,
    getToken,
    getUser,
    setSession,
    clearSession,
    headers,
    authHeaders: headers,
    api: request,
    request,
    prefetch,
    invalidate,
    setOptions
  };
})();
