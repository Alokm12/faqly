// App-wide Settings model — one row per shop.
//
// This used to be a fixed-handle metaobject ("faqly-settings"). Reads
// masked their own failure by falling back to DEFAULTS, so a missing or
// deleted definition looked fine on the Settings page right up until the
// merchant pressed Save and got an error. A real column has no such
// failure mode.

import prisma from "../db.server";

export const SETTINGS_DEFAULTS = {
  poweredByVisible: true,
  schemaEnabled: false,
  feedbackEnabled: false,
  analyticsEnabled: true,
  defaultStatus: "DRAFT",
};

function normalize(row) {
  if (!row) return { ...SETTINGS_DEFAULTS };
  return {
    poweredByVisible: row.poweredByVisible,
    schemaEnabled: row.schemaEnabled,
    feedbackEnabled: row.feedbackEnabled,
    analyticsEnabled: row.analyticsEnabled,
    defaultStatus: row.defaultStatus || SETTINGS_DEFAULTS.defaultStatus,
  };
}

export async function getSettings(ctx) {
  const row = await prisma.setting.findUnique({ where: { shop: ctx.shop } });
  return normalize(row);
}

export async function saveSettings(settings, ctx) {
  const data = {
    poweredByVisible: Boolean(settings.poweredByVisible),
    schemaEnabled: Boolean(settings.schemaEnabled),
    feedbackEnabled: Boolean(settings.feedbackEnabled),
    analyticsEnabled: Boolean(settings.analyticsEnabled),
    defaultStatus:
      settings.defaultStatus === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
  };

  const row = await prisma.setting.upsert({
    where: { shop: ctx.shop },
    create: { shop: ctx.shop, ...data },
    update: data,
  });

  return normalize(row);
}
