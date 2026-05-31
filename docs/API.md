# HeelsUp — API Reference Manual

This is the definitive guide for HeelsUp's production API endpoints. The API is hosted on Cloudflare Workers and interacts with D1 (SQLite) and KV.

## Base URL
All API requests should be sent to the current origin under the `/api` prefix:
`https://<your-domain>.in/api`

---

## 1. Authentication & Profiles (`/api/auth`)

### POST `/api/auth/register`
Create a new customer account.
* **Payload**:
  ```json
  {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "9876543210",
    "password": "securepassword123"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "message": "User registered successfully",
    "token": "jwt_session_token_here",
    "user": {
      "id": 1,
      "email": "john.doe@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "customer"
    }
  }
  ```

### POST `/api/auth/login`
Authenticate user session. Returns `otp_required` if 2FA (for Admin/Staff roles) is active.
* **Payload**:
  ```json
  {
    "email": "admin@heelsup.in",
    "password": "adminsecretpassword"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "step": "otp_required",
    "session_token": "temp_session_token_for_otp"
  }
  ```
  *Or directly on success (for customers without 2FA)*:
  ```json
  {
    "token": "jwt_session_token",
    "user": {
      "id": 1,
      "email": "customer@example.com",
      "firstName": "Jane",
      "role": "customer"
    }
  }
  ```

### POST `/api/auth/admin-verify-otp`
Verify admin 2FA OTP.
* **Payload**:
  ```json
  {
    "session_token": "temp_session_token_for_otp",
    "otp": "123456"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "token": "jwt_session_token_here",
    "user": {
      "id": 1,
      "email": "admin@heelsup.in",
      "firstName": "Admin",
      "role": "admin"
    }
  }
  ```

### Address Management

#### GET `/api/auth/addresses`
List all user shipping addresses. (Requires Auth)

#### POST `/api/auth/addresses`
Create a new address. (Requires Auth)
* **Payload**:
  ```json
  {
    "label": "Home",
    "name": "John Doe",
    "phone": "9876543210",
    "line1": "123 Main St",
    "line2": "Apt 4B",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001",
    "country": "India"
  }
  ```

#### PUT `/api/auth/addresses/:id`
Update an address record. (Requires Auth)

#### PUT `/api/auth/addresses/:id/default`
Set target address as the default selection. (Requires Auth)

#### DELETE `/api/auth/addresses/:id`
Remove target address. (Requires Auth)

---

## 2. Product Catalogue (`/api/products`)

### GET `/api/products`
Fetch a paginated list of active products. Supports sorting & filtering.
* **Query Parameters**:
  * `page` (default: 1)
  * `limit` (default: 12)
  * `cat` (Category Name filter)
  * `brand` (Brand name filter)
  * `min_price`, `max_price` (Price range)
  * `sort` (`newest`, `oldest`, `price_asc`, `price_desc`, `sales_desc`)

### GET `/api/products/:id`
Fetch single product details including sizes, inventory levels, and approved reviews.

### GET `/api/products/slug/:slug`
Fetch single product by its URL-friendly slug.

### GET `/api/products/search?q=query`
Perform Full-Text Search. Returns matching products.

### GET `/api/products/featured`
Returns featured products (limit: 8).

### GET `/api/products/new-arrivals`
Returns new arrivals (limit: 12).

### GET `/api/products/trending`
Returns trending items (limit: 12).

### GET `/api/products/categories`
Returns distinct categories along with product counts.

### POST `/api/products/bulk`
Bulk upload products from CSV parsing. (Admin Only)
* **Payload**:
  ```json
  {
    "products": [
      {
        "name": "Red Velvet Heels",
        "sku": "HU-RED-VELVET",
        "category": "Heels",
        "price": 1299,
        "mrp": 1999,
        "stock": 40,
        "is_active": 1
      }
    ]
  }
  ```

---

## 3. Brands (`/api/brands`)

### GET `/api/brands`
List active brands (sorted by sort_order).

### GET `/api/brands?all=true`
List all brands including inactive ones. (Requires Admin Auth)

### POST `/api/brands`
Create a brand. (Requires Admin Auth)
* **Payload**:
  ```json
  {
    "name": "Gucci",
    "description": "Premium luxury fashion",
    "logo_url": "https://media.heelsup.in/logos/gucci.png",
    "sort_order": 1,
    "is_active": 1
  }
  ```

---

## 4. Shopping Cart (`/api/cart`)

### GET `/api/cart`
Retrieve the synchronized database cart for authenticated users.

### POST `/api/cart/sync`
Synchronize the local storage cart state to the server.
* **Payload**:
  ```json
  {
    "items": [
      {
        "productId": 5,
        "size": "38",
        "qty": 2
      }
    ]
  }
  ```

---

## 5. Orders & Checkouts (`/api/orders`)

### POST `/api/orders/initiate`
Initiate online checkout. Generates a pending draft order in KV and a Razorpay Order ID.
* **Payload**:
  ```json
  {
    "customer": {
      "name": "John Doe",
      "email": "john.doe@example.com",
      "phone": "9876543210",
      "addressLine1": "123 St",
      "city": "Mumbai",
      "state": "MH",
      "pincode": "400001"
    },
    "items": [
      { "productId": 5, "name": "Stilettos", "price": 999, "qty": 1, "size": "38" }
    ],
    "deliveryMethod": "standard",
    "couponCode": "WELCOME10"
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "order_number": "HU-20260531-0001-9238",
    "razorpayOrder": {
      "id": "order_OkDjf83Kj",
      "amount": 99900
    }
  }
  ```

### POST `/api/orders/cod`
Place a Cash on Delivery (COD) order. Deducts stock immediately.
* **Payload**: Same as `/initiate`.
* **Response**:
  ```json
  {
    "success": true,
    "order_number": "HU-20260531-0001-9238",
    "order_id": 15,
    "message": "Order placed successfully"
  }
  ```

---

## 6. Payments (`/api/payment`)

### POST `/api/payment/verify`
Verify Razorpay signature and generate definitive D1 order records.
* **Payload**:
  ```json
  {
    "razorpay_order_id": "order_OkDjf83Kj",
    "razorpay_payment_id": "pay_OlkSdf839",
    "razorpay_signature": "signature_hex_code"
  }
  ```

### POST `/api/payment/refund`
Process a Razorpay payment refund (full or partial). (Admin Only)
* **Payload**:
  ```json
  {
    "order_id": 15,
    "amount": 500
  }
  ```

### GET `/api/payment/transactions`
List paginated transaction logs. (Admin Only)

---

## 7. Product Reviews (`/api/reviews`)

### GET `/api/reviews?product_id=X`
Fetch approved reviews for a product with breakdown score distributions.

### POST `/api/reviews`
Submit a new review (starts as `draft` pending approval). (Requires Auth)

### POST `/api/reviews/:id/helpful`
Increment review helpful count.

---

## 8. Coupons (`/api/coupons`)

### POST `/api/coupons/validate`
Validate a discount coupon code against cart value.
* **Payload**:
  ```json
  {
    "code": "SUPER10",
    "amount": 1200
  }
  ```
* **Response**:
  ```json
  {
    "valid": true,
    "discount": 120,
    "type": "percent",
    "value": 10
  }
  ```
