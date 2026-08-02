// Mandatory compliance webhook: shop/redact
//
// Fires 48 hours after a merchant uninstalls. This is the GDPR erasure path,
// and it is the one place in the app that genuinely deletes a shop's content.
//
// WHY THIS UNDOES WHAT app/uninstalled DELIBERATELY PRESERVES
// The uninstall handler keeps FAQs so a merchant who comes back finds their
// content intact — a real retention win, and safe because they are still
// inside the 48-hour window. Once Shopify sends shop/redact that window is
// over and the merchant's right to erasure outranks the convenience of a
// reinstall. Keeping the data past this point is a compliance failure, not a
// feature.
//
// Deletion order matters: rows with foreign keys to Shop go first. The schema
// declares onDelete: Cascade, but doing it explicitly means the behaviour does
// not silently change if the relation is ever edited, and it works identically
// on SQLite and Postgres.

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Sequential rather than a transaction: a partial delete that gets retried
    // is fine (every step is idempotent), whereas a transaction that times out
    // on a large shop leaves nothing deleted and Shopify retries the whole
    // thing anyway.
    const faqs = await prisma.faq.deleteMany({ where: { shop } });
    const categories = await prisma.category.deleteMany({ where: { shop } });
    const settings = await prisma.setting.deleteMany({ where: { shop } });
    const plans = await prisma.shopPlan.deleteMany({ where: { shop } });
    const usage = await prisma.aiUsage.deleteMany({ where: { shop } });
    const sessions = await prisma.session.deleteMany({ where: { shop } });
    const shops = await prisma.shop.deleteMany({ where: { domain: shop } });

    console.log(
      `[Faqly] shop/redact complete for ${shop}: ` +
        `${faqs.count} FAQs, ${categories.count} categories, ` +
        `${settings.count} settings, ${plans.count} plans, ` +
        `${usage.count} AI usage rows, ${sessions.count} sessions, ` +
        `${shops.count} shop records deleted.`,
    );
  } catch (error) {
    // A non-2xx makes Shopify retry, which is what we want for a transient
    // database failure — erasure must not be silently skipped.
    console.error(`[Faqly] shop/redact FAILED for ${shop}:`, error);
    return new Response("Redaction failed", { status: 500 });
  }

  return new Response();
};
