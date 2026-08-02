// Per-shop AI plan and credit balance.
//
// WHY CREDITS RESET LAZILY
// The window rolls forward inside the quota check rather than on a schedule.
// A cron job is one more thing that can quietly stop running, and the failure
// mode is invisible: merchants simply never get their credits back and nobody
// finds out until someone complains. Checking `cycleResetAt` at the moment it
// matters cannot drift out of sync with itself.
//
// WHY THE BOOTSTRAP IS DEFENSIVE
// React Router runs parent and child loaders in parallel, so two requests can
// reach `getPlan` for a brand-new shop at the same instant. `upsert` is the
// same shape `saveSettings` uses; the P2002 catch is the same one `ensureShop`
// uses in models/context.server.js. Between them a lost race is a no-op rather
// than a 500 — see the note in that file for the full reasoning.

import prisma from "../db.server";
import { UserError } from "./errors";
import {
  PLANS as PLAN_CATALOGUE,
  PLAN_KEYS,
  PAID_PLAN_NAMES,
  planByKey,
  planKeyByName,
} from "./plans";

/** Length of a credit cycle. Not a calendar month — 30 days from first use. */
const CYCLE_DAYS = 30;

/**
 * Plans come from the catalogue in models/plans.js, which is also what the
 * Billing API config and the pricing page are built from.
 *
 * The old `// TODO: wire to Billing API` marker is gone: `reconcilePlan`
 * below is that wiring. The local row is a cache of the merchant's real
 * Shopify subscription, never the source of truth for *what they pay* — only
 * for how much of the allowance they have spent this cycle.
 */
export { PLANS, PLAN_KEYS } from "./plans";

// Internal only — the catalogue in plans.js is the public surface.
const DEFAULT_PLAN = PLAN_KEYS.FREE;

/** The one error code the routes branch on. */
export const QUOTA_EXCEEDED = "QUOTA_EXCEEDED";

function cycleEndFrom(date) {
  return new Date(date.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);
}

function limitFor(plan) {
  return planByKey(plan).aiCreditsLimit;
}

function shape(row) {
  const limit = row.aiCreditsLimit;
  const used = Math.min(row.aiCreditsUsed, limit);
  const catalogue = planByKey(row.plan);
  return {
    shop: row.shop,
    plan: row.plan,
    planLabel: catalogue.label,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
    // Serialised for the client: a Date would survive the loader but arrives
    // as a string anyway, so this is explicit rather than accidental.
    cycleResetAt:
      row.cycleResetAt instanceof Date
        ? row.cycleResetAt.toISOString()
        : row.cycleResetAt,
  };
}

/**
 * Loads the shop's plan, creating it on first use and rolling the credit
 * cycle forward if it has expired.
 *
 * Never throws on a concurrent create: a P2002 means another request created
 * the row a millisecond ago, which is exactly the state we wanted.
 */
