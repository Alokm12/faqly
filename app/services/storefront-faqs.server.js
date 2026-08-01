// Storefront read path — the one query that runs on real shopper traffic.
//
// It deliberately does NOT touch the Admin API. The old App Proxy loader
// made three Admin GraphQL round-trips (FAQs, categories, settings) on
// every product-page view, which put shopper-facing latency and Shopify's
// rate limit on the critical path. This is now a single indexed database
// read.

import prisma from "../db.server";
import { SETTINGS_DEFAULTS } from "../models/Settings.server";

function parseIds(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numericId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * @param {string} shop
 * @param {object} params
 * @param {string|null} params.productId       Numeric product id from Liquid.
 * @param {string[]}    params.collectionIds   Numeric collection ids.
 */
export async function getStorefrontFaqs(shop, { productId, collectionIds }) {
  const [rows, categories, setting] = await Promise.all([
    prisma.faq.findMany({
      where: { shop, status: "PUBLISHED" },
      include: { category: { select: { handle: true, visible: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.category.findMany({
      where: { shop, visible: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.setting.findUnique({ where: { shop } }),
  ]);

  const collectionSet = new Set(collectionIds ?? []);

  const visible = rows.filter((row) => {
    // A FAQ inside a hidden category disappears with it rather than falling
    // back into "General", which would defeat the point of hiding it.
    if (row.category && row.category.visible === false) return false;

    const products = parseIds(row.productIds);
    const collections = parseIds(row.collectionIds);
    if (!products.length && !collections.length) return true;

    if (productId && products.some((gid) => numericId(gid) === productId)) {
      return true;
    }
    if (
      collectionSet.size &&
      collections.some((gid) => collectionSet.has(numericId(gid)))
    ) {
      return true;
    }
    return false;
  });

  const meta = new Map(
    categories.map((c) => [
      c.handle,
      { name: c.name, icon: c.icon, iconImageUrl: c.iconImageUrl, color: c.color },
    ]),
  );

  const buckets = new Map();
  for (const row of visible) {
    const handle = row.category?.handle ?? null;
    const key = handle || "__general__";
    if (!buckets.has(key)) {
      const info = handle ? meta.get(handle) : null;
      buckets.set(key, {
        key,
        name: info?.name || "General",
        icon: info?.icon || "",
        iconImageUrl: info?.iconImageUrl || "",
        color: info?.color || "",
        faqs: [],
      });
    }
    buckets.get(key).faqs.push({ question: row.question, answer: row.answer });
  }

  // Category order drives group order; ungrouped FAQs always land last.
  const ordered = categories
    .map((c) => buckets.get(c.handle))
    .filter(Boolean);
  if (buckets.has("__general__")) ordered.push(buckets.get("__general__"));

  return {
    categories: ordered,
    poweredByVisible:
      setting?.poweredByVisible ?? SETTINGS_DEFAULTS.poweredByVisible,
    schemaEnabled: setting?.schemaEnabled ?? SETTINGS_DEFAULTS.schemaEnabled,
  };
}
