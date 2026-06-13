# Architecture & Technical Design

**Project:** Clover Payment Integration  
**Author:** Arundhati Rajendra  
**Stack:** Node.js · Express · Vanilla JS · Clover REST API · OAuth2  

---

## Problem Statement

Payment integrations are deceptively complex. The surface requirement is simple — "accept a payment" — but the implementation involves authentication flows, API orchestration, error recovery, security boundaries, and audit trails. This document explains every architectural decision made, the tradeoffs considered, and how this system would evolve in production.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  BROWSER (Frontend)                                               │
│                                                                   │
│  index.html            style.css           app.js                │
│  ─────────────         ─────────           ──────────────────    │
│  Payment form UI       Styling             OAuth redirect +       │
│  3 screens:                                fetch logic            │
│  • Connect                                                        │
│  • Pay                                                            │
│  • Result                                                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP (never calls Clover directly)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  NODE.JS + EXPRESS (Backend)                                      │
│                                                                   │
│  server.js                      cloverClient.js                  │
│  ─────────────────              ────────────────────             │
│  Routing + orchestration        Clover API layer                 │
│  ├── GET  /auth                 ├── createOrder()                │
│  ├── GET  /oauth/callback       ├── addLineItem()                │
│  ├── GET  /api/auth-status      ├── getTenders()                 │
│  ├── POST /api/pay              ├── payForOrder()                │
│  └── GET  /api/transactions     └── getPaymentStatus()           │
│                                                                   │
│  transactions.log               .env                             │
│  ──────────────────             ────                             │
│  Append-only audit trail        Secrets (never committed)        │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  CLOVER SANDBOX API                                               │
│                                                                   │
│  OAuth2 Server                  REST Payment API                 │
│  ───────────────                ─────────────────────────────    │
│  /oauth/v2/authorize            /v3/merchants/{mId}/             │
│  /oauth/v2/token                  ├── orders                     │
│                                   ├── orders/{id}/line_items     │
│                                   ├── tenders                    │
│                                   ├── orders/{id}/payments       │
│                                   └── payments/{id}              │
└──────────────────────────────────────────────────────────────────┘
```

**The most important design rule:** The frontend never calls Clover directly. Every request goes through our backend. This keeps credentials server-side and gives us a single place to handle errors, logging, and validation.

---

## OAuth2 Flow

```
User              Frontend            Backend                Clover
  │                   │                   │                     │
  │  1. Click         │                   │                     │
  │  "Connect"        │                   │                     │
  │──────────────────▶│                   │                     │
  │                   │  GET /auth        │                     │
  │                   │──────────────────▶│                     │
  │                   │                   │  Redirect to        │
  │                   │                   │  /oauth/v2/authorize│
  │                   │                   │────────────────────▶│
  │◀──────────────────────────────────────────────────────────-│
  │  2. Clover login page shown to user                         │
  │                   │                   │                     │
  │  3. User logs in  │                   │                     │
  │  + selects        │                   │                     │
  │  merchant         │                   │                     │
  │────────────────────────────────────────────────────────────▶│
  │                   │                   │                     │
  │                   │                   │◀────────────────────│
  │                   │                   │  4. ?code=XXXX      │
  │                   │                   │  (one-time code)    │
  │                   │                   │                     │
  │                   │                   │  POST /oauth/v2/token
  │                   │                   │────────────────────▶│
  │                   │                   │◀────────────────────│
  │                   │                   │  5. access_token    │
  │                   │                   │  (stored in memory) │
  │                   │◀──────────────────│                     │
  │                   │  6. Redirect      │                     │
  │                   │  /?auth=success   │                     │
  │◀──────────────────│                   │                     │
  │  7. Payment form  │                   │                     │
  │  unlocks          │                   │                     │
