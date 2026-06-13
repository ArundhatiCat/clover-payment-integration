# Architecture & Technical Design

This document explains how the Clover Payment Integration is designed, why specific decisions were made, and how this system would evolve in a production environment.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER                                                         │
│                                                                  │
│  index.html          style.css           app.js                 │
│  (payment form)      (styling)           (OAuth + fetch logic)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  NODE.JS + EXPRESS (Backend)                                     │
│                                                                  │
│  server.js                    cloverClient.js                   │
│  ├── GET  /auth               ├── createOrder()                 │
│  ├── GET  /oauth/callback     ├── addLineItem()                 │
│  ├── POST /api/pay            ├── getTenders()                  │
│  └── GET  /api/auth-status    ├── payForOrder()                 │
│                               └── getPaymentStatus()            │
│                                                                  │
│  transactions.log             .env                              │
│  (local audit trail)          (secrets — never committed)       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLOVER SANDBOX API                                              │
│                                                                  │
│  OAuth2 Server               REST API                           │
│  /oauth/v2/authorize         /v3/merchants/{mId}/orders         │
│  /oauth/v2/token             /v3/merchants/{mId}/line_items     │
│                              /v3/merchants/{mId}/tenders        │
│                              /v3/merchants/{mId}/payments       │
└─────────────────────────────────────────────────────────────────┘
```

---

## OAuth2 Flow

```
User          Frontend        Backend              Clover
 │                │               │                   │
 │  Click Connect │               │                   │
 │───────────────▶│               │                   │
 │                │  GET /auth    │                   │
 │                │──────────────▶│                   │
 │                │               │  Redirect to      │
 │                │               │  /oauth/v2/authorize
 │                │               │──────────────────▶│
 │◀──────────────────────────────────────────────────│
 │  Clover login page shown                           │
 │                │               │                   │
 │  Log in + select merchant      │                   │
 │──────────────────────────────────────────────────▶│
 │                │               │                   │
 │                │               │◀──────────────────│
 │                │               │  ?code=XXXX       │
 │                │               │                   │
 │                │               │  POST /oauth/v2/token
 │                │               │──────────────────▶│
 │                │               │◀──────────────────│
 │                │               │  access_token     │
 │                │               │                   │
 │                │◀──────────────│                   │
 │                │  /?auth=success                   │
 │◀───────────────│               │                   │
 │  Payment form unlocks          │                   │
```

**Why this matters:** The `client_secret` and `access_token` never reach the browser. The frontend only knows "authenticated: true/false" — it never sees the actual credentials.

---

## Technology Decisions

### Node.js + Express

This app is an **API proxy** — it receives a request, calls Clover, and returns a result. Node.js is the best fit for this because:

- Non-blocking I/O handles concurrent requests without spawning threads
- Native JSON — no serialization libraries needed
- Express setup takes minutes vs Spring Boot's boilerplate
- The async/await pattern maps cleanly to sequential API calls (create order → add item → pay)

Python would also work. Java/Spring Boot is excellent for large enterprise systems but introduces unnecessary complexity for a focused integration like this.

### Vanilla JavaScript (not React)

Three reasons:

1. The assignment lists "HTML/CSS + basic JS" as the recommended frontend
2. This is a three-screen app — connect, pay, result. A component framework adds complexity without adding value
3. No build step means any evaluator can run it instantly — `node server.js` and open a browser

### Axios over Fetch

```javascript
// fetch — does NOT throw on 4xx/5xx
const res = await fetch('/api/pay', options);
if (!res.ok) throw new Error('failed'); // manual check required every time

// axios — throws automatically on error responses
const res = await axios.post('/api/pay', data); // throws on 4xx/5xx
```

Axios also makes it straightforward to add request interceptors later — useful for automatic token refresh in production.

### Full OAuth2 Code Flow (not API token shortcut)

There are two ways to "implement OAuth2":

| Approach | What it actually is | Correct? |
|----------|-------------------|---------|
| Paste token in .env and use it | Bypasses OAuth entirely | ❌ |
| Full redirect → code → token exchange | Real OAuth2 | ✅ |

This app does the real thing. The user is redirected to Clover's login, approves the app, and the backend exchanges the authorization code for a token. This is how OAuth2 is meant to work.

### Separating cloverClient.js from server.js

```javascript
// server.js — handles HTTP, validation, orchestration
app.post('/api/pay', async (req, res) => {
  const order = await createOrder(accessToken);
  await addLineItem(accessToken, order.id, description, amountInCents);
  const payment = await payForOrder(accessToken, order.id, amountInCents);
  const status = await getPaymentStatus(accessToken, order.id, payment.id);
});

