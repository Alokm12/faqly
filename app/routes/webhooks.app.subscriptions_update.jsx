// Webhook: app_subscriptions/update
//
// WHY THIS EXISTS
// A merchant can cancel, pause, or have a charge decline entirely inside
// Shopify's admin, without ever opening Faqly. Without this webhook the local
// ShopPlan row would keep saying "pro" and keep handing out 100 AI generations
// a month to someone who stopped paying — until they happened to visit the
// billing page, which they have no reason to do after cancelling.
//
// The billing page reconciles on every visit too. This is the half that covers
// the merchant who never comes back.

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLAN_KEYS, planByKey, planKeyByName } from "../models/plans";

/** Subscription states that mean "this merchant is currently paying". */
const ACTIVE_STATUSES = new Set(["ACTIVE", "ACCEPTED"]);

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = payload?.app_subscription;
  if (!subscription) return new Response();

  const status = String(subscription.status ?? "").toUpperCase();
  const planKey = ACTIVE_STATUSES.has(status)
    ? planKeyByName(subscription.name)
    : PLAN_KEYS.FREE;

  // updateMany, not update: a webhook can arrive for a shop that has never
  // triggered a ShopPlan row (they subscribed before ever using AI), and
  // `update` would throw P2025 on the missing row. Zero rows updated is the
  // correct outcome there — the row is created with the right plan the first
  // time they actually use a credit.
  const result = await prisma.shopPlan.updateMany({
    where: { shop },
    data: {
      plan: planKey,
      aiCreditsLimit: planByKey(planKey).aiCreditsLimit,
      // Credits already spent this cycle are deliberately left alone. A
      // downgrade should not hand back generations that were already used,
      // and an upgrade should not reset the counter to zero.
    },
  });

  console.log(
    `[Faqly] Subscription ${status} for ${shop} → plan "${planKey}" ` +
      `(${result.count} row${result.count === 1 ? "" : "s"} updated)`,
  );

  return new Response();
};