```

**Why authorization code flow and not implicit flow?**
The implicit flow sends the token directly to the browser — simpler but insecure. The authorization code flow sends a one-time code that only the backend can exchange for a token. The `client_secret` never leaves the server.

---

## Payment Sequence

```
User enters amount + description → clicks Pay
                │
                ▼
    ┌───────────────────────┐
    │   Frontend Validation  │
    │   • amount > 0         │
    │   • description filled │
    └───────────┬───────────┘
                │
                ▼ POST /api/pay
    ┌───────────────────────┐
    │   Backend Validation   │
    │   • amount > 0         │
    │   • description filled │
    │   • token exists       │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────────────────────┐
    │  Step 1: createOrder()                 │
    │  POST /v3/merchants/{mId}/orders       │
    │  → Clover creates an order container   │
    │  ← returns { id: orderId }             │
    └───────────────────┬───────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────────────────┐
    │  Step 2: addLineItem()                            │
    │  POST /v3/merchants/{mId}/orders/{id}/line_items  │
    │  { name: "Test Product", price: 1000 }  ← cents  │
    │  → adds what was purchased to the order           │
    └───────────────────┬──────────────────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────────────┐
    │  Step 3: getTenders()                         │
    │  GET /v3/merchants/{mId}/tenders              │
    │  → fetch available payment methods            │
    │  → select external_payment tender dynamically │
    └───────────────────┬──────────────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────────────────────┐
    │  Step 4: payForOrder()                                │
    │  POST /v3/merchants/{mId}/orders/{id}/payments        │
    │  { amount: 1000, tender: { id: tenderId } }           │
    │  → processes the payment                              │
    │  ← returns { id: paymentId }                          │
    └───────────────────┬──────────────────────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────────────┐
    │  Step 5: getPaymentStatus()                   │
    │  GET /v3/merchants/{mId}/payments/{paymentId} │
    │  → confirms final payment result              │
    │  ← returns { result: "SUCCESS" }              │
    └───────────────────┬──────────────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────────────┐
    │  Step 6: logTransaction()                     │
    │  Append to transactions.log                   │
    │  { orderId, paymentId, amount, result,        │
    │    description, timestamp }                   │
    └───────────────────┬──────────────────────────┘
                        │
                        ▼
            Return to frontend:
    { success, orderId, paymentId, amount, result }
                        │
                        ▼
            Display to user:
    ✓ green card (SUCCESS) or ✗ red card (FAILURE)
```

---

## Technology Decisions

### Why Node.js + Express

This app is an **I/O-bound API proxy**. It receives a request, makes sequential calls to Clover, and returns a result. It doesn't do heavy computation.

Node.js is purpose-built for this pattern:

| Factor | Node.js | Python | Java/Spring Boot |
|--------|---------|--------|-----------------|
| I/O model | Non-blocking, event-driven | Blocking by default | Thread-per-request |
| JSON handling | Native | Native | Jackson library |
| Setup time | ~2 minutes | ~5 minutes | ~15 minutes |
| Best for | API proxying, I/O | Data processing | Enterprise systems |
| Async syntax | async/await native | asyncio (added later) | CompletableFuture |

**What I gave up:** Node.js is not ideal for CPU-intensive work. If this app needed to process large datasets or do heavy computation, Python or Java would be better choices.

### Why Vanilla JavaScript over React

| Factor | Vanilla JS | React |
|--------|-----------|-------|
| Build tools | None — open browser and run | Requires Node, npm, build step |
| Evaluator setup | Zero friction | Multiple steps |
| App complexity | 3 screens, 1 form | 3 screens, 1 form |
| Assignment spec | "HTML/CSS + basic JS" | Over-engineered |
| Bundle size | ~5KB | ~150KB+ |

**What I gave up:** React's component model and state management would be valuable if this UI grew. For a 3-screen app it adds complexity without benefit.

### Why Axios over Native Fetch

```javascript
// fetch — silent failure on 4xx/5xx
const res = await fetch('/api/pay', options);
if (!res.ok) throw new Error('failed'); // you must check manually every time

