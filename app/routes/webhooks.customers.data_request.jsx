// Mandatory compliance webhook: customers/data_request
//
// Fires when a shopper exercises their GDPR right of access and the merchant
// forwards the request to every installed app.
//
// FAQLY HOLDS NO CUSTOMER DATA. Everything in this app is merchant-authored
// content — FAQs, categories, settings — plus a per-shop AI credit balance.
// There are no customer records, no order data, no email addresses, and the
// storefront widget sends nothing back: it is a one-way read of published
// FAQs through the App Proxy. Prompts are explicitly built from shop, product
// and policy data only (see services/store-context.server.js).
//
// So the correct response is an acknowledged 200 with nothing to hand over.
// Shopify requires the endpoint to exist and to verify the HMAC; it does not
// require an app that stores nothing to invent a payload.
//
// IF THAT EVER CHANGES — if analytics, "was this helpful" votes, or search
// terms start being stored against a shopper — this handler must start
// returning that data to the merchant, and this comment is the thing that
// should stop someone shipping the storage without the disclosure.

import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  // Verifies the HMAC. An unsigned or tampered request throws here, which is
  // the whole security value of this endpoint.
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(
    `Received ${topic} webhook for ${shop} ` +
      `(customer ${payload?.customer?.id ?? "unknown"}) — ` +
      "Faqly stores no customer data, nothing to return.",
  );

  return new Response();
};
