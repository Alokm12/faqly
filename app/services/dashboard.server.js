// Dashboard read layer.
//
// EVERY NUMBER ON THE DASHBOARD IS PRODUCED HERE, and every one of them is
// a count of rows that actually exist. Nothing is estimated, extrapolated
// or placeholder. Shopify's non-deceptive-code policy treats an invented
// metric as grounds for rejection, and there is no honest way to show a
// "views" figure before the tracking that produces it exists. Metrics with
// no source are therefore absent rather than zero-filled — see the Phase 2
// note at the bottom of this file.
//
// WHAT THE DASHBOARD LAYOUT ASKS FOR, AND WHERE IT COMES FROM
//   stat tiles + deltas   → groupBy on status, plus createdAt within 7 days
//   12-month bar chart    → FAQ.createdAt bucketed into UTC months
//   activity feed         → FAQ/Category createdAt vs updatedAt
//   category meters       → Category._count.faqs
//   "needs attention"     → the four probes below
// Nothing here is a view, a vote or a search term, because nothing in the
// schema records one.
//
// WHY A SERVICE AND NOT INLINE IN THE ROUTE
// The route already has to juggle a deferred Admin API call and a URL
// range param; keeping the queries here means the shape the component
// renders is defined in one place, and the "is this real data?" review can
// happen by reading one file.
//
// QUERY BUDGET
// One `groupBy` covers total/published/draft, so the status tiles are a
// single round trip rather than three counts. Categories are loaded once,
// with their FAQ counts, and everything category-shaped on the page —
// the tile, the meters, the empty-category warning, the activity feed —
// is derived from that one result set rather than re-queried. The probes
// that remain are each indexed, bounded by `take`, and select only the
// columns a row renders. They all run in one Promise.all.

import prisma from "../db.server";
import { FaqStatus } from "../models/faq-status";
import {
  isSeedFaqHandle,
  isSeedCategoryHandle,
  isUnedited,
} from "./seed.server";

/** A draft nobody has touched in this long is probably forgotten, not in progress. */
const STALE_DRAFT_DAYS = 7;

/** Rows shown per needs-attention group before "and N more". */
const ATTENTION_SAMPLE = 5;

/** Events in the activity rail. Six fills the column beside the chart. */
const ACTIVITY_LIMIT = 6;

/**
 * FAQs pulled for the activity rail. Deliberately more than ACTIVITY_LIMIT:
 * categories compete for the same six slots, so a store that only ever
 * edits FAQs would otherwise show fewer than six events.
 */
const ACTIVITY_FAQ_POOL = ACTIVITY_LIMIT * 2;

/** Rows in the category meter list. The rest are reachable via "View all". */
const CATEGORY_METER_LIMIT = 5;

/** Months in the trend chart. */
const CHART_MONTHS = 12;

/** Window for the "+N this week" line under a stat tile. */
const WEEK_DAYS = 7;

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Stat tile ranges. `null` means all time.
 *
 * A range filters on `createdAt`, so the tiles genuinely answer "how much
 * did I add in this window" — they are not a fabricated trend line. The
 * tile labels change with the range for exactly this reason: "Total FAQs"
 * and "FAQs created" are different claims and must not share a label.
 */
export const STAT_RANGES = {
  all: { label: "All time", short: "All time", days: null },
  "30d": { label: "Last 30 days", short: "30 days", days: 30 },
  "7d": { label: "Last 7 days", short: "7 days", days: 7 },
};

export const DEFAULT_RANGE = "all";

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Relative age is computed here, on the server, as an integer.
 *
 * Formatting a date during render would compare the browser's clock and
 * locale against the server's and produce a hydration mismatch on every
 * row. An integer resolved once in the loader renders identically in both
 * places, and the component turns it into words.
 */
function agoDays(value) {
  if (!value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86_400_000));
}

/**
 * Same idea as `agoDays`, but resolved all the way to words here rather
 * than in the component.
 *
 * The activity rail needs minute-level precision ("2 min ago"), and a
 * minute count is the one thing that genuinely differs between the moment
 * the server renders and the moment the browser hydrates. Freezing the
 * finished string in loader data means both passes emit identical markup;
 * it goes stale until the next navigation, which is the correct trade for
 * an advisory timestamp.
 */
