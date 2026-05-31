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

## API Routes

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/products
GET    /api/products/:id
GET    /api/categories
POST   /api/cart/sync
POST   /api/orders
POST   /api/payment/create-order
POST   /api/payment/verify
GET    /api/admin/dashboard     (admin only)
```

Full API docs: See each file in `src/routes/`

---

## Payment Setup

See `RAZORPAY_SETUP.md` for Razorpay integration guide.
