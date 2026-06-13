// Check auth status when page loads
window.addEventListener('load', async () => {
    // Check if we just came back from OAuth
    const urlParams = new URLSearchParams(window.location.search);
    const authResult = urlParams.get('auth');
  
    if (authResult === 'success') {
      showAuthenticated();
      // Clean up URL
      window.history.replaceState({}, document.title, '/');
    } else if (authResult === 'error') {
      showAuthError();
      window.history.replaceState({}, document.title, '/');
    } else {
      // Check if already authenticated
      checkAuthStatus();
    }
  });
  
  async function checkAuthStatus() {
    try {
      const response = await fetch('/api/auth-status');
      const data = await response.json();
      if (data.authenticated) {
        showAuthenticated();
      }
    } catch (error) {
      console.error('Could not check auth status');
    }
  }
  
  function connectClover() {
    window.location.href = '/auth';
  }
  
  function showAuthenticated() {
    const authStatus = document.getElementById('auth-status');
    const authBtn = document.getElementById('auth-btn');
    const paymentSection = document.getElementById('payment-section');
  
    authStatus.textContent = '✓ Connected to Clover successfully';
    authStatus.className = 'status-badge connected';
    authBtn.textContent = 'Connected';
    authBtn.disabled = true;
  
    paymentSection.classList.remove('hidden');
  }
  
  function showAuthError() {
    const authStatus = document.getElementById('auth-status');
    authStatus.textContent = '✗ Authentication failed. Please try again.';
    authStatus.className = 'status-badge error';
  }
  
  async function processPayment() {
    const amount = document.getElementById('amount').value;
    const description = document.getElementById('description').value;
  
    // Basic frontend validation
    if (!amount || amount <= 0) {
      alert('Please enter a valid amount.');
      return;
    }
  
    if (!description.trim()) {
      alert('Please enter a description.');
      return;
    }
  
    // Show loading state
    const payBtn = document.getElementById('pay-btn');
    payBtn.textContent = 'Processing...';
    payBtn.disabled = true;
  
    try {
      const response = await fetch('/api/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: parseFloat(amount),
          description: description.trim(),
        }),
      });
  
      const data = await response.json();
  
      if (response.ok && data.success) {
        showResult(true, data);
      } else {
        showResult(false, data);
      }
    } catch (error) {
      showResult(false, { error: 'Network error. Please try again.' });
    } finally {
      payBtn.textContent = 'Pay Now';
      payBtn.disabled = false;
    }
  }
  
  function showResult(success, data) {
    const resultSection = document.getElementById('result-section');
    const resultContent = document.getElementById('result-content');
    const paymentSection = document.getElementById('payment-section');
  
    paymentSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
  
    if (success) {
      resultContent.innerHTML = `
        <div class="result-success">
          <h3>✓ Payment Successful!</h3>
          <p><strong>Amount:</strong> $${parseFloat(data.amount).toFixed(2)}</p>
          <p><strong>Description:</strong> ${data.description}</p>
          <p><strong>Order ID:</strong> ${data.orderId}</p>
          <p><strong>Payment ID:</strong> ${data.paymentId}</p>
          <p><strong>Status:</strong> ${data.result}</p>
        </div>
      `;
    } else {
      resultContent.innerHTML = `
        <div class="result-error">
          <h3>✗ Payment Failed</h3>
          <p>${data.error || 'Something went wrong. Please try again.'}</p>
        </div>
      `;
    }
  }
  
  function resetForm() {
    document.getElementById('amount').value = '';
    document.getElementById('description').value = '';
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('payment-section').classList.remove('hidden');
  }