// Grounding data for the AI features.
//
// WHY THIS EXISTS AT ALL
// The model is never allowed to invent a shipping time, a price, a return
// window or a warranty term. Everything it is allowed to state as fact comes
// from this file, fetched live from the Shopify Admin API. If a fact isn't
// here, the prompt tells the model to write "[MERCHANT: fill in]" rather than
// guess — that placeholder is the whole reason generated FAQs are safe to
// show a merchant.
//
// NO CUSTOMER PII, EVER. Shop, product and policy data only. Nothing in this
// file reads orders, customers or anything derived from them.
//
// TRUNCATION IS NOT COSMETIC. A refund policy can run to tens of thousands of
// characters. Sent whole, on every generation, it would dominate the input
// bill and crowd out the product data that actually varies. 4000 characters is
// enough to carry the substance of a normal policy.

const POLICY_MAX_CHARS = 4000;
const PRODUCT_BODY_MAX_CHARS = 2000;
const VARIANT_LIMIT = 10;

const STORE_CONTEXT_QUERY = `#graphql
  query FaqlyStoreContext {
    shop {
      name
      currencyCode
      shippingPolicy { body }
      refundPolicy { body }
    }
  }
`;

const PRODUCT_CONTEXT_QUERY = `#graphql
  query FaqlyProductContext($id: ID!) {
    product(id: $id) {
      title
      descriptionHtml
      productType
      vendor
      variants(first: ${VARIANT_LIMIT}) {
        nodes { title price sku }
      }
    }
  }
`;

/**
 * HTML → plain text, without a parser.
 *
 * Policy and description bodies are merchant HTML. They are going into a
 * prompt, not into the DOM, so the requirement is legibility rather than
 * sanitisation — but tags still have to go, or half the token budget is spent
 * on markup. `<br>` and block ends become newlines first so sentences don't
 * run together.
 */
function toPlainText(html, maxChars) {
  if (typeof html !== "string" || !html) return null;

  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Fetches everything the model is allowed to treat as fact.
 *
 * Never throws. A missing scope, a throttle or a deleted product all degrade
 * to a smaller context object rather than failing the generation: the prompt
 * handles absent facts by emitting a placeholder, so a partial context
 * produces an FAQ the merchant has to finish rather than no FAQ at all.
 *
 * @param {object} ctx  { shop, graphql } from models/context.server.js
 * @param {object} [options]
 * @param {string|null} [options.productId]  Shopify product GID, or null for
 *   whole-store context.
 * @returns {Promise<object>} Plain object, ready for JSON.stringify.
 */
export async function getStoreContext(ctx, { productId = null } = {}) {
  const context = {
    shopName: null,
    currency: null,
    shippingPolicy: null,
    refundPolicy: null,
    product: null,
  };

  if (!ctx?.graphql) return context;

  try {
    const response = await ctx.graphql(STORE_CONTEXT_QUERY);
    const payload = await response.json();

    // Policies sit behind their own access scope on some API versions. A
    // top-level GraphQL error arrives with a 200, so this is checked rather
    // than assumed — and a policy we cannot read is simply absent, which the
    // prompt already knows how to handle.
    if (payload?.errors?.length) {
      console.error(
        "[Faqly] Store context partially unavailable:",
        payload.errors[0]?.message,
      );
    }

    const shop = payload?.data?.shop;
    if (shop) {
      context.shopName = shop.name ?? null;
      context.currency = shop.currencyCode ?? null;
      context.shippingPolicy = toPlainText(
        shop.shippingPolicy?.body,
        POLICY_MAX_CHARS,
      );
      context.refundPolicy = toPlainText(
        shop.refundPolicy?.body,
        POLICY_MAX_CHARS,
      );
    }
  } catch (error) {
    console.error("[Faqly] Store context lookup failed:", error);
  }

  if (!productId) return context;

  try {
    const response = await ctx.graphql(PRODUCT_CONTEXT_QUERY, {
      variables: { id: productId },
    });
    const payload = await response.json();

    if (payload?.errors?.length) {
      console.error(
        "[Faqly] Product context lookup failed:",
        payload.errors[0]?.message,
      );
      return context;
    }

    const product = payload?.data?.product;
    if (product) {
      context.product = {
        title: product.title ?? null,
        description: toPlainText(product.descriptionHtml, PRODUCT_BODY_MAX_CHARS),
        productType: product.productType || null,
        vendor: product.vendor || null,
        variants: (product.variants?.nodes ?? []).map((variant) => ({
          title: variant.title,
          price: variant.price,
          sku: variant.sku || null,
        })),
      };
    }
  } catch (error) {
    console.error("[Faqly] Product context lookup failed:", error);
  }

  return context;
}

/**
 * True when there is enough real data for a generation to be worth running.
 *
 * Without this a store with no policies and no product selected would spend a
 * credit to receive N FAQs made entirely of placeholders.
 */
export function hasUsableContext(context) {
  return Boolean(
    context?.product ||
      context?.shippingPolicy ||
      context?.refundPolicy,
  );
}
