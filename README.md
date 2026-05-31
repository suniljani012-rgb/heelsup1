# HeelsUp — Ladies Footwear & Bags Online Store

**Website:** [heelsup.in](https://heelsup.in) | **Location:** Jodhpur, Rajasthan, India

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Pure HTML5 + CSS3 + Vanilla JS |
| Backend | Cloudflare Workers (JS ES Modules) |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 (Product images) |
| Payment | Razorpay |
| Hosting | Cloudflare Pages + Workers |

---

## Project Structure

```
heelsup/
├── public/          ← Frontend (HTML, CSS, JS)
├── src/             ← Cloudflare Worker (Backend API)
│   ├── index.js     ← Main router
│   ├── middleware/  ← auth, cors, ratelimit
│   ├── routes/      ← API routes
│   └── utils/       ← helpers
├── schema/
│   └── schema.sql   ← D1 database schema
├── .github/
│   └── workflows/
│       └── deploy.yml  ← Auto-deploy on git push
├── .dev.vars.example   ← Copy to .dev.vars for local dev
├── wrangler.toml       ← Cloudflare config
└── package.json
```

---

## First Time Setup

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/heelsup.git
cd heelsup
npm install
```

### 2. Setup .dev.vars (local development)
```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and fill in your values
```

### 3. Create Cloudflare resources (one time only)
```bash
npx wrangler login
npx wrangler d1 create heelsup-live
# Copy the database_id to wrangler.toml

npx wrangler r2 bucket create heelsup-media
npx wrangler kv namespace create heelsup-kv
# Copy the KV id to wrangler.toml
```

### 4. Run database schema
```bash
npx wrangler d1 execute heelsup-live --file=./schema/schema.sql
```

### 5. Set production secrets
```bash
npx wrangler secret put JWT_SECRET         # 64+ char random string
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put ADMIN_BOOTSTRAP_PASSWORD
```

### 6. Local development server
```bash
npx wrangler dev src/index.js --local
# Open http://localhost:8787
```

### 7. Deploy to production
```bash
npx wrangler deploy
```

---

## Auto-Deploy (GitHub Actions)

Push to `main` branch automatically deploys to Cloudflare.

Add this secret in GitHub → Settings → Secrets:
- `CLOUDFLARE_API_TOKEN` — from Cloudflare Dashboard → API Tokens

---

## Documentation

Detailed references are available in the `docs` directory:
* **[API Reference](file:///c:/Users/Cyrix%20HealthCare/Desktop/heelsup/docs/API.md)**: Specifications for auth, checkout, cart, payment, brands, and reviews endpoints.
* **[Deployment & Configuration Guide](file:///c:/Users/Cyrix%20HealthCare/Desktop/heelsup/docs/DEPLOYMENT.md)**: Full steps for D1 database, KV storage, R2 buckets, environment variables, and Cloudflare Pages setup.

---

## Key Enterprise Features (v2.0)
* **Dual Checkout Flow**: Seamless integration of Razorpay payment verification and Cash on Delivery (COD).
* **Super Admin Dashboard**: Full product, category, brand, review, settings, sitemap, and coupon controls from the frontend without modifying code.
* **Dynamic Brand Entity**: Complete database support and custom admin interface at `admin-brands.html`.
* **Robust Edge Caching**: Advanced TTL cache structures on the Cloudflare Worker, lowering D1 query latency.
* **PWA & Offline Support**: Client-side localStorage synchronizations and background cart updates with Service Workers.
