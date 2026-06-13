require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createOrder, addLineItem, payForOrder, getPaymentStatus } = require('./cloverClient');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.CLOVER_BASE_URL;
const CLIENT_ID = process.env.CLOVER_CLIENT_ID;
const CLIENT_SECRET = process.env.CLOVER_CLIENT_SECRET;

// Store access token in memory
let accessToken = null;

// Helper function to log transactions locally
function logTransaction(data) {
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(path.join(__dirname, 'transactions.log'), logEntry);
}

// Step 1: OAuth - redirect to Clover login
app.get('/auth', (req, res) => {
  const authUrl = `${BASE_URL}/oauth/v2/authorize?client_id=${CLIENT_ID}&redirect_uri=http://localhost:3000/oauth/callback`;
  res.redirect(authUrl);
});

// Step 2: OAuth callback - exchange code for token
app.get('/oauth/callback', async (req, res) => {
  const { code, merchant_id } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/oauth/v2/token`,
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
      }
    );

    accessToken = response.data.access_token;
    console.log('Access token received successfully');

    // Redirect to frontend after successful auth
    res.redirect('/?auth=success');
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.redirect('/?auth=error');
  }
});

// Step 3: Process payment
app.post('/api/pay', async (req, res) => {
  const { amount, description } = req.body;

  // Input validation
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount. Please enter a valid amount.' });
  }

  if (!description || description.trim() === '') {
    return res.status(400).json({ error: 'Description is required.' });
  }

  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated. Please login with Clover first.' });
  }

  try {
    // Convert dollars to cents
    const amountInCents = Math.round(amount * 100);

    // Create order
    const order = await createOrder(accessToken);
    console.log('Order created:', order.id);

    // Add line item
    await addLineItem(accessToken, order.id, description, amountInCents);
    console.log('Line item added');

    // Process payment
    const payment = await payForOrder(accessToken, order.id, amountInCents);
    console.log('Payment processed:', payment.id);

    // Get payment status
    const status = await getPaymentStatus(accessToken, order.id, payment.id);

    // Log transaction locally
    logTransaction({
      orderId: order.id,
      paymentId: payment.id,
      amount: amountInCents,
      description: description,
      result: status.result,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      orderId: order.id,
      paymentId: payment.id,
      amount: amount,
      description: description,
      result: status.result,
    });

  } catch (error) {
    console.error('Payment error:', error.response?.data || error.message);

    // Handle expired token
    if (error.response?.status === 401) {
      accessToken = null;
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }

    res.status(500).json({
      error: 'Payment failed.',
      details: error.response?.data || error.message,
    });
  }
});

// Check auth status
app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!accessToken });
});

// Get transaction history
app.get('/api/transactions', (req, res) => {
  try {
    const logPath = path.join(__dirname, 'transactions.log');
    if (!fs.existsSync(logPath)) {
      return res.json({ transactions: [] });
    }
    const lines = fs.readFileSync(logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [timestamp, ...rest] = line.split(' - ');
        const data = JSON.parse(rest.join(' - '));
        return {
          timestamp,
          ...data,
          amount: `$${(data.amount / 100).toFixed(2)}`,
        };
      });
    res.json({ transactions: lines.reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Could not read transaction history' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});