// axios — throws automatically on error responses
const res = await axios.post('/api/pay', data); // 4xx/5xx throws immediately
```

**Additional benefit:** Axios supports request/response interceptors. In production, a single interceptor can handle token refresh automatically across all API calls — no per-call logic needed.

### Why cloverClient.js is separate from server.js

This is the most important structural decision in the codebase.

```javascript
// WITHOUT separation — business logic buried in API details
app.post('/api/pay', async (req, res) => {
  const orderRes = await axios.post(
    `https://sandbox.dev.clover.com/v3/merchants/ABC123/orders`,
    {}, { headers: { Authorization: `Bearer ${token}` } }
  );
  const lineItemRes = await axios.post(
    `https://sandbox.dev.clover.com/v3/merchants/ABC123/orders/${orderRes.data.id}/line_items`,
    { name: desc, price: amt },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  // ... 50 more lines of this
});

// WITH separation — clean orchestration
app.post('/api/pay', async (req, res) => {
  const order = await createOrder(accessToken);
  await addLineItem(accessToken, order.id, description, amountInCents);
  const payment = await payForOrder(accessToken, order.id, amountInCents);
  const status = await getPaymentStatus(accessToken, order.id, payment.id);
});
```

**Benefits:**
- `cloverClient.js` can be unit tested by mocking Axios — no real API calls needed
- Switching from Clover to Stripe only requires changing `cloverClient.js`
- `server.js` reads as a business flow, not an API implementation

---

## Security Design

### The security boundary

```
What the browser knows:          What only the backend knows:
────────────────────────         ────────────────────────────
authenticated: true/false        CLOVER_CLIENT_SECRET
orderId                          access_token
paymentId                        CLOVER_MERCHANT_ID
result: SUCCESS/FAIL
amount
description
```

**The rule:** Sensitive values never cross the backend boundary. The frontend calls our `/api/pay` endpoint. Our backend calls Clover. The browser never touches Clover directly.

### Defense in depth — validation on two layers

```
Frontend validates → catches user mistakes early, fast feedback
Backend validates  → catches malicious requests that bypass UI
```

Both layers check: amount > 0, description not empty. The backend additionally checks token existence.

### Credentials never enter version control

```
Committed to Git:          Never committed:
─────────────────          ────────────────
.env.example               .env
README.md                  transactions.log
ARCHITECTURE.md            node_modules/
package.json
```

`.env.example` documents what's needed without exposing real values.

### Token expiry — automatic recovery

```javascript
catch (error) {
  if (error.response?.status === 401) {
    accessToken = null;           // clear invalid token
    return res.status(401).json({ // tell frontend to re-auth
      error: 'Session expired. Please login again.'
    });
  }
}
```

No manual intervention needed. The UI shows a clear message and the user re-authenticates.

---

## Challenges & How They Were Solved

### Challenge 1 — Sandbox rejects native card tenders

**Error:**
```
"We currently don't allow you to add native credit or debit payments,
please use an external tender type such as 'external payment'"
```

**First instinct:** Hardcode `com.clover.tender.external_payment` as the tender type.

**Problem with that:** The tender object requires an `id` field — not just a label. The ID is different per merchant.

**Solution:** Fetch the merchant's tenders dynamically and find the right one:

```javascript
const tendersData = await getTenders(accessToken);
const externalTender = tendersData.elements.find(
  t => t.labelKey === 'com.clover.tender.external_payment'
) || tendersData.elements[0];
```

**Why this is better:** Works correctly for any merchant in both sandbox and production — not just our test merchant.

### Challenge 2 — Wrong endpoint for payment status

**Error:** `405 GET not allowed`

**Root cause:** Used the order-scoped URL pattern:
```
GET /v3/merchants/{mId}/orders/{orderId}/payments/{paymentId}  ← wrong
```

**Solution:** Use the standalone payments endpoint:
```
GET /v3/merchants/{mId}/payments/{paymentId}  ← correct
```

**Lesson:** Clover's API has both collection endpoints (scoped to an order) and resource endpoints (standalone). Always verify which HTTP methods each supports.

### Challenge 3 — OAuth v2 token exchange format

Clover's v2 OAuth token exchange requires credentials in the **request body** — not as query parameters or Basic Auth headers like some other OAuth implementations.

```javascript
// Wrong — query parameters
POST /oauth/v2/token?client_id=X&client_secret=Y&code=Z

// Correct — request body
POST /oauth/v2/token
{ client_id: X, client_secret: Y, code: Z }
```

---

## Our Backend API

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/auth` | Initiates OAuth2 redirect to Clover | No |
| GET | `/oauth/callback` | Exchanges auth code for access token | No |
| GET | `/api/auth-status` | Returns `{ authenticated: true/false }` | No |
| POST | `/api/pay` | Full payment flow — order, line item, payment | Yes |
| GET | `/api/transactions` | Transaction history from local log | No |

---

## Clover API Calls

| # | Method | Clover Endpoint | Purpose |
|---|--------|----------------|---------|
| 1 | GET | `/oauth/v2/authorize` | Start OAuth flow |
| 2 | POST | `/oauth/v2/token` | Exchange code for access token |
| 3 | POST | `/v3/merchants/{mId}/orders` | Create order |
| 4 | POST | `/v3/merchants/{mId}/orders/{id}/line_items` | Add line item |
| 5 | GET | `/v3/merchants/{mId}/tenders` | Fetch payment methods |
| 6 | POST | `/v3/merchants/{mId}/orders/{id}/payments` | Process payment |
| 7 | GET | `/v3/merchants/{mId}/payments/{id}` | Get payment status |

---

## Production Roadmap

### What needs to change before this goes to production

**1. Persistent token storage**

Current implementation stores the token in server memory. A server restart loses authentication.

```javascript
// Current — lost on restart
let accessToken = null;

// Production — persisted per merchant
await db.tokens.upsert({
  merchantId,
  accessToken: encrypt(access_token),
  refreshToken: encrypt(refresh_token),
  expiresAt: Date.now() + (expires_in * 1000)
});
```

**2. Automatic token refresh**

Current implementation requires the user to re-authenticate when a token expires. Production should handle this transparently.

```javascript
async function getValidToken(merchantId) {
  const stored = await db.tokens.findOne({ merchantId });
  if (stored.expiresAt < Date.now()) {
    return await refreshAccessToken(stored.refreshToken);
  }
  return stored.accessToken;
}
```

**3. Rate limiting**

Without rate limiting, the `/api/pay` endpoint can be abused.

```javascript
const rateLimit = require('express-rate-limit');
app.use('/api/pay', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many payment requests. Please try again later.'
}));
```

**4. Idempotency keys**

Prevent duplicate payments if the user double-clicks or a network retry occurs.

```javascript
app.post('/api/pay', async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  const existing = await db.payments.findOne({ idempotencyKey });
  if (existing) return res.json(existing); // return cached result
  // proceed with payment...
});
```

**5. Webhook support**

Instead of polling for payment status synchronously, register a Clover webhook for real-time notifications.

```javascript
app.post('/webhooks/clover', (req, res) => {
  const { type, data } = req.body;
  if (type === 'PAYMENT_PROCESSED') {
    updateTransactionStatus(data.paymentId, data.result);
  }
  res.sendStatus(200);
});
```

**6. Structured logging and observability**

```javascript
// Current — console.log
console.log('Payment processed:', payment.id);

// Production — structured with correlation ID
logger.info({
  event: 'payment_processed',
  traceId: req.headers['x-trace-id'],
  orderId: order.id,
  paymentId: payment.id,
  amount: amountInCents,
  durationMs: Date.now() - startTime
});
```

---

## Scale Considerations

| Concern | Current Approach | At Scale |
|---------|-----------------|----------|
| Token storage | Server memory | Redis or encrypted PostgreSQL |
| Transaction log | Append-only flat file | PostgreSQL with indexes + query API |
| Concurrency | Single Node.js process | PM2 cluster or Kubernetes pods |
| API calls | Sequential (6 calls per payment) | Parallelize order creation + tender fetch |
| Auth | Single merchant | Multi-tenant — token per merchant ID |
| Reliability | No retries | Exponential backoff on Clover API failures |
| Security | HTTPS via hosting | WAF + DDoS protection + fraud detection |
| Monitoring | Console logs | Datadog / New Relic with payment SLA alerts |

---

## What I Would Do Differently With More Time

1. **Unit tests for cloverClient.js** — mock Axios responses and test each function in isolation
2. **Integration tests** — test the full payment flow against Clover sandbox automatically
3. **Docker containerization** — `docker-compose up` instead of manual setup
4. **Environment-specific configs** — separate sandbox and production configurations
5. **OpenAPI/Swagger documentation** — auto-generated API docs from route definitions
6. **Frontend transaction history page** — display `GET /api/transactions` results in the UI