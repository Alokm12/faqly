// Faqly dashboard — the app's home page.
//
// WHAT IS AND ISN'T ON THIS PAGE
// The layout follows a supplied design: a greeting header, a four-tile stat
// row, a wide trend chart beside a narrow activity rail, and two comparison
// panels underneath. Every panel from that design is here. What changed is
// what fills them, because the design's figures — views, helpful rate,
// search hits, top searched terms — have no source in this app. Nothing
// records a view, a vote or a search term, so there is no honest number to
// print, and Shopify's non-deceptive-code policy treats an invented metric
// as grounds for rejection.
//
// Each panel therefore keeps its shape and its position, and takes the
// truest data the schema can supply:
//   stat row       → FAQs, Published, Drafts, Categories, with real
//                    week-over-week and share-of-total sub-lines
//   trend chart    → FAQs created per month, from createdAt
//   activity rail  → real creates and edits, newest first
//   ranked list    → what needs attention, worst first
//   meter list     → FAQs per category, largest first
//   suggestion box → the next unfinished setup step
// app/services/dashboard.server.js is where every one of those numbers is
// produced, and it is one file precisely so this claim can be checked.
//
// There is also deliberately no cross-promotion panel, no "other apps from
// us" carousel and no "what's new" slider. They are the bulk of what
// competing FAQ apps put on this screen, and they are the first thing a
// Built for Shopify review counts against you.
//
// STYLING
// Surfaces, spacing and colour come from app/components/ui.jsx,
// which reuses the palette already on the FAQs and Categories screens.
// Anything that navigates is an `s-button` or `s-link`: inside the embedded
// admin a bare <a> replaces the iframe location without the shop/host
// params the loader needs, and the link silently fails.

import { useEffect } from "react";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dataContext } from "../models/context.server";
import {
  getDashboardData,
  buildChecklist,
  buildNextStep,
  STAT_RANGES,
  DEFAULT_RANGE,
} from "../services/dashboard.server";
import {
  getWidgetThemeStatus,
  buildWidgetDeepLink,
} from "../services/theme-widget.server";
import {
  AppStyles,
  PALETTE,
  toneFamily,
  Icon,
  Card,
  CardHead,
  Chip,
  Tag,
  StatCard,
  SegmentedControl,
  BarChart,
  MeterRow,
  Callout,
  ProgressBar,
} from "../components/ui";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const ctx = await dataContext({ session, admin });

  const url = new URL(request.url);
  const range = url.searchParams.get("range") ?? DEFAULT_RANGE;

  // The one Admin API call here cannot fail this loader:
  // getWidgetThemeStatus resolves to { status: "unknown" } on a missing
  // scope, a throttle or a network blip, and the UI then claims nothing
  // about the theme rather than guessing.
  const [data, theme] = await Promise.all([
    getDashboardData(ctx, { range }),
    getWidgetThemeStatus(ctx.graphql),
  ]);

  const deepLink = buildWidgetDeepLink(session.shop);
  const checklist = buildChecklist(data.checklistInput, theme.status);
  const steps = checklist.steps.map((step) =>
    step.key === "theme" ? { ...step, href: deepLink } : step,
  );

  return {
    ...data,
    checklist: { ...checklist, steps },
    nextStep: buildNextStep({
      checklist: { ...checklist, steps },
      uncategorizedCount: data.uncategorizedCount,
      emptyCategoryCount: data.emptyCategoryCount,
      // All-time, not the filtered tile value: the suggestion is about the
      // store, and it must not change meaning when someone picks "7 days".
      draftCount: data.draftCount,
    }),
    theme: { ...theme, deepLink },
    ranges: Object.entries(STAT_RANGES).map(([value, { short }]) => ({
      value,
      label: short,
    })),
    // Passed through loader data rather than imported by the component:
    // React Router only strips `.server` imports out of loader/action/headers,
    // so a component that reads one directly fails the client build.
    defaultRange: DEFAULT_RANGE,
  };
};

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

/**
 * The heading is a fixed welcome rather than a time-of-day greeting, so
 * nothing in it depends on the clock, the store's timezone or the Admin
 * API — which is also why the loader no longer makes a call to fetch a
 * name to put in it.
 *
 * The strapline stays the same on an empty store. The empty state has its
 * own card with its own copy directly below, and repeating the pitch twice
 * on the same screen reads as an ad rather than a product.
 */