function relativeLabel(value) {
  if (!value) return "";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "";

  const minutes = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function toRow(faq) {
  return {
    id: faq.id,
    handle: faq.handle,
    question: faq.question,
    updatedAgoDays: agoDays(faq.updatedAt),
    updatedAgo: relativeLabel(faq.updatedAt),
  };
}

/**
 * A row's `updatedAt` is set to `createdAt` on insert, so "was this made or
 * merely changed?" is a comparison of the two. The two-second slack absorbs
 * the gap between a create and the metaobject-mirror write that follows it,
 * which would otherwise report every brand-new FAQ as "edited".
 */
function isFreshlyCreated(row) {
  const created = new Date(row.createdAt).getTime();
  const updated = new Date(row.updatedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  return updated - created < 2_000;
}

/** First day of the month `offset` months from `date`, in UTC. */
function monthStart(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

/**
 * Twelve buckets, oldest first, every one present even when empty.
 *
 * Bucketing in UTC rather than the merchant's timezone can move a FAQ
 * created within a few hours of a month boundary into the neighbouring
 * column. That is invisible at this scale and costs nothing; per-row
 * timezone conversion for a 12-bar chart would not be.
 */
function buildMonthlySeries(rows) {
  const now = new Date();
  const series = [];
  for (let i = CHART_MONTHS - 1; i >= 0; i -= 1) {
    const start = monthStart(now, -i);
    series.push({
      key: monthKey(start),
      label: MONTH_SHORT[start.getUTCMonth()],
      fullLabel: `${MONTH_LONG[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
      value: 0,
    });
  }

  const byKey = new Map(series.map((point) => [point.key, point]));
  for (const row of rows) {
    const created = new Date(row.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const point = byKey.get(monthKey(created));
    if (point) point.value += 1;
  }
  return series;
}

/**
 * @param {object} ctx  { shop, graphql } from models/context.server.js
 * @param {object} [options]
 * @param {string} [options.range]  Key of STAT_RANGES.
 */
export async function getDashboardData(ctx, { range = DEFAULT_RANGE } = {}) {
  const shop = ctx.shop;
  const rangeKey = STAT_RANGES[range] ? range : DEFAULT_RANGE;
  const rangeMeta = STAT_RANGES[rangeKey];
  const rangeDays = rangeMeta.days;
  const rangeFilter = rangeDays ? { createdAt: { gte: daysAgo(rangeDays) } } : {};
  const staleBefore = daysAgo(STALE_DRAFT_DAYS);
  const weekBefore = daysAgo(WEEK_DAYS);
  const chartStart = monthStart(new Date(), -(CHART_MONTHS - 1));

  const [
    statusGroups,
    rangeStatusGroups,
    categories,
    seedFaqs,
    chartRows,
    staleDrafts,
    staleDraftCount,
    emptyAnswers,
    emptyAnswerCount,
    uncategorizedCount,
    recentFaqs,
  ] = await Promise.all([
    // All-time status counts. The checklist is always judged on all time —
    // a merchant who published something last year has published something.
    prisma.faq.groupBy({
      by: ["status"],
      where: { shop },
      _count: { _all: true },
    }),
    // Skipped entirely on the default range so the common case stays at one
    // groupBy rather than two identical ones.
    rangeDays
      ? prisma.faq.groupBy({
          by: ["status"],
          where: { shop, ...rangeFilter },
          _count: { _all: true },
        })
      : Promise.resolve(null),

    // The one category query. FAQ counts come back with it as a subquery,
    // which is what lets the meters, the tile, the empty-category warning
    // and the activity feed all be derived rather than re-queried.
    prisma.category.findMany({
      where: { shop },
      select: {
        id: true,
        handle: true,
        name: true,
        color: true,
        visible: true,
        position: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { faqs: true } },
      },
      orderBy: { position: "asc" },
    }),

    // Bounded by construction: there are only ever SEED_FAQ_COUNT of these,
    // and the startsWith prefix keeps it off a full scan of merchant rows.
    prisma.faq.findMany({
      where: { shop, handle: { startsWith: "faqly-" } },
      select: { id: true, handle: true, question: true, createdAt: true, updatedAt: true },
    }),

    // One column, one indexed range predicate. This is the only query on
    // the page whose row count grows with the catalogue, so it is capped at
    // the chart window rather than the whole table.
    prisma.faq.findMany({
      where: { shop, createdAt: { gte: chartStart } },
      select: { createdAt: true },
    }),

    prisma.faq.findMany({
      where: { shop, status: FaqStatus.DRAFT, updatedAt: { lt: staleBefore } },
      select: { id: true, handle: true, question: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: ATTENTION_SAMPLE,
    }),
    prisma.faq.count({
      where: { shop, status: FaqStatus.DRAFT, updatedAt: { lt: staleBefore } },
    }),

    // `answer: ""` catches exact-empty only. A whitespace-only answer would
    // slip through: `validateFaq` blocks it on the form, so the only way to
    // create one is a hand-edited backup import. Catching it properly needs
    // TRIM(), which means a raw query — not worth introducing the app's only
    // raw SQL, and its portability across the pending Postgres move, for a
    // case the UI already prevents.
    prisma.faq.findMany({
      where: { shop, answer: "" },
      select: { id: true, handle: true, question: true, updatedAt: true },
      take: ATTENTION_SAMPLE,
    }),
    prisma.faq.count({ where: { shop, answer: "" } }),

    prisma.faq.count({ where: { shop, categoryId: null } }),

    prisma.faq.findMany({
      where: { shop },
      select: {
        id: true,
        handle: true,
        question: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: ACTIVITY_FAQ_POOL,
    }),
  ]);

  const countsFrom = (groups) => {
    const published =
      groups?.find((g) => g.status === FaqStatus.PUBLISHED)?._count._all ?? 0;
    const draft =
      groups?.find((g) => g.status === FaqStatus.DRAFT)?._count._all ?? 0;
    // Any unexpected status still counts toward the total rather than
    // vanishing, so the tiles always add up to the real row count.
    const total = (groups ?? []).reduce((sum, g) => sum + g._count._all, 0);
    return { total, published, draft };
  };

  const allTime = countsFrom(statusGroups);
  const inRange = rangeDays ? countsFrom(rangeStatusGroups) : allTime;

  /* ---------------------------------------------------------------- */
  /* Category derivations — all from the single findMany above         */
  /* ---------------------------------------------------------------- */

  const categoryCount = categories.length;
  const rangeCategoryCount = rangeDays
    ? categories.filter((c) => new Date(c.createdAt) >= daysAgo(rangeDays)).length
    : categoryCount;
  const categoriesThisWeek = categories.filter(
    (c) => new Date(c.createdAt) >= weekBefore,
  ).length;
  const emptyCategories = categories.filter((c) => c._count.faqs === 0);

  /* ---------------------------------------------------------------- */
  /* Starter content                                                   */
  /* ---------------------------------------------------------------- */

  const untouchedSeedFaqs = seedFaqs.filter(
    (f) => isSeedFaqHandle(f.handle) && isUnedited(f),
  );
  const untouchedSeedCategories = categories.filter(
    (c) => isSeedCategoryHandle(c.handle) && isUnedited(c),
  );

  // "Has the merchant made anything of their own?" — true when at least one
  // row is not an untouched starter row. Editing a starter FAQ counts: they
  // made it theirs.
  const hasOwnFaq = allTime.total > untouchedSeedFaqs.length;
  const hasOwnCategory = categoryCount > untouchedSeedCategories.length;

  /* ---------------------------------------------------------------- */
  /* Needs attention                                                   */
  /* ---------------------------------------------------------------- */

  const attention = [];

  if (untouchedSeedFaqs.length) {
    attention.push({
      key: "starter",
      // Deliberately the first item: publishing invented shipping and
      // returns policies to a live storefront is the highest-consequence
      // mistake this app makes possible.
      tone: "warning",
      icon: "alert-triangle",
      title: `${untouchedSeedFaqs.length} starter FAQ${untouchedSeedFaqs.length === 1 ? "" : "s"} still unedited`,
      description:
        "These came with the app and contain example policies. Edit them to match your store before publishing.",
      count: untouchedSeedFaqs.length,
      rows: untouchedSeedFaqs.slice(0, ATTENTION_SAMPLE).map((f) => ({
        ...toRow(f),
        href: `/app/faqs/${f.handle}`,
      })),
    });
  }

  if (emptyAnswerCount) {
    attention.push({
      key: "empty-answer",
      tone: "critical",
      icon: "alert-triangle",
      title: `${emptyAnswerCount} FAQ${emptyAnswerCount === 1 ? " has" : "s have"} no answer`,
      description: "A question with a blank answer renders as an empty accordion row.",
      count: emptyAnswerCount,
      rows: emptyAnswers.map((f) => ({ ...toRow(f), href: `/app/faqs/${f.handle}` })),
    });
  }

  if (staleDraftCount) {
    attention.push({
      key: "stale-drafts",
      tone: "caution",
      icon: "clock",
      title: `${staleDraftCount} draft${staleDraftCount === 1 ? "" : "s"} untouched for ${STALE_DRAFT_DAYS}+ days`,
      description: "Drafts are invisible to shoppers until you publish them.",
      count: staleDraftCount,
      rows: staleDrafts.map((f) => ({ ...toRow(f), href: `/app/faqs/${f.handle}` })),
    });
  }

  if (emptyCategories.length) {
    attention.push({
      key: "empty-categories",
      tone: "info",
      icon: "categories",
      title: `${emptyCategories.length} categor${emptyCategories.length === 1 ? "y has" : "ies have"} no FAQs`,
      description: "Empty categories don't appear on the storefront.",
      count: emptyCategories.length,
      rows: emptyCategories.slice(0, ATTENTION_SAMPLE).map((c) => ({
        id: c.id,
        handle: c.handle,
        question: c.name,
        updatedAgoDays: null,
        updatedAgo: "",
        href: `/app/categories/${c.handle}`,
      })),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Trend chart                                                       */
  /* ---------------------------------------------------------------- */

  const series = buildMonthlySeries(chartRows);
  const faqsThisWeek = chartRows.filter(
    (row) => new Date(row.createdAt) >= weekBefore,
  ).length;

  /* ---------------------------------------------------------------- */
  /* Activity rail                                                     */
  /* ---------------------------------------------------------------- */

  // FAQs and categories are interleaved by timestamp, then the sort key is
  // dropped — the component only ever renders the pre-formatted `ago`
  // string, so shipping an epoch it would have to re-format invites exactly
  // the hydration mismatch `relativeLabel` exists to avoid.
  const activity = [
    ...recentFaqs.map((faq) => {
      const created = isFreshlyCreated(faq);
      return {
        at: new Date(faq.updatedAt).getTime(),
        id: `faq-${faq.id}`,
        kind: created ? "faq-created" : "faq-edited",
        title: created ? "FAQ created" : "FAQ edited",
        detail: faq.question || "Untitled",
        href: `/app/faqs/${faq.handle}`,
        ago: relativeLabel(faq.updatedAt),
      };
    }),
    ...categories.map((category) => {
      const created = isFreshlyCreated(category);
      return {
        at: new Date(category.updatedAt).getTime(),
        id: `category-${category.id}`,
        kind: created ? "category-created" : "category-edited",
        title: created ? "Category created" : "Category edited",
        detail: category.name || "Untitled",
        href: `/app/categories/${category.handle}`,
        ago: relativeLabel(category.updatedAt),
      };
    }),
  ]
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, ACTIVITY_LIMIT)
    // eslint-disable-next-line no-unused-vars
    .map(({ at, ...event }) => event);

  /* ---------------------------------------------------------------- */
  /* Category meters                                                   */
  /* ---------------------------------------------------------------- */

  const ranked = [...categories]
    .sort((a, b) => b._count.faqs - a._count.faqs || a.position - b.position)
    .slice(0, CATEGORY_METER_LIMIT)
    .map((category) => ({
      id: category.id,
      name: category.name || "Untitled",
      href: `/app/categories/${category.handle}`,
      // Sanitised on write in app.categories.$id.jsx; re-checked here
      // because this value reaches an inline `background` declaration.
      color: /^#[0-9a-fA-F]{6}$/.test(category.color) ? category.color : null,
      count: category._count.faqs,
      visible: category.visible,
    }));

  // Uncategorised FAQs are a real row in this list, not a rounding error:
  // they never appear under a filter tab on the storefront, so a merchant
  // who cannot see the number cannot fix it.
  const meters = {
    rows: ranked,
    uncategorized: uncategorizedCount,
    // Bars are scaled against the largest bar, not the total, so a list of
    // small categories still reads as a comparison rather than five slivers.
    max: Math.max(1, ...ranked.map((r) => r.count), uncategorizedCount),
    hiddenCount: Math.max(0, categoryCount - ranked.length),
  };

  return {
    range: rangeKey,
    rangeLabel: rangeMeta.label,
    stats: {
      // Tiles render `inRange`; the checklist and empty states use `allTime`.
      total: inRange.total,
      published: inRange.published,
      draft: inRange.draft,
      categories: rangeDays ? rangeCategoryCount : categoryCount,
      isRanged: Boolean(rangeDays),
      // Sub-lines under each tile. Built server-side so the "is this claim
      // true?" review reads as one block instead of being spread across
      // four ternaries in JSX.
      deltas: buildDeltas({
        isRanged: Boolean(rangeDays),
        rangeLabel: rangeMeta.label,
        counts: inRange,
        faqsThisWeek,
        categoriesThisWeek,
        emptyCategoryCount: emptyCategories.length,
        staleDraftCount,
      }),
    },
    chart: {
      series,
      total: series.reduce((sum, point) => sum + point.value, 0),
      max: Math.max(1, ...series.map((point) => point.value)),
      months: CHART_MONTHS,
    },
    activity,
    meters,
    // The route assembles the checklist, because its theme step depends on
    // an Admin API call that must not be able to fail this query.
    checklistInput: {
      hasOwnFaq,
      hasPublished: allTime.published > 0,
      hasOwnCategory,
    },
    attention,
    // Both are all-time figures, and both are here rather than derived from
    // `meters` in the route: `meters.rows` is the five largest categories,
    // so an empty one is exactly the row it truncates away.
    uncategorizedCount,
    emptyCategoryCount: emptyCategories.length,
    draftCount: allTime.draft,
    isEmpty: allTime.total === 0,
  };
}

/**
 * The line under each stat number.
 *
 * The mockup this layout follows put a percentage trend here. There is no
 * previous-period figure to compare against for anything except creation
 * dates, so these are statements of present fact instead — a share, a
 * count, or a plain "nothing changed". `tone` drives colour and `direction`
 * drives the arrow glyph, but neither carries meaning on its own: the text
 * says the whole thing, which is what a screen reader and a colour-blind
 * merchant both get.
 */
function buildDeltas({
  isRanged,
  rangeLabel,
  counts,
  faqsThisWeek,
  categoriesThisWeek,
  emptyCategoryCount,
  staleDraftCount,
}) {
  const share = counts.total
    ? Math.round((counts.published / counts.total) * 100)
    : 0;
  const window = rangeLabel.toLowerCase();

  if (isRanged) {
    return {
      total: { text: `Created in the ${window}`, tone: "neutral", direction: "flat" },
      published: counts.total
        ? { text: `${share}% of them are live`, tone: share >= 50 ? "positive" : "neutral", direction: "flat" }
        : { text: "Nothing created yet", tone: "neutral", direction: "flat" },
      draft: counts.draft
        ? { text: `${counts.draft} still hidden`, tone: "caution", direction: "flat" }
        : { text: "All of them are live", tone: "positive", direction: "flat" },
      categories: { text: `Created in the ${window}`, tone: "neutral", direction: "flat" },
    };
  }

  return {
    total: faqsThisWeek
      ? { text: `+${faqsThisWeek} this week`, tone: "positive", direction: "up" }
      : { text: "No new FAQs this week", tone: "neutral", direction: "flat" },

    published: counts.total
      ? { text: `${share}% of your FAQs`, tone: share >= 50 ? "positive" : "neutral", direction: "flat" }
      : { text: "Nothing published yet", tone: "caution", direction: "flat" },

    draft: counts.draft === 0
      ? { text: "Everything is live", tone: "positive", direction: "flat" }
      : staleDraftCount
        ? { text: `${staleDraftCount} idle for ${STALE_DRAFT_DAYS}+ days`, tone: "caution", direction: "down" }
        : { text: "Hidden from shoppers", tone: "neutral", direction: "flat" },

    categories: emptyCategoryCount
      ? { text: `${emptyCategoryCount} with no FAQs`, tone: "caution", direction: "flat" }
      : categoriesThisWeek
        ? { text: `+${categoriesThisWeek} this week`, tone: "positive", direction: "up" }
        : { text: "All of them in use", tone: "positive", direction: "flat" },
  };
}

/**
 * The theme step is filled in by the route, because it comes from the Admin
 * API rather than Prisma and must not be able to fail the whole loader.
 * Keeping it a separate argument means the checklist shape is identical
 * whether or not that call succeeded.
 */
export function buildChecklist({ hasOwnFaq, hasPublished, hasOwnCategory }, themeStatus = "unknown") {
  const steps = [
    {
      key: "create",
      label: "Write your first FAQ",
      description: "Answer a question in your own words, or edit one of the starter FAQs.",
      done: hasOwnFaq,
      actionLabel: "Create FAQ",
      href: "/app/faqs/new",
    },
    {
      key: "publish",
      label: "Publish an FAQ",
      description: "Drafts stay hidden from shoppers until you publish them.",
      done: hasPublished,
      actionLabel: "Review FAQs",
      href: "/app/faqs",
    },
    {
      key: "theme",
      label: "Add the FAQ block to your theme",
      description: "Nothing appears on your storefront until the block is placed.",
      // "unknown" is treated as not-done rather than done: the step stays
      // actionable and the copy stays true either way. Claiming it is done
      // on a failed API call is the one outcome that would mislead.
      done: themeStatus === "installed",
      unknown: themeStatus === "unknown",
      actionLabel: "Open theme editor",
      href: null, // filled by the route with the deep link
      external: true,
    },
    {
      key: "categories",
      label: "Organise FAQs into categories",
      description: "Categories become the filter tabs shoppers see on the widget.",
      done: hasOwnCategory,
      actionLabel: "Add category",
      href: "/app/categories/new",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  return {
    steps,
    completed,
    total: steps.length,
    // The whole card disappears at 4/4. A permanent checklist on a mature
    // account is clutter, and re-showing it after the fact would be worse.
    allDone: completed === steps.length,
  };
}

/**
 * The single next thing worth doing, for the callout at the foot of the
 * page.
 *
 * The mockup put an "AI suggestion" here, generated from search terms the
 * app does not collect. This is the honest equivalent: the first unfinished
 * setup step, then the largest real content gap, then a genuinely positive
 * state. It is never empty, and it never invents a reason.
 */
export function buildNextStep({ checklist, uncategorizedCount, emptyCategoryCount, draftCount }) {
  const pending = checklist.steps.find((step) => !step.done && step.href);
  if (pending) {
    return {
      tone: "action",
      heading: "Next step",
      body: `${pending.label} — ${pending.description}`,
      actionLabel: pending.actionLabel,
      href: pending.href,
      external: Boolean(pending.external),
    };
  }

  if (uncategorizedCount > 0) {
    return {
      tone: "action",
      heading: "Suggested",
      body: `${uncategorizedCount} FAQ${uncategorizedCount === 1 ? " isn't" : "s aren't"} in a category, so ${uncategorizedCount === 1 ? "it doesn't" : "they don't"} appear under any filter tab on your storefront.`,
      actionLabel: "Organise FAQs",
      href: "/app/faqs",
      external: false,
    };
  }

  if (emptyCategoryCount > 0) {
    return {
      tone: "action",
      heading: "Suggested",
      body: `${emptyCategoryCount} categor${emptyCategoryCount === 1 ? "y has" : "ies have"} no FAQs yet, so ${emptyCategoryCount === 1 ? "it stays" : "they stay"} hidden from shoppers.`,
      actionLabel: "Review categories",
      href: "/app/categories",
      external: false,
    };
  }

  if (draftCount > 0) {
    return {
      tone: "action",
      heading: "Suggested",
      body: `${draftCount} draft${draftCount === 1 ? "" : "s"} still ${draftCount === 1 ? "isn't" : "aren't"} visible to shoppers.`,
      actionLabel: "Review drafts",
      href: "/app/faqs",
      external: false,
    };
  }

  return {
    tone: "done",
    heading: "You're all set",
    body: "Every FAQ is published, categorised and live on your theme. Keep a copy of your content somewhere safe.",
    actionLabel: "Export a backup",
    href: "/app/data",
    external: false,
  };
}

// PHASE 2 NOTE
// Views, searches, no-result searches and helpful/not-helpful votes belong
// here too, once the tracking models and the App Proxy collector exist.
// The dashboard layout already has the shapes they would slot into: the
// trend chart would gain a second series, the meter list would become the
// search-term list it was modelled on, and `buildNextStep` would be able to
// suggest an FAQ for a term with no match. Until then this file must not
// grow a function that returns a number the database cannot back up.
