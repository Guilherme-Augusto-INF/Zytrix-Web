import Stripe from 'stripe';
import { adminAuth, adminDb } from './_lib/firebase-admin.js';
import { getCoinPackage } from './_lib/zycoins.js';

const SITE_URL = (process.env.SITE_URL || 'https://zytrix-lives.vercel.app').replace(/\/$/, '');
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

const allowedOrigins = new Set([
  'https://zytrix-lives.vercel.app',
  'https://zytrix-web.vercel.app',
  'https://zytrix-web-guilhermeaugusto2525-1431.vercel.app',
]);

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(secretKey);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.figma\.site$/i.test(origin);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

class RateLimitError extends Error {}

async function enforceRateLimit(uid) {
  const ref = adminDb.collection('stripeCheckoutRateLimits').doc(uid);
  const now = Date.now();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStartMs = Number(data?.windowStartMs || 0);
    const count = Number(data?.count || 0);
    const inWindow = now - windowStartMs < RATE_LIMIT_WINDOW_MS;

    if (inWindow && count >= RATE_LIMIT_MAX) {
      throw new RateLimitError('Too many checkout attempts');
    }

    tx.set(ref, {
      uid,
      windowStartMs: inWindow ? windowStartMs : now,
      count: inWindow ? count + 1 : 1,
      updatedAt: new Date(now),
    });
  });
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  try {
    const idToken = getBearerToken(req);
    if (!idToken) return res.status(401).json({ error: 'authentication_required' });

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    await enforceRateLimit(uid);

    const { packageId } = readJsonBody(req);
    const coinPackage = getCoinPackage(packageId);
    if (!coinPackage) return res.status(400).json({ error: 'invalid_package' });

    const orderRef = adminDb.collection('zyCoinOrders').doc();
    const now = new Date();

    await orderRef.set({
      uid,
      packageId: coinPackage.id,
      coins: coinPackage.coins,
      priceCents: coinPackage.priceCents,
      stripePriceId: coinPackage.stripePriceId,
      paymentMethod: 'stripe_checkout',
      status: 'creating_checkout',
      mode: 'stripe_test',
      stripeSessionId: null,
      stripePaymentIntentId: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      fulfilledAt: null,
    });

    const metadata = {
      orderId: orderRef.id,
      uid,
      packageId: coinPackage.id,
      coins: String(coinPackage.coins),
    };

    let session;
    try {
      session = await getStripe().checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: coinPackage.stripePriceId, quantity: 1 }],
        client_reference_id: orderRef.id,
        customer_email: typeof decodedToken.email === 'string' ? decodedToken.email : undefined,
        success_url: `${SITE_URL}/pagamento?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/pagamento?checkout=cancelled`,
        metadata,
        payment_intent_data: { metadata },
      }, {
        idempotencyKey: `zytrix-checkout-${orderRef.id}`,
      });
    } catch (error) {
      await orderRef.update({
        status: 'checkout_error',
        updatedAt: new Date(),
      }).catch(() => {});
      throw error;
    }

    await orderRef.update({
      status: 'checkout_created',
      stripeSessionId: session.id,
      updatedAt: new Date(),
    });

    return res.status(200).json({
      checkoutUrl: session.url,
      orderId: orderRef.id,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(429).json({ error: 'rate_limit_exceeded' });
    }

    console.error('create-checkout-session failed', error);
    return res.status(500).json({ error: 'checkout_unavailable' });
  }
}