export async function getPlan(shop) {
  // A client generated before this model existed has no `shopPlan` delegate,
  // and `undefined.findUnique` would take the whole FAQ list down with an
  // error boundary — a page full of working features killed by the one that
  // isn't ready. Returning null instead lets the caller hide the AI panel and
  // render everything else; db.server.js has already logged the real reason
  // and told whoever is running the dev server to restart it.
  if (!prisma.shopPlan) return null;

  const now = new Date();

  let row = await prisma.shopPlan.findUnique({ where: { shop } });

  if (!row) {
    const data = {
      shop,
      plan: DEFAULT_PLAN,
      aiCreditsUsed: 0,
      aiCreditsLimit: limitFor(DEFAULT_PLAN),
      cycleResetAt: cycleEndFrom(now),
    };
    try {
      row = await prisma.shopPlan.upsert({
        where: { shop },
        create: data,
        update: {},
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      // Another request won the race; its row is the one we want.
      row = await prisma.shopPlan.findUnique({ where: { shop } });
      if (!row) throw error;
    }
  }

  // Lazy cycle reset. `updateMany` with the stale `cycleResetAt` in the WHERE
  // clause makes this a compare-and-set: if two requests both see an expired
  // cycle, only the first one's update matches and the credits are zeroed
  // once, not twice.
  if (row.cycleResetAt <= now) {
    const reset = await prisma.shopPlan.updateMany({
      where: { shop, cycleResetAt: row.cycleResetAt },
      data: { aiCreditsUsed: 0, cycleResetAt: cycleEndFrom(now) },
    });
    if (reset.count) {
      row = await prisma.shopPlan.findUnique({ where: { shop } });
    }
  }

  return shape(row);
}

/**
 * Throws before any network call when the shop is out of credits.
 *
 * The message is the exact string from the spec's UX section — it reaches the
 * merchant verbatim because it is a `UserError` (see models/errors.js).
 */
export async function assertQuota(shop) {
  const plan = await getPlan(shop);

  // No plan row means the credit table is unreachable. Refusing is the only
  // safe answer: spending on a merchant's behalf without being able to count
  // it is worse than not spending at all.
  if (!plan) {
    const error = new UserError(
      "Couldn't generate right now — your FAQs are unchanged.",
    );
    error.code = "AI_UNAVAILABLE";
    throw error;
  }

  if (plan.exhausted) {
    const error = new UserError(
      "You've used all AI generations for this month. Upgrade to continue.",
    );
    error.code = QUOTA_EXCEEDED;
    throw error;
  }
  return plan;
}

/**
 * Reconciles the local row against the merchant's real Shopify subscription.
 *
 * SHOPIFY IS THE SOURCE OF TRUTH FOR WHAT SOMEONE PAYS FOR. The local row only
 * caches it, plus the credits spent this cycle. A merchant can cancel from
 * Shopify's own admin without ever opening this app, so treating our column as
 * authoritative would keep serving Pro credits to someone who stopped paying.
 *
 * Called from the billing page, after a subscription returns, and by the
 * app_subscriptions/update webhook. NOT called on the AI hot path — quota
 * checks read the cached row, because putting an Admin API round-trip in front
 * of every generation would add latency to the one thing that is already slow.
 *
 * Never throws: if the billing check fails, the merchant keeps whatever they
 * had rather than being silently downgraded mid-session by a network blip.
 *
 * @param {string} shop
 * @param {object} billing  The `billing` context from authenticate.admin.
 * @param {object} [options]
 * @param {boolean} [options.isTest]  Must match the mode charges are CREATED
 *   in — see the note below. Callers pass BILLING_IS_TEST from shopify.server.
 *   It is a parameter rather than an import so this module stays free of the
 *   Shopify client, which cannot be constructed without app credentials.
 * @returns {Promise<object|null>} The reconciled plan.
 */
export async function reconcilePlan(shop, billing, { isTest = false } = {}) {
  const current = await getPlan(shop);
  if (!current || !billing) return current;

  let activeKey = PLAN_KEYS.FREE;
  let subscriptionId = null;

  try {
    const { hasActivePayment, appSubscriptions } = await billing.check({
      plans: PAID_PLAN_NAMES,
      // CHECK IN THE SAME MODE WE CHARGE IN.
      //
      // Shopify's rule is `isTest || !subscription.test`: passing false
      // matches ONLY live subscriptions. Hard-coding false therefore made a
      // dev store's test subscription invisible — you could approve a charge
      // and the page would still say Free, which reads as the billing flow
      // being broken rather than a filter being wrong.
      //
      // In production this stays false, so a stray test charge can never
      // unlock a paid plan on a live shop.
      isTest,
    });

    if (hasActivePayment && appSubscriptions?.length) {
      // Highest allowance wins if a store somehow holds two subscriptions —
      // the merchant is paying for both, so give them the better one.
      const ranked = appSubscriptions
        .map((sub) => ({ sub, key: planKeyByName(sub.name) }))
        .sort(
          (a, b) =>
            planByKey(b.key).aiCreditsLimit - planByKey(a.key).aiCreditsLimit,
        );
      activeKey = ranked[0].key;
      subscriptionId = ranked[0].sub.id ?? null;
    }
  } catch (error) {
    console.error("[Faqly] Billing check failed; keeping cached plan:", error);
    return current;
  }

  if (current.plan === activeKey && current.limit === limitFor(activeKey)) {
    return { ...current, subscriptionId };
  }

  // Credits used are deliberately NOT reset on a plan change. Upgrading
  // mid-cycle raises the ceiling immediately (5 used of 100 rather than 0 of
  // 100), and downgrading does not hand back credits already spent.
  const row = await prisma.shopPlan.update({
    where: { shop },
    data: { plan: activeKey, aiCreditsLimit: limitFor(activeKey) },
  });

  return { ...shape(row), subscriptionId };
}

/**
 * Every plan, annotated with which one the shop is on. Feeds the pricing page.
 */
export function planCatalogue(currentKey) {
  return Object.values(PLAN_CATALOGUE).map((plan) => ({
    ...plan,
    current: plan.key === currentKey,
  }));
}

/**
 * Burns one credit. Called only after a request actually reached Anthropic.
 *
 * `increment` rather than a read-modify-write, so two calls landing together
 * both count instead of one overwriting the other.
 */
export async function consumeCredit(shop) {
  await prisma.shopPlan.updateMany({
    where: { shop },
    data: { aiCreditsUsed: { increment: 1 } },
  });
}
