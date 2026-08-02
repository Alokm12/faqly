// Backup / restore — plain JSON, no vendor lock-in.
//
// Two jobs:
//  1. Development insurance. Even with the database as source of truth, a
//     `prisma migrate reset` or a dropped container still takes local data
//     with it. One export file makes that a non-event.
//  2. A real merchant feature. "Export your FAQs" is table stakes for App
//     Store reviewers asking about data portability, and it doubles as the
//     migration path for merchants arriving from a competitor's app.

import prisma from "../db.server";
import { sanitizeHexColor, sanitizeImageUrl } from "../models/Category.server";
import { UserError } from "../models/errors";

const BACKUP_VERSION = 1;

export async function exportBackup(ctx) {
  const [categories, faqs, setting] = await Promise.all([
    prisma.category.findMany({
      where: { shop: ctx.shop },
      orderBy: { position: "asc" },
    }),
    prisma.faq.findMany({
      where: { shop: ctx.shop },
      include: { category: { select: { handle: true } } },
      orderBy: { position: "asc" },
    }),
    prisma.setting.findUnique({ where: { shop: ctx.shop } }),
  ]);

  return {
    version: BACKUP_VERSION,
    app: "faqly",
    shop: ctx.shop,
    exportedAt: new Date().toISOString(),
    settings: setting
      ? {
          poweredByVisible: setting.poweredByVisible,
          schemaEnabled: setting.schemaEnabled,
          feedbackEnabled: setting.feedbackEnabled,
          analyticsEnabled: setting.analyticsEnabled,
          defaultStatus: setting.defaultStatus,
        }
      : null,
    categories: categories.map((c) => ({
      handle: c.handle,
      name: c.name,
      icon: c.icon,
      iconImageUrl: c.iconImageUrl,
      color: c.color,
      position: c.position,
      visible: c.visible,
    })),
    faqs: faqs.map((f) => ({
      handle: f.handle,
      question: f.question,
      answer: f.answer,
      status: f.status,
      position: f.position,
      categoryHandle: f.category?.handle ?? null,
      // Product/collection GIDs are store-specific. They are exported for
      // same-store restores and deliberately dropped when importing into a
      // different shop — see importBackup.
      productIds: JSON.parse(f.productIds || "[]"),
      collectionIds: JSON.parse(f.collectionIds || "[]"),
    })),
  };
}

/**
 * Import is the loudest untrusted-input path in the app: the payload is a
 * JSON file the merchant uploaded, and "here's our FAQ export, just import
 * it" is a plausible way to hand someone a hostile file. Everything
 * written below is treated as attacker-controlled, not as data this app
 * produced.
 *
 * The two field-level sanitizers that needs (color, icon URL) live in
 * Category.server.js rather than here, so the admin form and this importer
 * cannot drift apart — see the comments there for what each defends.
 *
 * @param {object} payload Parsed backup JSON.
 * @param {object} ctx
 * @param {"skip"|"overwrite"} mode  How to treat handles that already exist.
 *   "skip" (default) is non-destructive and safe to run on a live store.
 */
export async function importBackup(payload, ctx, mode = "skip") {
  if (!payload || payload.app !== "faqly") {
    throw new UserError("This file isn't a Faqly backup.");
  }
  if (payload.version > BACKUP_VERSION) {
    throw new UserError(
      `Backup was made by a newer version of Faqly (v${payload.version}). Update the app first.`,
    );
  }

  // Restoring into a different store than the one that produced the file is
  // allowed — that's how you copy a FAQ set from a staging store to live —
  // but product/collection GIDs from the old store point at resources that
  // don't exist here, so targeting is reset to store-wide instead of
  // silently pinning FAQs to random IDs.
  const sameShop = payload.shop === ctx.shop;

  const stats = {
    categoriesImported: 0,
    categoriesSkipped: 0,
    faqsImported: 0,
    faqsSkipped: 0,
    targetingReset: !sameShop,
  };

  const categoryIdByHandle = new Map();

  for (const c of payload.categories ?? []) {
    if (!c.handle) continue;
    const existing = await prisma.category.findUnique({
      where: { shop_handle: { shop: ctx.shop, handle: c.handle } },
      select: { id: true },
    });

    if (existing && mode === "skip") {
      categoryIdByHandle.set(c.handle, existing.id);
      stats.categoriesSkipped += 1;
      continue;
    }

    const data = {
      name: String(c.name ?? c.handle),
      icon: String(c.icon ?? ""),
      iconImageUrl: sameShop ? sanitizeImageUrl(c.iconImageUrl) : "",
      color: sanitizeHexColor(c.color),
      position: Number(c.position) || 0,
      visible: c.visible !== false,
    };

    const row = await prisma.category.upsert({
      where: { shop_handle: { shop: ctx.shop, handle: c.handle } },
      create: { shop: ctx.shop, handle: c.handle, ...data },
      update: data,
    });
    categoryIdByHandle.set(c.handle, row.id);
    stats.categoriesImported += 1;
  }

  for (const f of payload.faqs ?? []) {
    if (!f.handle || !f.question) continue;
    const existing = await prisma.faq.findUnique({
      where: { shop_handle: { shop: ctx.shop, handle: f.handle } },
      select: { id: true },
    });

    if (existing && mode === "skip") {
      stats.faqsSkipped += 1;
      continue;
    }

    const data = {
      question: String(f.question),
      answer: String(f.answer ?? ""),
      status: f.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      position: Number(f.position) || 0,
      categoryId: f.categoryHandle
        ? (categoryIdByHandle.get(f.categoryHandle) ?? null)
        : null,
      productIds: JSON.stringify(sameShop ? (f.productIds ?? []) : []),
      collectionIds: JSON.stringify(sameShop ? (f.collectionIds ?? []) : []),
    };

    await prisma.faq.upsert({
      where: { shop_handle: { shop: ctx.shop, handle: f.handle } },
      create: { shop: ctx.shop, handle: f.handle, ...data },
      update: data,
    });
    stats.faqsImported += 1;
  }

  if (payload.settings) {
    const s = payload.settings;
    const data = {
      poweredByVisible: Boolean(s.poweredByVisible),
      schemaEnabled: Boolean(s.schemaEnabled),
      feedbackEnabled: Boolean(s.feedbackEnabled),
      analyticsEnabled: Boolean(s.analyticsEnabled),
      defaultStatus: s.defaultStatus === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    };
    await prisma.setting.upsert({
      where: { shop: ctx.shop },
      create: { shop: ctx.shop, ...data },
      update: data,
    });
  }

  return stats;
}
