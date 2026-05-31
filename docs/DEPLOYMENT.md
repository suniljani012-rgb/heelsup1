# HeelsUp — Deployment & Configuration Guide

HeelsUp is built on Cloudflare edge-first architecture. This document guides you through local setup, database provisioning, environment configurations, and production deployment.

---

## 1. Prerequisites
You need Node.js (version 18+) installed globally along with Wrangler, Cloudflare's CLI tool:
```bash
npm install -g wrangler
```
Authenticate Wrangler with your Cloudflare account:
```bash
wrangler login
```

---

## 2. Setting Up Cloudflare Resources

To deploy HeelsUp, you need to provision D1 SQL databases, R2 storage buckets, and KV namespaces.

### Step 2.1: Create D1 SQL Database
Run the following command to create the D1 database instance:
```bash
wrangler d1 create heelsup-live
```
**Important**: Copy the outputted `database_id` and replace the placeholder inside your `wrangler.toml` file:
```toml
[[d1_databases]]
binding = "DB"
database_name = "heelsup-live"
database_id = "your-copied-uuid-here"
```

### Step 2.2: Create R2 Bucket
Provision the R2 storage bucket for media assets (product images, brands logos, avatars):
```bash
wrangler r2 bucket create heelsup-media
```

### Step 2.3: Create KV Namespace
Provision the KV namespace for caching session tables and checkout order drafts:
```bash
wrangler kv:namespace create KV
```
Copy the namespace `id` and replace the binding details in `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "KV"
id = "your-copied-kv-id-here"
```

---

## 3. Database Initialization

Once resources are bound, initialize your database tables.

### Local Development Database Initialization
Initialize local D1 tables:
```bash
wrangler d1 execute heelsup-live --local --file=schema/schema.sql
```

### Production (Remote) Database Initialization
Push the definitive schema to your live production instance:
```bash
wrangler d1 execute heelsup-live --remote --file=schema/schema.sql
```

### Applying Additive Migrations (Safe Upgrade)
If you have an existing heelsup database and wish to safely upgrade it to version 2.0 without losing data, execute the additive migration file:
```bash
wrangler d1 execute heelsup-live --remote --file=schema/migration_001.sql
```

---

## 4. Configuring Secret Environment Variables

Sensitive keys must be stored securely inside Cloudflare Secrets. Run these commands and enter the keys when prompted:

```bash
# JWT encryption key (must be a strong, random key)
wrangler secret put JWT_SECRET

# Razorpay Checkout Credentials
wrangler secret put RAZORPAY_KEY_ID
wrangler secret put RAZORPAY_KEY_SECRET
wrangler secret put RAZORPAY_WEBHOOK_SECRET

# Email integration via Resend (Optional for OTP)
wrangler secret put RESEND_API_KEY
```

---

## 5. Local Development Server

Run HeelsUp locally to verify changes. The local server emulates all Cloudflare bindings (D1, KV, R2) locally:
```bash
npm run dev
```
Open [http://localhost:8787](http://localhost:8787) in your browser.

---

## 6. Deploying to Production

Deploy the static assets (the `public` folder) and the edge worker script to Cloudflare CDN:
```bash
npm run deploy
```
The console will output your live URL (e.g., `https://heelsupnew.heelsup.workers.dev`). Configure your custom domain inside the Cloudflare Workers dashboard.