// cloverClient.js — handles Clover API, nothing else
async function createOrder(accessToken) {
  return axios.post(`${BASE_URL}/v3/merchants/${MERCHANT_ID}/orders`, {}, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
```

This separation means:
- `cloverClient.js` can be unit tested by mocking Axios responses
- Switching payment providers only requires changing `cloverClient.js`
- `server.js` reads as business logic, not API implementation details

---

## Security Design

### Secrets never reach the browser

```
What the browser knows:        What the backend knows:
- authenticated: true/false    - client_secret
- orderId                      - access_token
- paymentId                    - merchant_id
- result: SUCCESS/FAIL
```

The frontend calls `/api/pay` — it never calls Clover directly.

### Credentials never enter version control

```
.gitignore
├── .env              ← real credentials
├── *.log             ← transaction data
└── node_modules/     ← dependencies
```

`.env.example` is committed — it documents what variables are needed without exposing values.

### Input validated on both layers

The frontend validates before sending. The backend validates independently before any API call. This prevents direct API abuse that bypasses the UI.

### Token expiry handled automatically

```javascript
if (error.response?.status === 401) {
  accessToken = null; // clear the expired token
  return res.status(401).json({ 
    error: 'Session expired. Please login again.' 
  });
}
```

---

## Challenges & How They Were Solved

### Challenge 1 — Sandbox rejects native card tenders

**Error received:**
```
"We currently don't allow you to add native credit or debit payments,
please use an external tender type such as 'external payment'"
```

**Solution:** Instead of hardcoding a tender type, the app fetches the merchant's available tenders dynamically via `GET /v3/merchants/{mId}/tenders` and selects the external payment tender. This makes the code correct in both sandbox and production.

```javascript
const tendersData = await getTenders(accessToken);
const externalTender = tendersData.elements.find(
  t => t.labelKey === 'com.clover.tender.external_payment'
) || tendersData.elements[0];
```

### Challenge 2 — Wrong payment status endpoint

**Error received:**
```
405 GET not allowed
```

**Root cause:** Used `/v3/merchants/{mId}/orders/{orderId}/payments/{paymentId}` — which doesn't support GET.

**Solution:** Corrected to the standalone payment endpoint: `GET /v3/merchants/{mId}/payments/{paymentId}`.

### Challenge 3 — OAuth token exchange format

Clover's v2 OAuth uses a different format than legacy OAuth. The token exchange requires `client_id`, `client_secret`, and `code` in the POST body — not as query parameters.

```javascript
const response = await axios.post(`${BASE_URL}/oauth/v2/token`, {
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  code: code,
});
```

---

## Production Roadmap

### Phase 1 — Persistent token storage

**Problem:** Token lives in memory. Server restart loses authentication.

```javascript
// Current
let accessToken = null;

// Production — store per merchant in database
await db.tokens.upsert({
  merchantId,
  accessToken: encrypt(access_token),
  refreshToken: encrypt(refresh_token),
  expiresAt: Date.now() + (expires_in * 1000)
});
```

### Phase 2 — Automatic token refresh

**Problem:** Expired tokens require user to manually re-authenticate.

```javascript
async function getValidToken(merchantId) {
  const stored = await db.tokens.findOne({ merchantId });
  if (stored.expiresAt < Date.now()) {
    return await refreshAccessToken(stored.refreshToken);
  }
  return stored.accessToken;
}
```

### Phase 3 — Rate limiting

```javascript
const rateLimit = require('express-rate-limit');
app.use('/api/pay', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many payment requests. Please try again later.'
}));
```

### Phase 4 — Webhook support

Instead of polling for payment status, register a Clover webhook to receive real-time notifications:

```javascript
app.post('/webhooks/clover', (req, res) => {
  const { type, data } = req.body;
  if (type === 'PAYMENT_PROCESSED') {
    updateTransactionStatus(data.paymentId, data.result);
  }
  res.sendStatus(200);
});
```

### Phase 5 — Observability

- Structured logging with correlation IDs (trace a single payment across all 5 API calls)
- Error alerting for payment failures above a threshold
- Dashboard for transaction volume, success rate, average processing time

---

## What Would Change at Scale

| Concern | Current approach | At scale |
|---------|-----------------|----------|
| Token storage | Server memory | Encrypted database per merchant |
| Transaction log | Flat file | PostgreSQL with indexes |
| Concurrency | Single process | Clustered with PM2 or containerized |
| API calls | Sequential | Parallelize order creation + tender fetch |
| Auth | Single merchant | Multi-tenant with per-merchant token management |
| Reliability | No retries | Exponential backoff on Clover API failures |

---

## API Calls Reference

| # | Method | Endpoint | Purpose |
|---|--------|----------|---------|
| 1 | GET | `/oauth/v2/authorize` | Start OAuth flow |
| 2 | POST | `/oauth/v2/token` | Exchange code for access token |
| 3 | POST | `/v3/merchants/{mId}/orders` | Create order |
| 4 | POST | `/v3/merchants/{mId}/orders/{id}/line_items` | Add line item |
| 5 | GET | `/v3/merchants/{mId}/tenders` | Fetch available payment methods |
| 6 | POST | `/v3/merchants/{mId}/orders/{id}/payments` | Process payment |
| 7 | GET | `/v3/merchants/{mId}/payments/{id}` | Get payment status |