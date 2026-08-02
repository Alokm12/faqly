// Metaobject mirror — OPTIONAL, one-way: database ➜ Shopify.
//
// WHY THIS IS OPTIONAL
// The storefront widget loads FAQs from the App Proxy (/apps/faqly/faqs),
// so nothing on the storefront reads metaobjects today. The mirror exists
// only for a future server-rendered Liquid path — rendering FAQ text into
// the page HTML is what makes FAQPage JSON-LD actually indexable, since
// Google will not reliably pick up content injected by fetch() after load.
//
// It is OFF. Flip MIRROR_ENABLED below to true if you ever build that path.
//
// WHY IT IS ONE-WAY AND BEST-EFFORT
// App-reserved ("$app:") metaobjects are owned by the app installation:
// Shopify removes the definitions and all their entries after an
// uninstall, and editing a field key or type in shopify.app.toml can drop
// values across every entry. Treating them as a cache we can rebuild — and
// never as the source of truth — is what stops that from being data loss.
// Every function here therefore swallows its errors and records them,
// rather than failing the merchant's save.

import prisma from "../db.server";
import { UserError } from "../models/errors";

const FAQ_TYPE = "$app:faq";
const CATEGORY_TYPE = "$app:faq_category";

const MIRROR_ENABLED = false;

export function mirrorEnabled() {
  return MIRROR_ENABLED;
}

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

const UPSERT_MUTATION = `#graphql
  mutation FaqlyMetaobjectUpsert(
    $handle: MetaobjectHandleInput!
    $metaobject: MetaobjectUpsertInput!
  ) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;

const DELETE_MUTATION = `#graphql
  mutation FaqlyMetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors { field message }
    }
  }
