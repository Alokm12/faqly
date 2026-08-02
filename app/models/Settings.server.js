// App-wide Settings model — one row per shop.
//
// This used to be a fixed-handle metaobject ("faqly-settings"). Reads
// masked their own failure by falling back to DEFAULTS, so a missing or
// deleted definition looked fine on the Settings page right up until the
// merchant pressed Save and got an error. A real column has no such
// failure mode.
//
// APPEARANCE VALUES ARE UNTRUSTED INPUT
// Everything under "Appearance" below ends up inside a `style` attribute
// in a shopper's browser, as a CSS custom property. A merchant is not an
// attacker, but the Settings form is not the only way these get written —
// the backup importer takes a JSON file the merchant supplies, and a
// hand-edited one reaches `saveSettings` directly. So the colour is
// pattern-matched against a strict hex, every number is clamped to the
// range its slider offers, and anything that fails falls back to the
// default rather than being passed through. `sanitizeAppearance` is the
// single place that happens, and both the write path and the storefront
// read path go through it.

import prisma from "../db.server";

export const SETTINGS_DEFAULTS = {
  poweredByVisible: true,
  schemaEnabled: false,
  feedbackEnabled: false,
  analyticsEnabled: true,
  defaultStatus: "DRAFT",

  // Appearance — identical to the theme block-schema defaults these
  // replaced, so an untouched install looks the same after the move.
  accentColor: "#4A5D3A",
  fontSize: 16,
  radiusWidget: 21,
  radiusTabbar: 50,
  radiusPill: 40,
  radiusCard: 14,
  radiusButton: 8,
  radiusIcon: 50,

  searchEnabled: true,
  searchPlaceholder: "Search for answers…",
};

/**
 * The bounds each appearance slider offers, and the bounds the server
 * enforces. Exported because the Appearance tab renders its sliders from
 * this exact object — a range that exists in two places drifts, and the
 * half that drifts is always the one that stops matching validation.
 */
export const APPEARANCE_RANGES = {
  fontSize: { min: 12, max: 22, step: 1, unit: "px", label: "Font size" },
  radiusWidget: { min: 0, max: 60, step: 1, unit: "px", label: "Widget container" },
  radiusCard: { min: 0, max: 40, step: 1, unit: "px", label: "FAQ cards" },
  radiusTabbar: { min: 0, max: 60, step: 1, unit: "px", label: "Category bar" },
  radiusPill: { min: 0, max: 40, step: 1, unit: "px", label: "Category pills" },
  radiusButton: { min: 0, max: 40, step: 1, unit: "px", label: "Buttons" },
  radiusIcon: { min: 0, max: 50, step: 1, unit: "%", label: "Icons" },
};

/** Longest storefront search placeholder we will store. */
const PLACEHOLDER_MAX = 80;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * The eight presets the Appearance tab offers as swatches.
 *
 * The first is the widget's own default; the rest are picked to stay
 * legible as button and link colours on a white card — every one clears
 * 4.5:1 against #FFFFFF, because the widget renders question text and
 * button labels in the accent colour.
 */
export const ACCENT_PRESETS = [
  { value: "#4A5D3A", name: "Forest" },
  { value: "#2563EB", name: "Blue" },
  { value: "#7C3AED", name: "Violet" },
  { value: "#DC2626", name: "Red" },
  { value: "#B45309", name: "Amber" },
  { value: "#0F766E", name: "Teal" },
  { value: "#BE185D", name: "Pink" },
  { value: "#334155", name: "Slate" },
];

function clampInt(value, { min, max }, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Coerces whatever it is given into appearance values that are safe to
 * interpolate into CSS. Never throws and never returns a partial object.
 */
export function sanitizeAppearance(input = {}) {
  const color = typeof input.accentColor === "string" ? input.accentColor.trim() : "";

  const placeholder =
    typeof input.searchPlaceholder === "string"
      ? input.searchPlaceholder.trim().slice(0, PLACEHOLDER_MAX)
      : "";

  const out = {
    accentColor: HEX_COLOR.test(color) ? color : SETTINGS_DEFAULTS.accentColor,
    searchEnabled: Boolean(input.searchEnabled),
    // An empty placeholder would render an unlabelled search box, so the
    // default stands in rather than being stored blank.
    searchPlaceholder: placeholder || SETTINGS_DEFAULTS.searchPlaceholder,
  };

  for (const [key, range] of Object.entries(APPEARANCE_RANGES)) {
    out[key] = clampInt(input[key], range, SETTINGS_DEFAULTS[key]);
  }

  return out;
}

function normalize(row) {
  if (!row) return { ...SETTINGS_DEFAULTS };
  return {
    poweredByVisible: row.poweredByVisible,
    schemaEnabled: row.schemaEnabled,
    feedbackEnabled: row.feedbackEnabled,
    analyticsEnabled: row.analyticsEnabled,
    defaultStatus: row.defaultStatus || SETTINGS_DEFAULTS.defaultStatus,
    // Re-sanitized on read, not just on write: rows written before this
    // validation existed are still in merchants' databases, and this is
    // the last hop before the values become CSS in a shopper's browser.
    ...sanitizeAppearance(row),
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
    ...sanitizeAppearance(settings),
  };

  const row = await prisma.setting.upsert({
    where: { shop: ctx.shop },
    create: { shop: ctx.shop, ...data },
    update: data,
  });

  return normalize(row);
}