function Hero({ theme }) {
  const widgetLabel =
    theme.status === "missing" ? "Add widget to theme" : "Customize widget";

  return (
    <div className="fq-hero">
      <div style={{ minWidth: 0 }}>
        <h2 className="fq-hero-greeting">
          Welcome to <span className="fq-hero-name">Faqly</span>{" "}
          {/* Decoration. The sentence reads the same without it, so it is
              hidden rather than given a label a screen reader must sit
              through on every visit. */}
          <span aria-hidden="true">👋</span>
        </h2>
        <p className="fq-hero-sub">
          Build and organise your FAQs in minutes, and answer your customers
          before they open a support ticket.
        </p>

        {/* Positive theme status lives here rather than in a banner:
            "everything is fine" does not deserve a full-width alert. The
            problem case still gets one, below. */}
        {theme.status === "installed" && (
          <div style={{ marginTop: "10px" }}>
            <Tag tone="positive">
              <Icon name="check" size={12} />
              Live on {theme.themeName || "your published theme"}
            </Tag>
          </div>
        )}
      </div>

      <div className="fq-hero-actions">
        <s-button href="/app/faqs/new" icon="plus-circle">
          New FAQ
        </s-button>
        {/* target="_blank" is required: the theme editor refuses to load
            inside the admin's iframe. */}
        {theme.deepLink ? (
          <s-button href={theme.deepLink} target="_blank" variant="primary">
            {widgetLabel}
          </s-button>
        ) : (
          <s-button href="/app/faqs" variant="primary">
            Manage FAQs
          </s-button>
        )}
      </div>
    </div>
  );
}

function ThemeAlert({ theme }) {
  // "unknown" renders nothing at all. Telling a merchant their widget is off
  // when we simply failed to look is worse than saying nothing.
  if (theme.status !== "missing" || !theme.deepLink) return null;

  return (
    <s-banner tone="warning" heading="Your FAQ widget isn't on your live theme yet">
      <s-paragraph>
        FAQs you create here won&apos;t appear on your storefront until the Faqly
        block is added to
        {theme.themeName ? ` your live theme (${theme.themeName})` : " your live theme"}.
        Adding it takes one click — then press Save in the theme editor.
      </s-paragraph>
      <s-button slot="primary-action" href={theme.deepLink} target="_blank" variant="primary">
        Add widget to theme
      </s-button>
    </s-banner>
  );
}

/* ------------------------------------------------------------------ */
/* Stat row                                                            */
/* ------------------------------------------------------------------ */

