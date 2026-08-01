import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Sessions must go — the access token is dead and keeping it is a
  // security liability.
  //
  // FAQ CONTENT MUST NOT. A merchant who uninstalls to try a competitor and
  // comes back a week later should find their FAQs intact; making them
  // retype fifty answers is how you lose the reinstall. We record the
  // uninstall instead, and app/models/context.server.js clears the marker
  // when they return.
  //
  // Note this is not the GDPR erasure path — that is the shop/redact
  // webhook, which fires 48h after uninstall and is where actual deletion
  // belongs. Wire it up before App Store submission.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  await db.shop
    .update({
      where: { domain: shop },
      data: { uninstalledAt: new Date() },
    })
    // The shop row may legitimately not exist (webhook replay after the
    // record was already purged). A missing row is not an error worth
    // returning a non-2xx for — Shopify would just retry forever.
    .catch(() => {});

  return new Response();
};
