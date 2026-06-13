# Evaluator Setup Guide

Everything is pre-configured. Follow these steps in order.

---

## Step 1 — Install dependencies

```bash
cd backend
npm install
```

---

## Step 2 — Start the server

```bash
npm start
```

You should see:
```
Server running on http://localhost:3000
```

---

## Step 3 — Open the app

Open your browser and go to:
```
http://localhost:3000
```

---

## Step 4 — Connect with Clover

1. Click **"Connect with Clover"** button
2. You will be redirected to Clover's login page
3. Log in with these credentials:

```
Email:    pathrikararundhati@gmail.com
Password: Aru12@google
```

4. After logging in select **"My Test Store"** as the merchant
5. You will be redirected back to the app — payment form unlocks

---

## Step 5 — Make a test payment

Enter:
- **Amount:** `10.00`
- **Description:** `Test Product`

Click **Pay Now**

You should see **✓ Payment Successful** with Order ID, Payment ID, and Status: SUCCESS

---

## Step 6 — Test with Postman

1. Open Postman
2. Click **Import**
3. Select file: `postman/Clover Payment Integration.postman_collection.json`

**Run requests in this order:**

| # | Request | Expected Result |
|---|---------|----------------|
| 1 | GET /api/auth-status | `{ "authenticated": false }` |
| 2 | Complete OAuth in browser (Steps 3-5) | — |
| 3 | GET /api/auth-status | `{ "authenticated": true }` |
| 4 | POST /api/pay | `{ "result": "SUCCESS" }` |
| 5 | GET /api/transactions | Full payment history |

---

## Step 7 — Run unit tests

```bash
npm test
```

Expected output:
```
✓ Amount validation — all cases pass
✓ Description validation — all cases pass
✓ Amount to cents conversion — all cases pass
✓ Authentication check — all cases pass

✅ All tests passed successfully
```

---

## Environment

The `.env` file is pre-configured with sandbox credentials — no changes needed.

---

## Further Reading

- `README.md` — full project documentation
- `ARCHITECTURE.md` — technical design decisions and production roadmap