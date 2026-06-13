# Clover Payment Integration

A web-based checkout application that integrates with the [Clover REST API](https://docs.clover.com/dev/reference/api-reference-overview) to process payments.

Users authenticate via OAuth2, enter a payment amount and description, and initiate a transaction — all through a clean browser interface backed by a Node.js server.

---

## Requirements Covered

| Requirement | Details | Status |
|-------------|---------|--------|
| OAuth2 authentication | Full authorization code flow — redirect, code exchange, token storage | ✅ |
| Create order | `POST /v3/merchants/{mId}/orders` | ✅ |
| Add line item | Product name + price added to order | ✅ |
| Initiate payment | Processed via Clover payments API | ✅ |
| Display payment status | Success or failure shown in UI with order ID and payment ID | ✅ |
| Log transactions locally | Every payment appended to `transactions.log` with timestamp | ✅ |
| Frontend UI *(optional — implemented)* | Amount field, description field, submit button, result screen | ✅ |
| Error handling — failed requests | Input validation + Clover API error handling | ✅ |
| Error handling — expired tokens | Token cleared automatically, user prompted to re-authenticate | ✅ |
| Postman collection | All 4 endpoints documented and ready to test | ✅ |

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Node.js + Express | Best fit for API proxying — non-blocking I/O, native JSON, fast setup |
| Frontend | HTML + CSS + Vanilla JS | Assignment specifies basic JS. No build tools — runs on any machine instantly |
| HTTP Client | Axios | Auto-throws on 4xx/5xx errors unlike fetch. Cleaner header management |
| Authentication | OAuth2 v2 (full code flow) | Proper implementation — secrets never reach the browser |
| Config | dotenv | Industry standard. `.env.example` documents all required variables |
| Logging | Node.js `fs` module | Zero dependencies. Directly meets "log transaction details locally" requirement |

---

## Project Structure

```
clover-payment-integration/
│
├── backend/
│   ├── server.js         # Express server — all routes and payment orchestration
│   ├── cloverClient.js   # Every Clover API call isolated here — testable and swappable
│   ├── .env.example      # Environment variable template
│   └── package.json
│
├── frontend/
│   ├── index.html        # Payment form UI
│   ├── style.css         # Styling
│   └── app.js            # OAuth redirect handling + payment fetch logic
│
├── postman/
│   └── Clover_Payment_Integration.postman_collection.json
│
├── screenshots/          # UI screenshots and architecture diagrams
├── ARCHITECTURE.md       # Technical decisions, security design, production roadmap
└── README.md
```

> **Key design decision:** All Clover API calls live in `cloverClient.js` — completely separate from routing logic in `server.js`. This makes the API layer independently testable and easy to swap out.

---

## Getting Started

### Prerequisites

- Node.js v18+
- A [Clover sandbox account](https://www.clover.com/global-developer-home/public/create-account)
- Postman

> **Note for evaluators:** Sandbox credentials are provided in the submission email so you can run this without creating a Clover account.

### 1. Clone and install

```bash
git clone https://github.com/ArundhatiCat/clover-payment-integration.git
cd clover-payment-integration/backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```env
CLOVER_BASE_URL=https://sandbox.dev.clover.com
CLOVER_MERCHANT_ID=your_merchant_id
CLOVER_CLIENT_ID=your_client_id
CLOVER_CLIENT_SECRET=your_client_secret
PORT=3000
```

### 3. Clover sandbox setup

In the [Clover Developer Dashboard](https://www.clover.com/global-developer-home):

1. Create a new **Web** app
2. Set **Site URL** to `http://localhost:3000`
3. Set **Alternate Launch Path** to `/oauth/callback`
4. Enable permissions: Payments (R/W), Orders (W), Inventory (W), Merchant (R)
5. Create a test merchant and install the app on it

### 4. Run

```bash
node server.js
```

Open `http://localhost:3000` in your browser.

---

## How OAuth2 Works in This App

This app implements the full OAuth2 authorization code flow — the standard way to securely connect a third-party app to a merchant's Clover account without exposing credentials.

```
1. User clicks "Connect with Clover"
2. Browser redirects to Clover's login page
3. User logs in and selects their merchant account
4. Clover redirects back to /oauth/callback with a one-time authorization code
5. Backend exchanges the code for an access token via POST /oauth/v2/token
6. Token stored securely in server memory
7. All subsequent Clover API calls use this token
```

The `client_secret` and `access_token` never reach the browser — they exist only on the backend.

---

## Payment Flow

Each payment triggers 5 sequential Clover API calls:

```
1. POST /v3/merchants/{mId}/orders
   → Create an order

2. POST /v3/merchants/{mId}/orders/{orderId}/line_items
   → Add the product name and price in cents

3. GET  /v3/merchants/{mId}/tenders
   → Fetch available payment methods for this merchant

4. POST /v3/merchants/{mId}/orders/{orderId}/payments
   → Process the payment

5. GET  /v3/merchants/{mId}/payments/{paymentId}
   → Confirm the final payment status
```

---

## API Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/auth` | Starts the OAuth2 flow — redirects to Clover login | No |
| GET | `/oauth/callback` | Receives auth code, exchanges for access token | No |
| GET | `/api/auth-status` | Returns `{ authenticated: true/false }` | No |
| POST | `/api/pay` | Processes a payment | Yes |

### POST /api/pay

**Request:**
```json
{
  "amount": 10.00,
  "description": "Test Product"
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "JJ677Z59K139Y",
  "paymentId": "ZMFG1D73340AP",
  "amount": 10,
  "description": "Test Product",
  "result": "SUCCESS"
}
```

---

## Error Handling

| Scenario | HTTP Status | Message |
|----------|-------------|---------|
| Amount missing or zero | 400 | Invalid amount. Please enter a valid amount |
| Description empty | 400 | Description is required |
| Not authenticated | 401 | Not authenticated. Please login with Clover first |
| Token expired | 401 | Session expired. Please login again |
| Clover API error | 500 | Error details returned from Clover |

When a token expires, it is cleared from memory automatically and the user is prompted to re-authenticate — no manual intervention needed.

---

## Transaction Logging

Every payment attempt — successful or failed — is appended to `backend/transactions.log`:

```
2026-06-13T02:34:21.000Z - {"orderId":"JJ677Z59K139Y","paymentId":"ZMFG1D73340AP","amount":1000,"description":"Test Product","result":"SUCCESS","timestamp":"2026-06-13T02:34:21.000Z"}
```

Each entry contains: timestamp, order ID, payment ID, amount in cents, description, and result.

---

## Testing with Postman

Import `postman/Clover_Payment_Integration.postman_collection.json`.

**Recommended test sequence:**

1. `GET /api/auth-status` — confirm `{ "authenticated": false }`
2. Open `http://localhost:3000` in browser — complete OAuth flow
3. `GET /api/auth-status` — confirm `{ "authenticated": true }`
4. `POST /api/pay` — process a test payment, confirm `{ "result": "SUCCESS" }`

---

## Screenshots

**Payment form:**

![Payment Form](./screenshots/01-payment-form.png)

**OAuth merchant selection:**

![OAuth Flow](./screenshots/02-oauth-flow.png)

**Payment form filled:**

![Payment Filled](./screenshots/03-payment-filled.png)

**Payment successful:**

![Payment Success](./screenshots/04-payment-success.png)

---

## Further Reading

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:

- System architecture diagram
- OAuth2 flow diagram
- Technology decision rationale
- Security design
- Challenges encountered and how they were solved
- Production improvement roadmap with code examples

---

## License

MIT