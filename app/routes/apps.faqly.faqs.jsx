// App Proxy endpoint: /apps/faqly/faqs
//
// Serves the storefront widget. Now a single database read instead of
// three Admin API calls per shopper page view — see
// app/services/storefront-faqs.server.js.

import { authenticate } from "../shopify.server";
import { getStorefrontFaqs } from "../services/storefront-faqs.server";

const EMPTY = { categories: [], poweredByVisible: true };

export const loader = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);

  // No session means the app isn't installed on this shop. Answer with an
  // empty payload rather than an error so the widget renders its own empty
  // state instead of logging a console error on the merchant's storefront.
  if (!session?.shop) {
    return Response.json(EMPTY, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id") || null;
  const collectionIds = (url.searchParams.get("collection_ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const payload = await getStorefrontFaqs(session.shop, {
      productId,
      collectionIds,
    });

    return Response.json(payload, {
      headers: {
        // s-maxage lets Shopify's proxy layer and any CDN in front of the
        // app serve repeat product-page views without hitting the database,
        // while stale-while-revalidate keeps the widget instant during a
        // refresh. A minute of staleness on FAQ copy is a fair trade.
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[Faqly] App Proxy failed:", error);
    // Never 500 on a storefront request — a broken widget must not become a
    // broken product page.
    return Response.json(EMPTY, {
      headers: { "Cache-Control": "no-store" },
    });
  }
};
