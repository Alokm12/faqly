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
    iconImageUrl: category.iconImageUrl || "",
    color: category.color || "",
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

export async function updateCategoryFields(id, fields, ctx) {
  const data = {};
  if (fields.position !== undefined) data.position = Number(fields.position) || 0;
  if (fields.name !== undefined) data.name = String(fields.name);
  if (fields.color !== undefined) data.color = String(fields.color);
  if (fields.icon !== undefined) data.icon = String(fields.icon);
  if (fields.iconImageUrl !== undefined) {
    data.iconImageUrl = String(fields.iconImageUrl);
  }

  if (!Object.keys(data).length) return null;

  const result = await prisma.category.updateMany({
    where: { id, shop: ctx.shop },
    data,
  });
  if (!result.count) return null;

  const row = await prisma.category.findUnique({ where: { id } });
  await syncCategory(row, ctx);
  return { id: row.id };
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
