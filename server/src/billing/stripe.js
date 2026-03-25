/**
 * stripe.js -- Stripe billing integration for Cloudflare Workers.
 *
 * All functions accept an `env` parameter for Workers bindings instead of
 * reading from process.env. The Stripe SDK is loaded dynamically.
 *
 * Required env vars (set via wrangler secret):
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO,
 *   STRIPE_PRICE_PRO_ANNUAL, STRIPE_PRICE_TEAM_BASE, STRIPE_PRICE_TEAM_SEAT
 */

let stripe = null;
let stripeKey = null;

/**
 * Get or create the Stripe client.
 * @param {object} env - Workers env bindings
 * @returns {Promise<import("stripe").default | null>}
 */
export async function getStripe(env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;

  // Re-create if key changed (shouldn't happen, but defensive)
  if (stripe && stripeKey === key) return stripe;

  try {
    const Stripe =
      globalThis._stripe_constructor || (await import("stripe")).default;
    stripe = new Stripe(key);
    stripeKey = key;
    return stripe;
  } catch {
    return null;
  }
}

/**
 * Resolve the Stripe price ID for a given plan name.
 * @param {object} env
 * @param {"pro_monthly"|"pro_annual"|"team"} plan
 */
function getPriceId(env, plan) {
  switch (plan) {
    case "pro_annual":
      return env.STRIPE_PRICE_PRO_ANNUAL || null;
    case "team":
      return env.STRIPE_PRICE_TEAM_BASE || null;
    case "pro_monthly":
    default:
      return env.STRIPE_PRICE_PRO || null;
  }
}

/**
 * Get the per-seat price ID for Team plans.
 * @param {object} env
 */
function getTeamSeatPriceId(env) {
  return env.STRIPE_PRICE_TEAM_SEAT || null;
}

/**
 * Create a Stripe Checkout session.
 * @param {object} env - Workers env bindings
 * @param {object} opts
 */
export async function createCheckoutSession(
  env,
  { userId, email, customerId, successUrl, cancelUrl, plan = "pro_monthly" },
) {
  const s = await getStripe(env);
  if (!s) return null;

  const priceId = getPriceId(env, plan);
  if (!priceId) return null;

  const appUrl = env.APP_URL || "https://app.context-vault.com";

  const lineItems = [{ price: priceId, quantity: 1 }];

  // Team plans include a per-seat add-on (1 seat included in base)
  if (plan === "team") {
    const seatPriceId = getTeamSeatPriceId(env);
    if (seatPriceId) {
      lineItems.push({ price: seatPriceId, quantity: 1 });
    }
  }

  const params = {
    mode: "subscription",
    line_items: lineItems,
    allow_promotion_codes: true,
    success_url:
      successUrl ||
      `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${appUrl}/billing/cancel`,
    metadata: { userId },
  };

  if (customerId) {
    params.customer = customerId;
  } else {
    params.customer_email = email;
  }

  const session = await s.checkout.sessions.create(params);
  return { url: session.url, sessionId: session.id };
}

/**
 * Verify and parse a Stripe webhook event.
 * @param {object} env - Workers env bindings
 * @param {string} body - Raw request body
 * @param {string} signature - Stripe-Signature header
 */
export async function verifyWebhookEvent(env, body, signature) {
  const s = await getStripe(env);
  if (!s) return null;

  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return null;

  try {
    const event = s.webhooks.constructEvent(body, signature, secret);
    return { id: event.id, type: event.type, data: event.data.object };
  } catch {
    return null;
  }
}

/**
 * Create a Stripe Customer Portal session.
 * @param {object} env - Workers env bindings
 * @param {object} opts
 */
export async function createPortalSession(env, { customerId, returnUrl }) {
  const s = await getStripe(env);
  if (!s) return null;

  const session = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

// ─── Tier Mapping ────────────────────────────────────────────────────────────

const TIER_LIMITS = {
  free: {
    maxEntries: 10000,
    storageMb: 1024, // 1 GB
    requestsPerDay: 5000,
    apiKeys: Infinity,
    exportEnabled: true,
  },
  pro: {
    maxEntries: 50000,
    storageMb: 10240, // 10 GB
    requestsPerDay: Infinity,
    apiKeys: Infinity,
    exportEnabled: true,
  },
  team: {
    maxEntries: 200000,
    storageMb: 51200, // 50 GB
    requestsPerDay: Infinity,
    apiKeys: Infinity,
    exportEnabled: true,
  },
};

/**
 * Get the limits for a given tier.
 * @param {string} tier
 */
export function getTierLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/**
 * Check if a user has exceeded their entry limit.
 * @param {string} tier
 * @param {number} currentCount
 */
export function isOverEntryLimit(tier, currentCount) {
  const limits = getTierLimits(tier);
  return currentCount >= limits.maxEntries;
}
