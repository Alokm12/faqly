// FAQ data model — database-backed.
//
// Every function takes the `ctx` object from app/models/context.server.js
// ({ shop, graphql }) instead of a bare graphql client. The returned shape
// is intentionally identical to the old metaobject version (question,
// answer, status, position, categoryHandle, categoryName, products[],
// collections[], isStoreWide), so the route components did not have to be
// rewritten.
//
// Product and collection *details* (title, image) still come from the
// Admin API — we only persist GIDs, because caching merchant product data
// in our own database would go stale the moment they rename a product and
// would widen our GDPR surface for no benefit.

import prisma from "../db.server";
import { FaqStatus } from "./faq-status";
import { syncFaq, syncFaqDeletion } from "../services/metaobject-sync.server";

/* ------------------------------------------------------------------ */
/* JSON list helpers — productIds/collectionIds are TEXT columns       */
/* ------------------------------------------------------------------ */

function parseIds(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    // A corrupted value must never take down the whole FAQ list.
    return [];
  }
}

function serializeIds(ids) {
  return JSON.stringify(Array.isArray(ids) ? ids.filter(Boolean) : []);
}

/* ------------------------------------------------------------------ */
/* Resource hydration (products/collections) via Admin API             */
/* ------------------------------------------------------------------ */

const RESOURCE_QUERY = `#graphql
  query FaqlyResources($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        __typename
        id
        title
        handle
        featuredMedia { preview { image { url altText } } }
      }
      ... on Collection {
        __typename
        id
        title
        handle
      }
    }
  }
`;

/**
 * Resolves a batch of product/collection GIDs to display data in ONE
 * request, shared across every FAQ in the list. The old implementation
 * asked for `references(first: 20)` inside each FAQ's metaobject query,
 * which meant a 200-FAQ page fanned out into 200 nested lookups.
 *
 * Returns a Map keyed by GID. Deleted resources simply don't come back,
 * and are dropped from the FAQ's list rather than rendering as blanks.
 */
async function hydrateResources(ids, graphql) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length || !graphql) return new Map();

  const map = new Map();
  // `nodes` accepts a bounded list; 250 is the documented ceiling for most
  // Admin API list arguments, so chunk defensively.
  const CHUNK = 200;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const response = await graphql(RESOURCE_QUERY, {
        variables: { ids: chunk },
      });
      const { data } = await response.json();
      for (const node of data?.nodes ?? []) {
        if (!node?.id) continue;
        map.set(node.id, {
          id: node.id,
          title: node.title,
          handle: node.handle,
          type: node.__typename,
          image: node.featuredMedia?.preview?.image?.url ?? null,
        });
      }
    } catch {
      // Non-fatal: FAQs still render, just without product thumbnails.
      // Losing a picture is a far better outcome than a 500 on the list page.
    }
  }

  return map;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

