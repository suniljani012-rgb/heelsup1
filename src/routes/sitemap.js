// src/routes/sitemap.js — HeelsUp Dynamic Sitemap Generator
// Serves GET /sitemap.xml with a 1-hour KV cache

const KV_CACHE_KEY = 'sitemap:xml';
const KV_TTL_SECONDS = 3600; // 1 hour

// Static pages included in every sitemap
const STATIC_PAGES = [
    { loc: '/',              changefreq: 'daily',   priority: '1.0' },
    { loc: '/shop.html',    changefreq: 'daily',   priority: '0.9' },
    { loc: '/about.html',   changefreq: 'monthly', priority: '0.6' },
    { loc: '/contact.html', changefreq: 'monthly', priority: '0.6' },
    { loc: '/blog.html',    changefreq: 'weekly',  priority: '0.7' },
    { loc: '/faq.html',     changefreq: 'monthly', priority: '0.5' },
    { loc: '/search.html',  changefreq: 'weekly',  priority: '0.6' },
];

function xmlEscape(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
    return [
        '  <url>',
        `    <loc>${xmlEscape(loc)}</loc>`,
        lastmod   ? `    <lastmod>${lastmod}</lastmod>` : '',
        changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
        priority  ? `    <priority>${priority}</priority>` : '',
        '  </url>',
    ].filter(Boolean).join('\n');
}

function buildSitemap(baseUrl, entries) {
    const urls = entries.map(e => urlEntry({ ...e, loc: baseUrl + e.loc }));
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
    ].join('\n');
}

export async function handleSitemap(request, env) {
    // 1. Try KV cache first
    try {
        const cached = await env.KV.get(KV_CACHE_KEY);
        if (cached) {
            return new Response(cached, {
                status: 200,
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Cache-Control': 'public, max-age=3600',
                    'X-Sitemap-Cache': 'HIT',
                },
            });
        }
    } catch (e) {
        console.warn('Sitemap KV read error:', e);
    }

    // 2. Derive base URL from request
    const reqUrl = new URL(request.url);
    const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const today = new Date().toISOString().slice(0, 10);

    // 3. Collect all entries
    const entries = STATIC_PAGES.map(p => ({ ...p, lastmod: today }));

    try {
        // 4. Active products
        const products = await env.DB.prepare(
            `SELECT id, name, updated_at FROM products WHERE active = 1 ORDER BY id DESC`
        ).all();
        for (const p of (products.results || [])) {
            const lastmod = p.updated_at ? p.updated_at.slice(0, 10) : today;
            entries.push({
                loc: `/product.html?id=${p.id}`,
                lastmod,
                changefreq: 'weekly',
                priority: '0.8',
            });
        }

        // 5. Active categories (from products table — distinct category values)
        const cats = await env.DB.prepare(
            `SELECT DISTINCT category FROM products WHERE active = 1 AND category IS NOT NULL AND category != ''`
        ).all();
        for (const c of (cats.results || [])) {
            const slug = c.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            if (slug) {
                entries.push({
                    loc: `/shop.html?cat=${encodeURIComponent(slug)}`,
                    lastmod: today,
                    changefreq: 'weekly',
                    priority: '0.7',
                });
            }
        }

        // 6. Published blogs
        const blogs = await env.DB.prepare(
            `SELECT slug, published_at, updated_at FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC`
        ).all();
        for (const b of (blogs.results || [])) {
            const lastmod = (b.updated_at || b.published_at || today).slice(0, 10);
            entries.push({
                loc: `/blog.html?slug=${encodeURIComponent(b.slug)}`,
                lastmod,
                changefreq: 'monthly',
                priority: '0.6',
            });
        }
    } catch (e) {
        console.error('Sitemap DB query error:', e);
        // Still serve a sitemap with at least static pages on DB error
    }

    const xml = buildSitemap(baseUrl, entries);

    // 7. Store in KV with TTL
    try {
        await env.KV.put(KV_CACHE_KEY, xml, { expirationTtl: KV_TTL_SECONDS });
    } catch (e) {
        console.warn('Sitemap KV write error:', e);
    }

    return new Response(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'X-Sitemap-Cache': 'MISS',
        },
    });
}