function StatsRow({ stats, ranges, range, onRangeChange }) {
  // Labels change with the range because they are different claims.
  // "Total FAQs" and "FAQs created" must never share a label.
  const tiles = [
    {
      key: "total",
      label: stats.isRanged ? "FAQs created" : "Total FAQs",
      value: stats.total,
      family: "indigo",
    },
    { key: "published", label: "Published", value: stats.published, family: "green" },
    { key: "draft", label: "Drafts", value: stats.draft, family: "amber" },
    {
      key: "categories",
      label: stats.isRanged ? "Categories created" : "Categories",
      value: stats.categories,
      family: "violet",
    },
  ];

  return (
    <section aria-labelledby="fq-stats-heading">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "10px",
        }}
      >
        <h3
          id="fq-stats-heading"
          style={{
            margin: 0,
            fontSize: "11.5px",
            fontWeight: 650,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          Your content
        </h3>
        <SegmentedControl
          label="Date range for these figures"
          options={ranges}
          value={range}
          onChange={onRangeChange}
        />
      </div>

      {/* aria-live so that changing the range announces the new figures
          rather than silently swapping them under the cursor. */}
      <div className="fq-stats" aria-live="polite">
        {tiles.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={tile.value}
            family={tile.family}
            delta={stats.deltas[tile.key]}
          />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Setup checklist                                                     */
/* ------------------------------------------------------------------ */

function SetupChecklist({ checklist }) {
  // The whole card disappears once every step is done. A checklist that
  // never goes away is clutter on a mature account, and re-surfacing it
  // later would read as the app losing track of what the merchant did.
  if (checklist.allDone) return null;

  return (
    <Card aria-labelledby="fq-checklist-heading">
      <CardHead
        id="fq-checklist-heading"
        title="Finish setting up Faqly"
        subtitle="Four steps between an installed app and answers on your storefront."
        action={<Chip>{checklist.completed} of {checklist.total} complete</Chip>}
      />

      <ProgressBar completed={checklist.completed} total={checklist.total} />

      <div className="fq-steps">
        {checklist.steps.map((step) => {
          const family = step.done ? PALETTE.green : PALETTE.slate;
          return (
            <div
              key={step.key}
              className={`fq-step${step.done ? " fq-step-done" : ""}`}
            >
              <span
                className="fq-icon-chip"
                style={{ background: family.bg, color: family.text }}
                aria-hidden="true"
              >
                <Icon name={step.done ? "check" : "doc"} size={14} />
              </span>

              <div className="fq-step-main">
                <span className="fq-row-title">{step.label}</span>
                <span className="fq-row-sub">{step.description}</span>
                {step.unknown && (
                  <span className="fq-row-sub">
                    We couldn&apos;t check your theme just now — open the editor to
                    confirm.
                  </span>
                )}

                {/* Status is never colour alone: a finished step shows the
                    word "Done", an unfinished one shows a button whose
                    label says what to do about it. */}
                <div style={{ marginTop: "8px" }}>
                  {step.done ? (
                    <Tag tone="positive">
                      <Icon name="check" size={12} />
                      Done
                    </Tag>
                  ) : (
                    step.href && (
                      <s-button
                        href={step.href}
                        {...(step.external ? { target: "_blank" } : {})}
                      >
                        {step.actionLabel}
                      </s-button>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Trend chart                                                         */
/* ------------------------------------------------------------------ */

function TrendCard({ chart }) {
  return (
    <Card aria-labelledby="fq-trend-heading">
      <CardHead
        id="fq-trend-heading"
        title="FAQs added"
        subtitle="New FAQs created each month, from their creation date."
        action={<Chip>Last {chart.months} mo</Chip>}
      />

      <BarChart
        series={chart.series}
        max={chart.max}
        caption={`FAQs added each month over the last ${chart.months} months`}
      />

      <p className="fq-card-sub" style={{ margin: 0 }}>
        {chart.total === 0
          ? "Nothing created in this window yet."
          : `${chart.total} FAQ${chart.total === 1 ? "" : "s"} created in the last ${chart.months} months.`}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Activity rail                                                       */
/* ------------------------------------------------------------------ */

const ACTIVITY_FAMILY = {
  "faq-created": "indigo",
  "faq-edited": "amber",
  "category-created": "violet",
  "category-edited": "slate",
};

function ActivityCard({ activity }) {
  return (
    <Card aria-labelledby="fq-activity-heading">
      <CardHead
        id="fq-activity-heading"
        title="Recent activity"
        subtitle="Latest changes to your FAQs and categories."
      />

      {activity.length === 0 ? (
        <p className="fq-quiet">
          <Icon name="clock" size={15} />
          Nothing has changed yet.
        </p>
      ) : (
        <ul className="fq-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {activity.map((event) => {
            const family = PALETTE[ACTIVITY_FAMILY[event.kind] ?? "slate"];
            return (
              <li className="fq-row" key={event.id}>
                <span
                  className="fq-dot"
                  style={{ background: family.accent }}
                  aria-hidden="true"
                />
                <span className="fq-row-main">
                  <span className="fq-row-title">{event.title}</span>
                  {/* The item name is the link, so the accessible name of
                      every link on this list is unique — "here"-style
                      duplicates are the classic failure of an activity
                      feed. */}
                  <span className="fq-row-sub">
                    <s-link href={event.href}>{event.detail}</s-link>
                  </span>
                </span>
                <span className="fq-row-note">{event.ago}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Needs attention                                                     */
/* ------------------------------------------------------------------ */

const ATTENTION_ICON = {
  starter: "alert",
  "empty-answer": "alert",
  "stale-drafts": "clock",
  "empty-categories": "folder",
  orphans: "tag",
};

/**
 * The contents of an attention row, without the element that wraps them —
 * the list renders these inside an <li>, the orphan check inside its own
 * live region, and neither may nest a list item in a list item.
 */
function AttentionBody({ group }) {
  const family = toneFamily(group.tone);
  const hidden = group.count - group.rows.length;

  return (
    <>
      <span
        className="fq-icon-chip"
        style={{ background: family.bg, color: family.text }}
        aria-hidden="true"
      >
        <Icon name={ATTENTION_ICON[group.key] ?? "alert"} size={15} />
      </span>

      <span className="fq-row-main">
        <span className="fq-row-title">{group.title}</span>
        <span className="fq-row-sub">{group.description}</span>
        {group.rows.length > 0 && (
          <span className="fq-inline-links">
            {group.rows.slice(0, 3).map((row) => (
              <s-link key={row.id} href={row.href}>
                {row.question || "Untitled"}
              </s-link>
            ))}
            {hidden > 0 && <span className="fq-row-sub">and {hidden} more</span>}
          </span>
        )}
      </span>

      <span className="fq-row-side">
        <span className="fq-row-value" style={{ color: family.text }}>
          {group.count}
        </span>
        <span className="fq-row-note">to fix</span>
      </span>
    </>
  );
}

function AttentionRow({ group }) {
  return (
    <li className="fq-row">
      <AttentionBody group={group} />
    </li>
  );
}

/**
 * The orphaned-pin check is the one section that needs the Admin API, so it
 * is fetched after paint instead of blocking the loader.
 *
 * The wrapper is the live region and it is rendered unconditionally, empty
 * or not. That is the whole point: a region that is created holding
 * "Checking…" and then unmounted when the answer arrives announces the
 * question and never the answer. This one stays put and its contents
 * change, which is what a screen reader is listening for. `:not(:empty)`
 * in the stylesheet keeps the divider off it while it holds nothing.
 */
function OrphanRegion() {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/app/dashboard/orphans");
    }
  }, [fetcher]);

  const loading = fetcher.state !== "idle" || !fetcher.data;
  // "unknown" and "no problems" both render nothing: this panel only exists
  // to report a problem it actually found.
  const rows = !loading && fetcher.data.status === "ok" ? fetcher.data.rows : [];

  return (
    <div className="fq-orphan" aria-live="polite">
      {loading ? (
        <span className="fq-quiet">
          <s-spinner size="base" accessibilityLabel="Checking product links" />
          Checking FAQs pinned to products…
        </span>
      ) : rows.length > 0 ? (
        <div className="fq-row">
          <AttentionBody
            group={{
              key: "orphans",
              tone: "warning",
              title: `${rows.length} FAQ${rows.length === 1 ? " is" : "s are"} pinned to a deleted product`,
              description: fetcher.data.truncated
                ? "These target products or collections that no longer exist, so they never show. Only the first 250 links were checked."
                : "These target products or collections that no longer exist, so they never show.",
              count: rows.length,
              rows,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function AttentionCard({ attention }) {
  return (
    <Card aria-labelledby="fq-attention-heading">
      <CardHead
        id="fq-attention-heading"
        title="Needs attention"
        subtitle="What's stopping FAQs from reaching shoppers, worst first."
        action={<s-link href="/app/faqs">View all FAQs</s-link>}
      />

      <ul className="fq-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {attention.length === 0 && (
          <li className="fq-row">
            <span className="fq-quiet" style={{ color: PALETTE.green.text }}>
              <Icon name="check" size={15} />
              Nothing needs attention — your FAQs are in good shape.
            </span>
          </li>
        )}
        {attention.map((group) => (
          <AttentionRow key={group.key} group={group} />
        ))}
      </ul>

      <OrphanRegion />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Category meters                                                     */
/* ------------------------------------------------------------------ */

function CategoriesCard({ meters, nextStep, categoryCount }) {
  const rows = meters.rows;

  return (
    <Card aria-labelledby="fq-categories-heading">
      <CardHead
        id="fq-categories-heading"
        title="FAQs by category"
        subtitle="Where your published and draft content sits today."
        action={<s-link href="/app/categories">Manage</s-link>}
      />

      {rows.length === 0 && meters.uncategorized === 0 ? (
        <p className="fq-quiet">
          <Icon name="folder" size={15} />
          No categories yet.
        </p>
      ) : (
        <div className="fq-list">
          {rows.map((row) => (
            <MeterRow
              key={row.id}
              name={row.name}
              count={row.count}
              max={meters.max}
              // Category colours are merchant-chosen, so they are validated
              // as a 6-digit hex in the loader before reaching this
              // `background`; anything else falls back to the app indigo.
              color={row.color || PALETTE.indigo.accent}
              dotColor={row.color || PALETTE.indigo.accent}
              // "Hidden" is a word, not a greyed-out bar — the state has to
              // survive being read aloud or seen without colour.
              note={row.visible ? null : "Hidden ·"}
            />
          ))}

          {/* Uncategorised FAQs are a real row, not a rounding error: they
              never appear under a filter tab on the storefront, so a
              merchant who can't see the number can't fix it. */}
          {meters.uncategorized > 0 && (
            <MeterRow
              name="Uncategorized"
              count={meters.uncategorized}
              max={meters.max}
              color={PALETTE.slate.accent}
              dotColor={PALETTE.slate.accent}
            />
          )}
        </div>
      )}

      {meters.hiddenCount > 0 && (
        <p className="fq-card-sub" style={{ margin: 0 }}>
          Showing the {rows.length} largest of {categoryCount} categories.
        </p>
      )}

      <Callout
        tone={nextStep.tone}
        heading={nextStep.heading}
        footer={
          <div>
            <s-button
              href={nextStep.href}
              {...(nextStep.external ? { target: "_blank" } : {})}
            >
              {nextStep.actionLabel}
            </s-button>
          </div>
        }
      >
        {nextStep.body}
      </Callout>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Quick actions                                                       */
/* ------------------------------------------------------------------ */

/**
 * The supplied design has no panel for these, but the screen it replaces
 * did, and "Add category" and "Import or export" have no other one-click
 * entry point from here. They are a thin strip at the foot of the page
 * rather than a card of their own: they are shortcuts, not content, and the
 * app nav already lists the same destinations.
 */
function QuickActions({ deepLink }) {
  return (
    <section aria-labelledby="fq-actions-heading">
      <h3 id="fq-actions-heading" className="fq-sr-only">
        Quick actions
      </h3>
      <div className="fq-actions">
        <s-button href="/app/faqs/new" icon="plus-circle">
          Create FAQ
        </s-button>
        <s-button href="/app/categories/new" icon="categories">
          Add category
        </s-button>
        <s-button href="/app/data" icon="import">
          Import or export
        </s-button>
        {/* Only offered when we have a deep link to offer — otherwise the
            button would go nowhere. */}
        {deepLink && (
          <s-button href={deepLink} target="_blank" icon="theme-edit">
            Customize widget
          </s-button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Empty store                                                         */
/* ------------------------------------------------------------------ */

/**
 * A store with no FAQs at all. Reachable only if the merchant deleted the
 * starter set, but it is the difference between a useful page and four
 * zeroes.
 */
function EmptyDashboard() {
  return (
    <Card>
      <div className="fq-empty">
        <span
          className="fq-icon-chip"
          style={{
            background: PALETTE.indigo.bg,
            color: PALETTE.indigo.text,
            width: "44px",
            height: "44px",
            borderRadius: "14px",
          }}
          aria-hidden="true"
        >
          <Icon name="doc" size={22} />
        </span>
        <h3 className="fq-card-title" style={{ fontSize: "17px" }}>
          You don&apos;t have any FAQs yet
        </h3>
        <p className="fq-card-sub" style={{ maxWidth: "44ch" }}>
          Add your first question and answer, then place the Faqly block on your
          theme to show it to shoppers.
        </p>
        <s-button href="/app/faqs/new" variant="primary">
          Create your first FAQ
        </s-button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const {
    stats,
    chart,
    activity,
    meters,
    checklist,
    nextStep,
    attention,
    theme,
    ranges,
    range,
    defaultRange,
    isEmpty,
  } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  // The range lives in the URL rather than component state so the view is
  // linkable and survives a refresh, and so the filtering happens in one
  // place (the loader) instead of being duplicated on the client.
  const handleRangeChange = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultRange) next.delete("range");
    else next.set("range", value);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const categoryCount = meters.rows.length + meters.hiddenCount;

  return (
    <s-page heading="Dashboard">
      <s-link slot="secondary-actions" href="/app/faqs">
        All FAQs
      </s-link>

      <AppStyles />

      <div className="fq">
        <Hero theme={theme} />
        <ThemeAlert theme={theme} />

        {isEmpty ? (
          <EmptyDashboard />
        ) : (
          <>
            <StatsRow
              stats={stats}
              ranges={ranges}
              range={range}
              onRangeChange={handleRangeChange}
            />

            <SetupChecklist checklist={checklist} />

            <div className="fq-split">
              <TrendCard chart={chart} />
              <ActivityCard activity={activity} />
            </div>

            <div className="fq-duo">
              <AttentionCard attention={attention} />
              <CategoriesCard
                meters={meters}
                nextStep={nextStep}
                categoryCount={categoryCount}
              />
            </div>

            <QuickActions deepLink={theme.deepLink} />
          </>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
