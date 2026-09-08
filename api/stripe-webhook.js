import Stripe from 'stripe';
import { adminDb } from './_lib/firebase-admin.js';
import { getCoinPackage, INITIAL_WALLET_BONUS } from './_lib/zycoins.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(secretKey);
}

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function getOrderId(session) {
  return session?.metadata?.orderId || session?.client_reference_id || null;
}

async function markOrderStatus(session, status) {
  const orderId = getOrderId(session);
  if (!orderId) return;

  const orderRef = adminDb.collection('zyCoinOrders').doc(orderId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    if (snap.data().status === 'paid') return;

    tx.update(orderRef, {
      status,
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : null,
      updatedAt: new Date(),
    });
  });
}

async function fulfillCheckoutSession(session) {
  if (session.payment_status !== 'paid') {
    await markOrderStatus(session, 'payment_pending');
    return;
  }

  const metadata = session.metadata || {};
  const orderId = getOrderId(session);
  const uid = metadata.uid;
  const packageId = metadata.packageId;
  const coinPackage = getCoinPackage(packageId);

  if (!orderId || !uid || !coinPackage) {
    throw new Error(`Invalid checkout metadata for session ${session.id}`);
  }

  if (session.client_reference_id && session.client_reference_id !== orderId) {
    throw new Error(`Client reference mismatch for session ${session.id}`);
  }

  if (session.currency !== 'brl' || session.amount_total !== coinPackage.priceCents) {
    throw new Error(`Amount mismatch for session ${session.id}`);
  }

  const orderRef = adminDb.collection('zyCoinOrders').doc(orderId);
  const walletRef = adminDb.collection('wallets').doc(uid);
  const transactionRef = adminDb.collection('zyCoinTransactions').doc(orderId);

  await adminDb.runTransaction(async (tx) => {
    const [orderSnap, walletSnap] = await Promise.all([
      tx.get(orderRef),
      tx.get(walletRef),
    ]);

    if (!orderSnap.exists) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = orderSnap.data();

    if (order.status === 'paid') return;

    if (
      order.uid !== uid ||
      order.packageId !== coinPackage.id ||
      order.coins !== coinPackage.coins ||
      order.priceCents !== coinPackage.priceCents ||
      (order.stripeSessionId && order.stripeSessionId !== session.id)
    ) {
      throw new Error(`Order validation failed for ${orderId}`);
    }

    const now = new Date();
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : null;

    if (walletSnap.exists) {
      const wallet = walletSnap.data();
      tx.update(walletRef, {
        balance: Math.max(0, Number(wallet.balance || 0)) + coinPackage.coins,
        lastTransactionId: orderId,
        updatedAt: now,
      });
    } else {
      tx.set(walletRef, {
        uid,
        balance: INITIAL_WALLET_BONUS + coinPackage.coins,
        totalSent: 0,
        totalReceived: 0,
        lastTransactionId: orderId,
        createdAt: now,
        updatedAt: now,
      });
    }

    tx.set(transactionRef, {
      transactionId: orderId,
      uid,
      type: 'purchase',
      amount: coinPackage.coins,
      packageId: coinPackage.id,
      priceCents: coinPackage.priceCents,
      status: 'completed',
      source: 'stripe',
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      createdAt: now,
    });

    tx.update(orderRef, {
      status: 'paid',
      mode: 'stripe_test',
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      amountTotal: session.amount_total,
      currency: session.currency,
      paidAt: now,
      fulfilledAt: now,
      updatedAt: now,
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'webhook_not_configured' });
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'missing_signature' });
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.warn('Stripe webhook signature verification failed', error?.message || error);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await fulfillCheckoutSession(event.data.object);
        break;
      case 'checkout.session.async_payment_failed':
        await markOrderStatus(event.data.object, 'payment_failed');
        break;
      case 'checkout.session.expired':
        await markOrderStatus(event.data.object, 'expired');
        break;
      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(`Stripe webhook processing failed for ${event.id}`, error);
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
}
