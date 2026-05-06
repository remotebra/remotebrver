const SUPABASE_URL = 'https://uonupjxxrvzgwtodpsfp.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvbnVwanh4cnZ6Z3d0b2Rwc2ZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk3MzAzMywiZXhwIjoyMDg5NTQ5MDMzfQ.PnWOATq_FgPfcRptphF5XK2T90uKxF7GTSFjBHXM_6c';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_lZDVlEK45OYGKA1acSpRSE2ZjahvTYMo';

const PRICE_TO_PLAN = {
  'price_junior':  'junior',
  'price_pleno':   'pleno',
  'price_senior':  'senior',
  'price_master':  'master',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = verifyStripeSignature(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  try {
    const { type, data } = event;
    console.log('Stripe event:', type);

    if (type === 'checkout.session.completed') {
      const session = data.object;
      const email = session.customer_details?.email || session.customer_email;
      const priceId = session.line_items?.data?.[0]?.price?.id;
      const plan = getPlanFromSession(session);
      console.log('Checkout completed:', email, plan);
      if (email && plan) await updatePlan(email, plan);
    }

    if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
      const obj = data.object;
      const email = await getEmailFromCustomer(obj.customer);
      if (email) await updatePlan(email, null);
    }

  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.status(200).json({ received: true });
};

function getPlanFromSession(session) {
  // Map payment link to plan
  const paymentLink = session.payment_link || '';
  const linkToPlan = {
    '7sY00je0McgW2v4cnl8ww00': 'junior',
    '28E14naOAcgWfhQ1IH8ww01': 'pleno',
    '5kQ00jg8Uft83z81IH8ww02': 'senior',
    '5kQ28raOA94K1r0bjh8ww03': 'master',
  };
  // Try payment link first
  for (const [id, plan] of Object.entries(linkToPlan)) {
    if (paymentLink.includes(id)) return plan;
  }
  // Try amount
  const amount = session.amount_total;
  if (amount === 2990) return 'junior';
  if (amount === 5990) return 'pleno';
  if (amount === 7990) return 'senior';
  if (amount === 9990) return 'master';
  return null;
}

async function getEmailFromCustomer(customerId) {
  if (!customerId) return null;
  try {
    const r = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY || ''}` }
    });
    const c = await r.json();
    return c.email || null;
  } catch { return null; }
}

async function updatePlan(email, plan) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ plan, updated_at: new Date().toISOString() })
    }
  );
  if (!res.ok) console.error('Supabase update failed:', await res.text());
  else console.log(`✓ Plan updated: ${email} → ${plan || 'free'}`);
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(payload, sig, secret) {
  // Simple HMAC verification without stripe package
  const crypto = require('crypto');
  const parts = sig.split(',');
  const timestamp = parts.find(p => p.startsWith('t=')).slice(2);
  const v1 = parts.find(p => p.startsWith('v1=')).slice(3);
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (expected !== v1) throw new Error('Invalid signature');
  // Check timestamp (5 min tolerance)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) throw new Error('Timestamp too old');
  return JSON.parse(payload);
}