`;

/**
 * `fields: [{ key, value }]` is the stable, documented shape of
 * MetaobjectUpsertInput. The previous implementation passed a top-level
 * `values: JSON!` argument instead; if your pinned API version happens to
 * accept that too, this form still works — it just doesn't depend on it.
 *
 * Values are always strings: number_integer and boolean metaobject fields
 * are transported as their string representation.
 */
function toFields(object) {
  return Object.entries(object)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ key, value: String(value) }));
}

async function recordSyncError(shop, error) {
  try {
    await prisma.shop.update({
      where: { domain: shop },
      data: {
        lastSyncError: String(error?.message || error).slice(0, 500),
      },
    });
  } catch {
    // The shop row may not exist yet on a very first request. Never let
    // error bookkeeping become its own error.
  }
}

async function runMutation(query, variables, ctx) {
  const response = await ctx.graphql(query, { variables });
  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new UserError(errors.map((e) => e.message).join(", "));
  }
  const result = data?.metaobjectUpsert ?? data?.metaobjectDelete;
  if (result?.userErrors?.length) {
    throw new UserError(result.userErrors.map((e) => e.message).join(", "));
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Outbound sync                                                       */
/* ------------------------------------------------------------------ */

export async function syncCategory(row, ctx) {
  if (!row || !mirrorEnabled() || !ctx?.graphql) return;

  try {
    const result = await runMutation(
      UPSERT_MUTATION,
      {
        handle: { type: CATEGORY_TYPE, handle: row.handle },
        metaobject: {
          fields: toFields({
            name: row.name,
            icon: row.icon,
            icon_image_url: row.iconImageUrl,
            color: row.color,
            position: row.position,
          }),
          capabilities: {
            publishable: { status: row.visible ? "ACTIVE" : "DRAFT" },
          },
        },
      },
      ctx,
    );

    await prisma.category.update({
      where: { id: row.id },
      data: {
        metaobjectId: result?.metaobject?.id ?? row.metaobjectId,
        syncedAt: new Date(),
      },
    });
  } catch (error) {
    await recordSyncError(ctx.shop, error);
  }
}

export async function syncFaq(row, ctx) {
  if (!row || !mirrorEnabled() || !ctx?.graphql) return;

  try {
    // The category reference needs the *category's* metaobject GID, which
    // only exists once that category has itself been mirrored. If it hasn't
    // been, the reference is skipped rather than sent as an invalid value —
    // the next category sync backfills it.
    const fields = {
      question: row.question,
      answer: row.answer,
      status: row.status,
      position: row.position,
      products: row.productIds,
      collections: row.collectionIds,
    };
    if (row.category?.metaobjectId) {
      fields.category = row.category.metaobjectId;
    }

    const result = await runMutation(
      UPSERT_MUTATION,
      {
        handle: { type: FAQ_TYPE, handle: row.handle },
        metaobject: {
          fields: toFields(fields),
          capabilities: {
            // Mirrors our own status field onto Shopify's publish state so a
            // Liquid `metaobjects` loop, which only sees ACTIVE entries,
            // matches what the admin shows.
            publishable: {
              status: row.status === "PUBLISHED" ? "ACTIVE" : "DRAFT",
            },
          },
        },
      },
      ctx,
    );

    await prisma.faq.update({
      where: { id: row.id },
      data: {
        metaobjectId: result?.metaobject?.id ?? row.metaobjectId,
        syncedAt: new Date(),
      },
    });
  } catch (error) {
    await recordSyncError(ctx.shop, error);
  }
}

export async function syncFaqDeletion(row, ctx) {
  if (!row?.metaobjectId || !mirrorEnabled() || !ctx?.graphql) return;
  try {
    await runMutation(DELETE_MUTATION, { id: row.metaobjectId }, ctx);
  } catch (error) {
    await recordSyncError(ctx.shop, error);
  }
}

export const syncCategoryDeletion = syncFaqDeletion;

/**
 * Rebuilds the entire mirror from the database. This is the recovery path:
 * if Shopify wipes the app-reserved definitions again, one click here puts
 * everything back. Categories go first so FAQs can resolve their
 * category references on the same pass.
 */
export async function resyncAll(ctx) {
  if (!mirrorEnabled() || !ctx?.graphql) {
    return { skipped: true, categories: 0, faqs: 0 };
  }

  const categories = await prisma.category.findMany({
    where: { shop: ctx.shop },
    orderBy: { position: "asc" },
  });
  for (const category of categories) {
    await syncCategory(category, ctx);
  }

  const faqs = await prisma.faq.findMany({
    where: { shop: ctx.shop },
    include: { category: true },
    orderBy: { position: "asc" },
  });
  for (const faq of faqs) {
    await syncFaq(faq, ctx);
  }

  await prisma.shop.update({
    where: { domain: ctx.shop },
    data: { lastSyncAt: new Date(), lastSyncError: null },
  });

  return { skipped: false, categories: categories.length, faqs: faqs.length };
}

/* ------------------------------------------------------------------ */
/* One-time backfill: Shopify metaobjects ➜ database                   */
/* ------------------------------------------------------------------ */

/**
 * Pages through a definition's entries via the definition object itself.
 *
 * WHY NOT `metaobjects(type: "...")`:
 * On this store that top-level query returns an empty connection with no
 * error, even for a definition whose own `metaobjectsCount` reports 52
 * entries. Reading through `metaobjectDefinition(id:) { metaobjects }`
 * asks the exact object that produced the count, so the two can't
 * disagree.
 *
 * Fields come back as a generic `fields { key value }` list rather than
 * named `field(key:)` aliases. That means one query shape works for both
 * FAQs and categories, and — more importantly — a definition missing a
 * field we expected returns fewer entries in the list instead of failing
 * the whole query.
 */
async function fetchDefinitionEntries(definitionId, graphql) {
  const nodes = [];
  const problems = [];
  let cursor = null;

  for (let page = 0; page < 50; page += 1) {
    const after = cursor ? `, after: "${cursor}"` : "";
    let payload;

    try {
      const response = await graphql(
        `#graphql
        query FaqlyDefinitionEntries {
          metaobjectDefinition(id: "${definitionId}") {
            metaobjects(first: 100${after}) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                handle
                updatedAt
                fields { key value }
              }
            }
          }
        }`,
      );
      payload = await response.json();
    } catch (error) {
      problems.push(String(error?.message || error));
      break;
    }

    if (payload?.errors?.length) {
      problems.push(payload.errors.map((e) => e.message).join("; "));
      break;
    }

    const connection = payload?.data?.metaobjectDefinition?.metaobjects;
    if (!connection) {
      // Surfaces the actual response instead of silently reporting zero,
      // which is how the previous version hid its own failure.
      problems.push(
        `No entries returned for ${definitionId}: ${JSON.stringify(payload).slice(0, 300)}`,
      );
      break;
    }

    nodes.push(...(connection.nodes ?? []));
    if (!connection.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return { nodes, problems };
}

/** Turns the generic `fields { key value }` list into a plain object. */
function fieldMap(node) {
  const map = {};
  for (const field of node.fields ?? []) {
    if (field?.key != null) map[field.key] = field.value;
  }
  return map;
}

function safeJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Finds the definition on this store that actually holds our data.
 *
 * We cannot just query "$app:faq": that prefix always resolves to the
 * CURRENT client_id's reserved namespace. If the app was ever recreated or
 * reset, the merchant's entries sit in the previous app's namespace
 * ("app--<old_id>--faq") — present, intact, and invisible to a "$app:"
 * query. So we read the real type strings from metaobjectDefinitions and
 * pick the one holding the most entries.
 */
function pickDefinition(definitions, suffix) {
  return definitions
    .filter((d) => new RegExp(`(^|--)${suffix}$`).test(d.type))
    .sort((a, b) => (b.metaobjectsCount ?? 0) - (a.metaobjectsCount ?? 0))[0];
}

export async function importFromMetaobjects(ctx) {
  const stats = {
    categoriesFound: 0,
    categoriesImported: 0,
    faqsFound: 0,
    faqsImported: 0,
    faqType: null,
    categoryType: null,
    error: null,
  };
  if (!ctx?.graphql) return stats;

  const problems = [];
  const definitions = await inspectDefinitions(ctx);

  const faqDefinition = pickDefinition(definitions, "faq");
  const categoryDefinition = pickDefinition(definitions, "faq_category");

  stats.faqType = faqDefinition?.type ?? null;
  stats.categoryType = categoryDefinition?.type ?? null;

  if (!faqDefinition && !categoryDefinition) {
    stats.error =
      "No FAQ metaobject definition exists on this store — there is nothing left to recover.";
    return stats;
  }

  // GID ➜ local category id, so a FAQ's category reference (stored as a
  // raw metaobject GID) can be resolved after the categories are in.
  const categoryIdByGid = new Map();
  const categoryIdByHandle = new Map();

  /* --- categories first, so FAQs can be linked --- */
  if (categoryDefinition) {
    const result = await fetchDefinitionEntries(categoryDefinition.id, ctx.graphql);
    problems.push(...result.problems);
    stats.categoriesFound = result.nodes.length;

    for (const node of result.nodes) {
      const f = fieldMap(node);

      const existing = await prisma.category.findUnique({
        where: { shop_handle: { shop: ctx.shop, handle: node.handle } },
        select: { id: true },
      });
      if (existing) {
        categoryIdByGid.set(node.id, existing.id);
        categoryIdByHandle.set(node.handle, existing.id);
        continue;
      }

      const created = await prisma.category.create({
        data: {
          shop: ctx.shop,
          handle: node.handle,
          name: f.name || node.handle,
          icon: f.icon || "",
          iconImageUrl: f.icon_image_url || "",
          color: f.color || "",
          position: Number(f.position) || 0,
          // Publish state isn't in the generic field list; recovered
          // categories default to visible and can be hidden afterwards.
          visible: true,
          metaobjectId: node.id,
          syncedAt: new Date(),
        },
      });
      categoryIdByGid.set(node.id, created.id);
      categoryIdByHandle.set(node.handle, created.id);
      stats.categoriesImported += 1;
    }
  }

  /* --- then FAQs --- */
  if (faqDefinition) {
    const result = await fetchDefinitionEntries(faqDefinition.id, ctx.graphql);
    problems.push(...result.problems);
    stats.faqsFound = result.nodes.length;

    for (const node of result.nodes) {
      const f = fieldMap(node);

      // A definition can hold blank drafts; importing those would just
      // create empty rows the merchant has to clean up.
      const question = (f.question || "").trim();
      if (!question) continue;

      const existing = await prisma.faq.findUnique({
        where: { shop_handle: { shop: ctx.shop, handle: node.handle } },
        select: { id: true },
      });
      if (existing) continue;

      // `category` comes back as a raw GID; fall back to a handle lookup in
      // case an older entry stored it that way.
      const categoryId =
        categoryIdByGid.get(f.category) ??
        categoryIdByHandle.get(f.category) ??
        null;

      await prisma.faq.create({
        data: {
          shop: ctx.shop,
          handle: node.handle,
          question,
          answer: f.answer || "",
          status: f.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
          position: Number(f.position) || 0,
          categoryId,
          productIds: JSON.stringify(safeJsonArray(f.products)),
          collectionIds: JSON.stringify(safeJsonArray(f.collections)),
          metaobjectId: node.id,
          syncedAt: new Date(),
        },
      });
      stats.faqsImported += 1;
    }
  }

  if (problems.length) stats.error = problems.join(" | ");
  return stats;
}

/**
 * Diagnostic read: what app-reserved definitions does this store actually
 * have right now, and how many entries are in each? Running this is the
 * fastest way to tell "Shopify deleted my definition" apart from "the
 * $app: prefix now resolves to a different client_id".
 */
export async function inspectDefinitions(ctx) {
  if (!ctx?.graphql) return [];
  try {
    const response = await ctx.graphql(
      `#graphql
      query FaqlyDefinitions {
        metaobjectDefinitions(first: 50) {
          nodes { id type name metaobjectsCount }
        }
      }`,
    );
    const { data } = await response.json();
    return data?.metaobjectDefinitions?.nodes ?? [];
  } catch {
    return [];
  }
}