function normalizeFaq(row, resources = new Map()) {
  const productIds = parseIds(row.productIds);
  const collectionIds = parseIds(row.collectionIds);

  const products = productIds
    .map((id) => resources.get(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, title: r.title, handle: r.handle, image: r.image }));

  const collections = collectionIds
    .map((id) => resources.get(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, title: r.title, handle: r.handle }));

  return {
    id: row.id,
    handle: row.handle,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
    question: row.question ?? "",
    answer: row.answer ?? "",
    status: row.status ?? FaqStatus.DRAFT,
    position: row.position ?? 0,
    categoryHandle: row.category?.handle ?? "",
    categoryName: row.category?.name ?? "",
    products,
    collections,
    // Targeting is decided from the stored GIDs, not from the hydrated
    // results — otherwise a FAQ pinned to a product that failed to load
    // would silently turn into a store-wide FAQ and appear on every page.
    isStoreWide: productIds.length === 0 && collectionIds.length === 0,
    // Provenance. Drives the "AI" badge on the list and the low-confidence
    // warning on the editor.
    source: row.source ?? "manual",
    aiConfidence: row.aiConfidence ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getFaq(handle, ctx) {
  const row = await prisma.faq.findUnique({
    where: { shop_handle: { shop: ctx.shop, handle } },
    include: { category: true },
  });
  if (!row) return null;

  const resources = await hydrateResources(
    [...parseIds(row.productIds), ...parseIds(row.collectionIds)],
    ctx.graphql,
  );
  return normalizeFaq(row, resources);
}

/**
 * @param {object} ctx
 * @param {object} [options]
 * @param {boolean} [options.hydrate=true] Skip the Admin API round-trip when
 *   the caller only needs text (export, sync, counts).
 */
export async function getFaqs(ctx, { hydrate = true } = {}) {
  const rows = await prisma.faq.findMany({
    where: { shop: ctx.shop },
    include: { category: true },
    // No `first: 250` ceiling any more — the old metaobject query silently
    // dropped everything past the 250th FAQ with no pagination.
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  if (!rows.length) return [];

  const resources = hydrate
    ? await hydrateResources(
        rows.flatMap((r) => [...parseIds(r.productIds), ...parseIds(r.collectionIds)]),
        ctx.graphql,
      )
    : new Map();

  return rows.map((row) => normalizeFaq(row, resources));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

async function resolveCategoryId(categoryHandle, shop) {
  if (!categoryHandle) return null;
  const category = await prisma.category.findUnique({
    where: { shop_handle: { shop, handle: categoryHandle } },
    select: { id: true },
  });
  return category?.id ?? null;
}

/**
 * Create-or-update by handle.
 *
 * Unlike the old metaobjectUpsert version, `position` and `categoryHandle`
 * are genuinely left untouched when the caller omits them — Prisma's
 * update only writes the keys present in `data`. The previous code relied
 * on metaobjectUpsert doing the same, which is not a guarantee it makes.
 */
export async function saveFaq(handle, faq, ctx) {
  const data = {
    question: faq.question,
    answer: faq.answer,
    status: faq.status || FaqStatus.DRAFT,
    productIds: serializeIds(faq.productIds),
    collectionIds: serializeIds(faq.collectionIds),
  };

  // Provenance is only written when the caller states it, so an ordinary edit
  // of a generated FAQ does not silently relabel it as manual.
  if (faq.source !== undefined) data.source = normalizeSource(faq.source);
  if (faq.aiConfidence !== undefined) {
    data.aiConfidence = normalizeConfidence(faq.aiConfidence);
  }

  if (faq.position !== undefined) data.position = Number(faq.position) || 0;
  if (faq.categoryHandle !== undefined) {
    data.categoryId = await resolveCategoryId(faq.categoryHandle, ctx.shop);
  }

  const row = await prisma.faq.upsert({
    where: { shop_handle: { shop: ctx.shop, handle } },
    create: {
      shop: ctx.shop,
      handle,
      position: data.position ?? 0,
      ...data,
    },
    update: data,
    include: { category: true },
  });

  await syncFaq(row, ctx);
  return { id: row.id, handle: row.handle };
}

/* ------------------------------------------------------------------ */
/* Bulk create — AI-generated drafts                                   */
/* ------------------------------------------------------------------ */

const SOURCES = new Set(["manual", "ai"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);

function normalizeSource(value) {
  return SOURCES.has(value) ? value : "manual";
}

function normalizeConfidence(value) {
  return CONFIDENCES.has(value) ? value : null;
}

/**
 * Inserts several FAQs at once. Used only by the AI generator.
 *
 * HANDLE COLLISIONS ARE REAL HERE. `generateHandle` suffixes the slug with
 * `Date.now().toString(36)`, which has millisecond resolution — inserting
 * eight FAQs in one tight loop can produce eight identical suffixes, and
 * `@@unique([shop, handle])` then rejects all but the first. Two generated
 * FAQs phrased similarly enough to slugify the same would collide too. So
 * each row gets an index suffix, and a P2002 is retried once with a fresh
 * handle rather than losing the row.
 *
 * Rows are created sequentially rather than with `createMany` because each
 * one needs its category resolved and its metaobject mirror written, and
 * because a partial success is a better outcome than an all-or-nothing
 * transaction that discards seven good FAQs over one bad handle.
 *
 * @param {Array<object>} rows
 * @param {object} ctx
 * @returns {Promise<{created: Array, failed: number}>}
 */
export async function createManyFaqs(rows, ctx) {
  if (!Array.isArray(rows) || !rows.length) return { created: [], failed: 0 };

  // New drafts go after everything that already exists, in the order the
  // model produced them.
  const last = await prisma.faq.findFirst({
    where: { shop: ctx.shop },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  let position = (last?.position ?? -1) + 1;

  const created = [];
  let failed = 0;

  for (const [index, row] of rows.entries()) {
    const question = String(row.question ?? "").trim();
    const answer = String(row.answer ?? "").trim();
    if (!question || !answer) {
      failed += 1;
      continue;
    }

    const categoryId = await resolveCategoryId(row.categoryHandle, ctx.shop);

    const data = {
      shop: ctx.shop,
      question,
      answer,
      // Never negotiable: generated content is a draft. There is no code
      // path that lets the generator publish.
      status: FaqStatus.DRAFT,
      source: normalizeSource(row.source ?? "ai"),
      aiConfidence: normalizeConfidence(row.aiConfidence),
      categoryId,
      productIds: serializeIds(row.productIds),
      collectionIds: serializeIds(row.collectionIds),
      position: position++,
    };

    let inserted = null;
    for (let attempt = 0; attempt < 2 && !inserted; attempt += 1) {
      // The index disambiguates same-millisecond handles; the attempt
      // counter disambiguates the retry from the original.
      const handle = `${generateHandle(question)}-${index}${attempt ? `-${attempt}` : ""}`;
      try {
        inserted = await prisma.faq.create({
          data: { ...data, handle },
          include: { category: true },
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        // Handle taken — loop and try a fresh one.
      }
    }

    if (!inserted) {
      failed += 1;
      continue;
    }

    await syncFaq(inserted, ctx);
    created.push(normalizeFaq(inserted));
  }

  return { created, failed };
}

/**
 * Partial field update by primary key. Used by the drag-to-reorder and
 * status-toggle actions on the list page.
 */
export async function updateFaqFields(id, fields, ctx) {
  const data = {};
  if (fields.status !== undefined) data.status = String(fields.status);
  if (fields.position !== undefined) data.position = Number(fields.position) || 0;
  if (fields.question !== undefined) data.question = String(fields.question);
  if (fields.answer !== undefined) data.answer = String(fields.answer);

  if (!Object.keys(data).length) return null;

  // The `shop` guard turns this into a no-op if an id from another store is
  // ever submitted, instead of updating a row that isn't ours.
  const result = await prisma.faq.updateMany({
    where: { id, shop: ctx.shop },
    data,
  });
  if (!result.count) return null;

  const row = await prisma.faq.findUnique({
    where: { id },
    include: { category: true },
  });
  await syncFaq(row, ctx);
  return { id: row.id };
}

/**
 * Reorders a whole list in one transaction. Replaces the previous
 * `Promise.all(orderedIds.map(update))`, which fired N concurrent
 * mutations — on a 60-FAQ list that reliably tripped Shopify's API rate
 * limit and left the order half-applied.
 */
export async function reorderFaqs(orderedIds, ctx) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return;

  await prisma.$transaction(
    orderedIds.map((id, position) =>
      prisma.faq.updateMany({
        where: { id, shop: ctx.shop },
        data: { position },
      }),
    ),
  );

  // Mirror afterwards, sequentially, so the reorder itself is instant and
  // never blocked by Shopify API latency.
  const rows = await prisma.faq.findMany({
    where: { id: { in: orderedIds }, shop: ctx.shop },
    include: { category: true },
  });
  for (const row of rows) await syncFaq(row, ctx);
}

export async function duplicateFaq(sourceFaq, ctx) {
  const count = await prisma.faq.count({ where: { shop: ctx.shop } });
  const newHandle = generateHandle(`${sourceFaq.question} copy`);

  return saveFaq(
    newHandle,
    {
      question: `${sourceFaq.question} (Copy)`,
      answer: sourceFaq.answer,
      status: FaqStatus.DRAFT,
      position: count,
      categoryHandle: sourceFaq.categoryHandle,
      productIds: sourceFaq.productIds,
      collectionIds: sourceFaq.collectionIds,
    },
    ctx,
  );
}

export async function deleteFaq(id, ctx) {
  const row = await prisma.faq.findFirst({ where: { id, shop: ctx.shop } });
  if (!row) return;

  await prisma.faq.delete({ where: { id } });
  await syncFaqDeletion(row, ctx);
}

/* ------------------------------------------------------------------ */
/* Validation & handles                                                */
/* ------------------------------------------------------------------ */

export function validateFaq(data) {
  const errors = {};
  if (!data.question || !data.question.trim()) {
    errors.question = "Question is required";
  }
  if (!data.answer || !data.answer.trim()) {
    errors.answer = "Answer is required";
  }
  return errors;
}

export function generateHandle(question) {
  const slug = slugify(question);
  return `${slug}-${Date.now().toString(36)}`;
}

function slugify(str) {
  return (
    (str || "faq")
      .toLowerCase()
      // Strip accents so "¿Cómo envían?" becomes "como-envian" rather than
      // collapsing to a bare timestamp.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "faq"
  );
}

export { parseIds as parseResourceIds };
