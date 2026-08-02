// FAQ Category data model — database-backed, same pattern as Faq.server.js.
//
// `visible` used to be inferred from the metaobject's `publishable`
// capability, which meant storefront visibility could silently drift from
// what the admin UI showed whenever a capability write failed. It is now a
// plain boolean column: one source of truth, no capability round-trip.

import prisma from "../db.server";
import {
  syncCategory,
  syncCategoryDeletion,
} from "../services/metaobject-sync.server";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A category color ends up inside a CSS custom property on the
 * storefront (`--faqly-category-color`). Custom properties accept almost
 * any token stream, so an unvalidated value can smuggle a `url(...)` into
 * whatever declaration consumes it — an outbound request fired from every
 * product page carrying the widget.
 *
 * `validateCategory` already rejects non-hex on the admin form, but the
 * form is not the only writer: JSON backup import (app.data.jsx) accepts
 * an arbitrary uploaded file, and a merchant importing a FAQ set someone
 * emailed them is a realistic path for a hostile value. So sanitizing
 * happens at the model layer, where every write goes through it, rather
 * than at each caller. Anything that isn't a 6-digit hex becomes "" —
 * the widget then falls back to the theme's accent color.
 */
export function sanitizeHexColor(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed : "";
}

/**
 * Same reasoning as sanitizeHexColor, for the category icon image.
 *
 * The upload route hands back a Shopify CDN URL, but that value makes a
 * round trip through a hidden form field before it gets here, and the
 * backup importer writes it straight from an uploaded file — so by the
 * time it reaches this layer it is an arbitrary merchant-controlled
 * string, not something the app produced. It ends up in an `<img src>` in
 * the admin, where a `javascript:` URL does not execute, but a `data:` or
 * third-party URL still turns every category list render into an outbound
 * request we didn't intend.
 *
 * This used to live in backup.server.js, which meant the one writer that
 * happened to be audited was protected and the two ordinary ones weren't.
 * Sanitizing here covers every write path by construction.
 */
export function sanitizeImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    // Not an absolute URL. Relative paths are never legitimate here — the
    // only writer that should succeed is the CDN upload — so reject.
    return "";
  }
}

function normalizeCategory(row) {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name ?? "",
    icon: row.icon ?? "",
    iconImageUrl: row.iconImageUrl ?? "",
    color: row.color ?? "",
    position: row.position ?? 0,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt ?? null,
    visible: row.visible !== false,
  };
}

export async function getCategory(handle, ctx) {
  const row = await prisma.category.findUnique({
    where: { shop_handle: { shop: ctx.shop, handle } },
  });
  return row ? normalizeCategory(row) : null;
}

export async function getCategories(ctx) {
  const rows = await prisma.category.findMany({
    where: { shop: ctx.shop },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(normalizeCategory);
}

/**
 * Returns each category's FAQ count in a single grouped query.
 * The list page previously loaded every FAQ just to count them per
 * category — fine at 20 FAQs, wasteful at 500.
 */
export async function getCategoryFaqCounts(ctx) {
  const grouped = await prisma.faq.groupBy({
    by: ["categoryId"],
    where: { shop: ctx.shop },
    _count: { _all: true },
  });
  return Object.fromEntries(
    grouped.map((g) => [g.categoryId ?? "__general__", g._count._all]),
  );
}

export async function saveCategory(handle, category, ctx) {
  const data = {
    name: category.name,
    icon: category.icon || "",
    iconImageUrl: sanitizeImageUrl(category.iconImageUrl),
    color: sanitizeHexColor(category.color),
  };
  if (category.position !== undefined) {
    data.position = Number(category.position) || 0;
  }
  if (category.visible !== undefined) {
    data.visible = Boolean(category.visible);
  }

  const row = await prisma.category.upsert({
    where: { shop_handle: { shop: ctx.shop, handle } },
    create: {
      shop: ctx.shop,
      handle,
      position: data.position ?? 0,
      visible: data.visible ?? true,
      ...data,
    },
    update: data,
  });

  await syncCategory(row, ctx);
  return { id: row.id, handle: row.handle };
}

export async function reorderCategories(orderedIds, ctx) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return;

  await prisma.$transaction(
    orderedIds.map((id, position) =>
      prisma.category.updateMany({
        where: { id, shop: ctx.shop },
        data: { position },
      }),
    ),
  );

  const rows = await prisma.category.findMany({
    where: { id: { in: orderedIds }, shop: ctx.shop },
  });
  for (const row of rows) await syncCategory(row, ctx);
}

export async function setCategoryVisibility(id, visible, ctx) {
  const result = await prisma.category.updateMany({
    where: { id, shop: ctx.shop },
    data: { visible: Boolean(visible) },
  });
  if (!result.count) return null;

  const row = await prisma.category.findUnique({ where: { id } });
  await syncCategory(row, ctx);
  return { id: row.id };
}

/**
 * Deleting a category does NOT delete its FAQs — the schema's
 * `onDelete: SetNull` moves them to "General" instead. Destroying a
 * merchant's written content as a side effect of tidying up categories
 * would be an unforgivable surprise, and it is the kind of thing App Store
 * reviewers ask about.
 */
export async function deleteCategory(id, ctx) {
  const row = await prisma.category.findFirst({ where: { id, shop: ctx.shop } });
  if (!row) return;

  await prisma.category.delete({ where: { id } });
  await syncCategoryDeletion(row, ctx);
}

export function validateCategory(data) {
  const errors = {};
  if (!data.name || !data.name.trim()) {
    errors.name = "Name is required";
  }
  if (data.color && !/^#[0-9a-fA-F]{6}$/.test(data.color)) {
    errors.color = "Color must be a hex value like #5C6AC4";
  }
  return errors;
}

export function generateCategoryHandle(name) {
  const slug =
    (name || "category")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "category";
  return `${slug}-${Date.now().toString(36)}`;
}
