const axios = require('axios');

const BASE_URL = process.env.CLOVER_BASE_URL;
const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;

// Create a new order in Clover
async function createOrder(accessToken) {
  const response = await axios.post(
    `${BASE_URL}/v3/merchants/${MERCHANT_ID}/orders`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

// Add a line item to an existing order
async function addLineItem(accessToken, orderId, name, price) {
  const response = await axios.post(
    `${BASE_URL}/v3/merchants/${MERCHANT_ID}/orders/${orderId}/line_items`,
    {
      name: name,
      price: price,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

// Get available tenders for the merchant
async function getTenders(accessToken) {
  const response = await axios.get(
    `${BASE_URL}/v3/merchants/${MERCHANT_ID}/tenders`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  return response.data;
}

// Pay for an order using external payment tender (sandbox)
async function payForOrder(accessToken, orderId, amount) {
  const tendersData = await getTenders(accessToken);

  const externalTender = tendersData.elements.find(
    t => t.labelKey === 'com.clover.tender.external_payment'
  ) || tendersData.elements[0];

  const response = await axios.post(
    `${BASE_URL}/v3/merchants/${MERCHANT_ID}/orders/${orderId}/payments`,
    {
      amount: amount,
      currency: 'USD',
      tender: {
        id: externalTender.id,
      },
      externalPaymentId: `test-${Date.now()}`,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

// Get payment status by payment ID
async function getPaymentStatus(accessToken, orderId, paymentId) {
  const response = await axios.get(
    `${BASE_URL}/v3/merchants/${MERCHANT_ID}/payments/${paymentId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  return response.data;
}

module.exports = {
  createOrder,
  addLineItem,
  getTenders,
  payForOrder,
  getPaymentStatus,
};