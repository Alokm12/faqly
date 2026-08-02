// Mandatory compliance webhook: customers/redact
//
// Fires when a merchant asks every installed app to erase a specific
// shopper's data, 10 days after the request (or 6 months for a customer with
// orders).
//
// NOTHING TO ERASE. Faqly stores merchant-authored content only — see the
// note in webhooks.customers.data_request.jsx for the full reasoning. There is
// no customer record to delete, so this acknowledges and returns.
//
// The endpoint still has to exist and still has to verify the HMAC: Shopify
// checks that all three compliance webhooks respond correctly before an app
// is approved, and a missing one is an automatic rejection.

import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(
    `Received ${topic} webhook for ${shop} ` +
      `(customer ${payload?.customer?.id ?? "unknown"}) — ` +
      "Faqly stores no customer data, nothing to erase.",
  );

  return new Response();
};
