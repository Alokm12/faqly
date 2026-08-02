// The plan catalogue — one definition, three consumers.
//
// WHY THIS IS NOT IN A `.server` FILE
// The pricing page renders these cards in the browser, so it cannot import
// from `*.server.js` (React Router strips those from the client bundle
// entirely — the same reason faq-status.js exists). Keeping the catalogue
// here means shopify.server.js builds its Billing API config from the exact
// object the page renders, so a price can never be advertised at one number
// and charged at another.
//
// WHAT PAID PLANS ACTUALLY BUY
// AI generations, and nothing else. Every other feature — unlimited FAQs,
// categories, product targeting, appearance, import/export — stays on Free.
// That is a deliberate choice: this app is already installed on stores, and
// moving a working feature behind a paywall takes something away from a
// merchant who already had it. Credits are the only thing that costs us money
// per use, so they are the only thing metered.
//
// CHANGING A PRICE
// Edit `amount` here and redeploy. Shopify prices existing subscriptions at
// the amount they were created with, so current subscribers keep their old
// price until they change plan — you do not need a migration.

export const PLAN_KEYS = {
  FREE: "free",
  PRO: "pro",
  ADVANCED: "advanced",
};

/**
 * `name` is the Billing API's plan identifier. It is what Shopify stores on
 * the subscription and what `billing.check({ plans: [...] })` matches on, so
 * renaming one orphans every existing subscription — treat these as stable
 * keys, not display copy. `label` is the display copy.
 */
export const PLANS = {
  [PLAN_KEYS.FREE]: {
    key: PLAN_KEYS.FREE,
    name: "Free",
    label: "Free",
    amount: 0,
    currencyCode: "USD",
    aiCreditsLimit: 5,
    trialDays: 0,
    tagline: "Everything you need to run FAQs, with a taste of AI.",
    features: [
      "Unlimited FAQs and categories",
      "Product and collection targeting",
      "Full appearance control with live preview",
      "Import, export and backups",
      "5 AI generations per month",
    ],
  },
  [PLAN_KEYS.PRO]: {
    key: PLAN_KEYS.PRO,
    name: "Pro",
    label: "Pro",
    amount: 9.99,
    currencyCode: "USD",
    aiCreditsLimit: 100,
    trialDays: 14,
    tagline: "For stores writing FAQs regularly.",
    features: [
      "Everything in Free",
      "100 AI generations per month",
      "AI answer assistant on every FAQ",
      "Priority email support",
    ],
  },
  [PLAN_KEYS.ADVANCED]: {
    key: PLAN_KEYS.ADVANCED,
    name: "Advanced",
    label: "Advanced",
    amount: 29.99,
    currencyCode: "USD",
    aiCreditsLimit: 500,
    trialDays: 14,
    tagline: "For agencies and large catalogues.",
    features: [
      "Everything in Pro",
      "500 AI generations per month",
      "Bulk generation across your whole catalogue",
      "Priority email support",
    ],
  },
};

/** Display order on the pricing page. */
export const PLAN_ORDER = [PLAN_KEYS.FREE, PLAN_KEYS.PRO, PLAN_KEYS.ADVANCED];

/** The plans that involve a Shopify charge. Free is never a subscription. */
export const PAID_PLAN_KEYS = [PLAN_KEYS.PRO, PLAN_KEYS.ADVANCED];

/** Billing API plan names, for `billing.check({ plans })`. */
export const PAID_PLAN_NAMES = PAID_PLAN_KEYS.map((key) => PLANS[key].name);

export function planByKey(key) {
  return PLANS[key] ?? PLANS[PLAN_KEYS.FREE];
}

/** Maps a Billing API plan name ("Pro") back to our key ("pro"). */
export function planKeyByName(name) {
  const hit = Object.values(PLANS).find((plan) => plan.name === name);
  return hit?.key ?? PLAN_KEYS.FREE;
}

export function formatPrice(plan) {
  if (!plan.amount) return "Free";
  // Whole numbers read better without the trailing zeros.
  const amount = Number.isInteger(plan.amount)
    ? plan.amount
    : plan.amount.toFixed(2);
  return `$${amount}`;
}
