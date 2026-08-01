// Request-scoped data context.
//
// Every model function needs two things: which shop we're acting for (the
// database is multi-tenant) and — only when the metaobject mirror is
// enabled — an Admin GraphQL client. Passing them as one object keeps the
// model signatures stable.
//
// Usage in a loader/action:
//   const { admin, session } = await authenticate.admin(request);
//   const ctx = await dataContext({ session, admin });
//   const faqs = await getFaqs(ctx);

import prisma from "../db.server";
import { seedDefaults } from "../services/seed.server";

/**
 * Ensures a Shop row exists before any FAQ, Category or Setting row tries
 * to reference it via foreign key, and seeds starter content on the very
 * first install.
 *
 * CONCURRENCY:
 * React Router runs parent and child loaders in parallel, so opening /app
 * fires app.jsx and app._index.jsx at the same moment. A naive
 * findUnique-then-create races: both see no row, both insert, and the
 * loser dies on the unique constraint. The create is therefore guarded and
 * P2002 (unique violation) is treated as "another request won the race" —
 * which is exactly right, because the row we wanted now exists.
 */
export async function ensureShop(domain) {
  const existing = await prisma.shop.findUnique({
    where: { domain },
    select: { domain: true, uninstalledAt: true },
  });

  if (existing) {
    // Only write when there is something to clear. Reinstall path: drop
    // the uninstall marker so the merchant's existing FAQs come straight
    // back. Deliberately no seeding — a returning merchant gets their own
    // content, not ours.
    if (existing.uninstalledAt) {
      await prisma.shop.update({
        where: { domain },
        data: { uninstalledAt: null },
      });
    }
    return;
  }

  let created = false;
  try {
    await prisma.shop.create({ data: { domain } });
    created = true;
  } catch (error) {
    // P2002 = unique constraint. A parallel loader created the row a
    // millisecond ago; nothing to do and nothing to report.
    if (error?.code !== "P2002") throw error;
  }

  if (!created) return;

  try {
    // First install only. seedDefaults is itself a no-op when any FAQ
    // already exists, so even a lost race cannot double-seed.
    await seedDefaults(domain);
  } catch (error) {
    // Starter content is a nicety, not a requirement. If it fails the
    // merchant gets an empty app, which is recoverable — a 500 on the
    // first screen after install is not.
    console.error("[Faqly] Seeding starter FAQs failed:", error);
  }
}

export async function dataContext({ session, admin }) {
  const shop = session.shop;
  await ensureShop(shop);
  return { shop, graphql: admin?.graphql ?? null };
}

/**
 * Same thing for App Proxy requests, where `authenticate.public.appProxy`
 * gives us the shop domain but we must NOT create a Shop row for a store
 * that has never installed the app.
 */
export function publicContext({ shop, admin }) {
  return { shop, graphql: admin?.graphql ?? null };
}
