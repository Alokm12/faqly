// Resource route: "which FAQs are pinned to a product or collection that no
// longer exists?"
//
// WHY THIS IS NOT IN THE DASHBOARD LOADER
// `productIds`/`collectionIds` are JSON *text* columns (kept that way so the
// schema works on SQLite and Postgres alike), so there is no SQL that can
// answer this — it needs every targeted FAQ loaded and its GIDs resolved
// through the Admin API. That is a network round-trip whose latency belongs
// to Shopify, not to us, and the dashboard must paint before it resolves.
// The dashboard fetches this on mount and shows a real loading state.
//
// It is deliberately incapable of failing loudly: any error returns
// `status: "unknown"` and the section renders nothing. A dashboard that
// 500s because a product lookup timed out is worse than one that quietly
// omits one advisory section.

import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import prisma from "../db.server";
import { parseResourceIds } from "../models/Faq.server";

/**
 * Ceiling on GIDs resolved per request. A store with thousands of targeted
 * FAQs would otherwise turn one dashboard visit into a long chain of Admin
 * API calls and burn the merchant's rate limit on an advisory panel. When
 * the cap bites we say so in the response rather than silently reporting a
 * partial result as complete.
 */
const MAX_IDS = 250;

const NODES_QUERY = `#graphql
  query FaqlyOrphanCheck($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id }
      ... on Collection { id }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  try {
    // "[]" is the column default, so anything else is a targeted FAQ. This
    // keeps the scan off the store-wide majority.
    const targeted = await prisma.faq.findMany({
      where: {
        shop: ctx.shop,
        NOT: { productIds: "[]", collectionIds: "[]" },
      },
      select: { id: true, handle: true, question: true, productIds: true, collectionIds: true },
    });

    if (!targeted.length) {
      return { status: "ok", rows: [], truncated: false };
    }

    // Map every GID to the FAQs that reference it, so one resolved batch
    // answers for all of them.
    const faqsByGid = new Map();
    for (const faq of targeted) {
      for (const gid of [
        ...parseResourceIds(faq.productIds),
        ...parseResourceIds(faq.collectionIds),
      ]) {
        if (!faqsByGid.has(gid)) faqsByGid.set(gid, []);
        faqsByGid.get(gid).push(faq);
      }
    }

    const allGids = [...faqsByGid.keys()];
    const gids = allGids.slice(0, MAX_IDS);
    const truncated = allGids.length > gids.length;

    if (!ctx.graphql) return { status: "unknown", rows: [], truncated: false };

    const response = await ctx.graphql(NODES_QUERY, { variables: { ids: gids } });
    const payload = await response.json();

    // A top-level GraphQL error arrives with a 200 — treat it like a throw
    // rather than reading `data` off a failed response.
    if (payload?.errors?.length || !payload?.data) {
      console.error(
        "[Faqly] Orphan check failed:",
        payload?.errors?.[0]?.message ?? "no data",
      );
      return { status: "unknown", rows: [], truncated: false };
    }

    // `nodes` preserves request order and returns null for anything the
    // store no longer has — deleted products included.
    const missing = new Set();
    payload.data.nodes.forEach((node, index) => {
      if (!node?.id) missing.add(gids[index]);
    });

    const byFaq = new Map();
    for (const gid of missing) {
      for (const faq of faqsByGid.get(gid) ?? []) {
        if (!byFaq.has(faq.id)) {
          byFaq.set(faq.id, {
            id: faq.id,
            handle: faq.handle,
            question: faq.question,
            href: `/app/faqs/${faq.handle}`,
            missingCount: 0,
          });
        }
        byFaq.get(faq.id).missingCount += 1;
      }
    }

    return { status: "ok", rows: [...byFaq.values()], truncated };
  } catch (error) {
    console.error("[Faqly] Orphan check failed:", error);
    return { status: "unknown", rows: [], truncated: false };
  }
};
